'use strict';

/**
 * 20FIT Talent — KOL app.
 *
 *   Public:
 *     GET  /                 -> landing (talent categories)
 *     GET  /prototype        -> archived design prototype
 *     GET  /health           -> health check
 *
 *   Talent (self-service accounts, session cookie). Pages live at plain,
 *   role-agnostic paths — the talent type is read from the session, so a
 *   talent only ever sees talent.20fit.id/… (no /kol or /main-power prefix):
 *     GET/POST /register        -> create account
 *     GET/POST /login/talent    -> sign in  (/login redirects here)
 *     GET/POST /logout          -> sign out
 *     GET      /talent          -> home (KOL profile / Man Power dashboard by type)
 *     GET/POST /data-diri       -> profile form
 *     GET/POST /dokumen         -> documents (CV / portfolio / HYROX cert)
 *     GET/POST /kirim-bukti     -> KOL post-proof submission
 *     GET      /acara[/:id]     -> browse category-need events + apply
 *     GET/POST /lamar/:id       -> Man Power SOW application
 *     GET      /events, /event/:id -> position-based events + apply
 *   Old /kol/*, /main-power/* and /akun URLs 302-redirect to these.
 *
 *   EO / Super Admin (staff_accounts):
 *     GET/POST /login/eo        -> EO sign in  (/eo/login redirects here)
 *     GET      /eo              -> EO dashboard (+ /eo/events, /eo/profile, …)
 *     GET/POST /admin/login     -> Super Admin sign in
 *     GET      /admin           -> Super Admin (+ /admin/… sub-routes)
 *
 *   Admin (HTTP Basic auth, ADMIN_USER / ADMIN_PASSWORD):
 *     GET  /admin            -> dashboard (counts + campaign management)
 *     POST /admin/campaigns[/:id/toggle]
 *     GET  /performance      -> KOL leaderboard
 *
 * Data access goes through ./store (Supabase service-role, or in-memory for dev).
 */

const express = require('express');
const multer = require('multer');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const cookieParser = require('cookie-parser');
const V = require('./views');
const { store, MODE } = require('./store');
const auth = require('./auth');
const authApi = require('./authApi');
const llm = require('./llm');
const mailer = require('./mailer');
const cert = require('./cert');
const i18n = require('./i18n');

const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0';
const MAX_IMAGES = 5;
const MAX_IMAGE_BYTES = 6 * 1024 * 1024;

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
// Canonical host: when APP_BASE_URL is set (e.g. https://talent.20fit.id),
// send visitors who arrive on any other host (like the *.up.railway.app URL)
// to the canonical domain so every link stays on it. Off unless APP_BASE_URL
// is set; never redirects the Railway health check.
const CANONICAL_HOST = (() => { try { return process.env.APP_BASE_URL ? new URL(process.env.APP_BASE_URL).host : null; } catch { return null; } })();
if (CANONICAL_HOST) {
  app.use((req, res, next) => {
    if ((req.method !== 'GET' && req.method !== 'HEAD') || req.path === '/health') return next();
    const host = req.get('host');
    if (host && host !== CANONICAL_HOST) return res.redirect(302, 'https://' + CANONICAL_HOST + req.originalUrl);
    next();
  });
}
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
// Keep the login alive: refresh a still-valid session cookie on every request
// (rolling expiry) so open tabs / returning users stay signed in until they
// explicitly log out. Skip logout so it can still clear the cookie.
app.use((req, res, next) => { if (!/\/logout$/.test(req.path)) auth.touchSession(req, res); next(); });
// Resolve the request language once (from ?lang= or the persisted `lang` cookie).
app.use((req, res, next) => { req.lang = readLang(req, res); req.t = (k, v) => i18n.t(req.lang, k, v); next(); });

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMAGE_BYTES, files: MAX_IMAGES },
});
// Public submission: multiple feed screenshots + separate Reels/Story uploads.
const uploadPublic = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_IMAGE_BYTES, files: 20 } }).fields([
  { name: 'feed_images', maxCount: 10 },
  { name: 'reels_images', maxCount: 5 },
  { name: 'story_images', maxCount: 5 },
]);
// Talent documents (CV + HYROX certificate): PDF or image, a little larger than
// a screenshot to fit multi-page CVs / cert scans.
const MAX_DOC_BYTES = 8 * 1024 * 1024;
const uploadDocs = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_DOC_BYTES, files: 2 } })
  .fields([{ name: 'cv', maxCount: 1 }, { name: 'hyrox_cert', maxCount: 1 }]);
// Landing background photos (super admin). Client compresses in-browser first,
// so uploads land well under the image cap even for huge originals.
const uploadLanding = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_IMAGE_BYTES, files: 2 } })
  .fields([{ name: 'bg1', maxCount: 1 }, { name: 'bg2', maxCount: 1 }]);

const db = () => store();
const needConfig = (req, res) => res.status(503).send(V.configError('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY', req && req.lang));

// -------------------------------------------------- talent profile ("Data Diri")
// A newly-registered talent's account is not "active" until they complete their
// personal data. requireTalentReady gates the dashboards/apply flow on it and
// bounces incomplete profiles to /{type}/data-diri.

// Active events split for the data-diri teaser: ongoing first, then coming soon
// (past events dropped). Uses date-only comparison in the server's timezone.
function teaserEvents(events) {
  const today = new Date().toISOString().slice(0, 10);
  const rank = { ongoing: 0, upcoming: 1 };
  return (events || [])
    .filter((e) => e.is_active)
    .map((e) => {
      const starts = e.starts_at ? String(e.starts_at).slice(0, 10) : null;
      const ends = e.ends_at ? String(e.ends_at).slice(0, 10) : null;
      let status;
      if (ends && ends < today) status = 'past';
      else if (starts && starts > today) status = 'upcoming';
      else status = 'ongoing';
      return { id: e.id, name: e.name, starts_at: e.starts_at, ends_at: e.ends_at, status };
    })
    .filter((e) => e.status !== 'past')
    .sort((a, b) => (rank[a.status] - rank[b.status]) || (String(a.starts_at || '') < String(b.starts_at || '') ? -1 : 1));
}

// Gate: logged-in talent of `type` AND profile complete. Attaches req.account.
function requireTalentReady(type) {
  return [auth.requireTalent(type), async (req, res, next) => {
    try {
      const st = db();
      if (!st) return needConfig(req, res);
      const acc = await st.getAccountById(req.talent.id);
      if (!acc) { auth.clearSession(res, type); return res.redirect('/login/talent?next=' + encodeURIComponent(req.originalUrl)); }
      if (!acc.profile_completed_at) return res.redirect('/data-diri?lang=' + req.lang);
      req.account = acc;
      next();
    } catch (e) { next(e); }
  }];
}

// Gate: logged-in talent of `type`, but WITHOUT the profile-complete requirement,
// so a freshly registered talent can open their profile and browse events before
// completing it. Applying still uses requireTalentReady. Attaches req.account.
function requireTalentBrowse(type) {
  return [auth.requireTalent(type), async (req, res, next) => {
    try {
      const st = db();
      if (!st) return needConfig(req, res);
      const acc = await st.getAccountById(req.talent.id);
      if (!acc) { auth.clearSession(res, type); return res.redirect('/login/talent?next=' + encodeURIComponent(req.originalUrl)); }
      req.account = acc;
      next();
    } catch (e) { next(e); }
  }];
}

// GET /data-diri — profile form (+ available-events teaser). Talent type comes
// from the session. Skips to the dashboard if already complete, unless ?edit=1.
function dataDiriGet() {
  return [requireAnyTalentBrowse(), async (req, res, next) => {
    try {
      const st = db();
      if (!st) return needConfig(req, res);
      const acc = req.account;
      if (acc.profile_completed_at && req.query.edit !== '1') return res.redirect('/talent?lang=' + req.lang);
      const events = teaserEvents(await st.listEvents());
      res.send(V.talentDataDiri(req.talent.type, { account: acc, events, values: acc, lang: req.lang, next: safeNext(req.query.next) }));
    } catch (e) { next(e); }
  }];
}

// POST /data-diri — validate + save profile, activating the account.
function dataDiriPost() {
  return [requireAnyTalentBrowse(), async (req, res, next) => {
    try {
      const st = db();
      if (!st) return needConfig(req, res);
      const acc = req.account;
      const type = req.talent.type;
      const values = {
        province: String(req.body.province || '').trim(),
        city: String(req.body.city || '').trim().slice(0, 80),
        ktp: String(req.body.ktp || '').replace(/\D/g, '').slice(0, 20),
        birthdate: String(req.body.birthdate || '').trim(),
        gender: String(req.body.gender || '').trim(),
        instagram: String(req.body.instagram || '').trim().replace(/^@+/, '').slice(0, 60),
        instagram_followers: String(req.body.instagram_followers || '').trim(),
        experience: String(req.body.experience || '').trim().slice(0, 1000),
      };
      const errors = [];
      if (!V.PROVINCES.includes(values.province)) errors.push(req.t('dd.err.province'));
      if (!values.city) errors.push(req.t('dd.err.city'));
      let bdOk = /^\d{4}-\d{2}-\d{2}$/.test(values.birthdate);
      if (bdOk) {
        const d = new Date(values.birthdate + 'T00:00:00Z');
        const nowY = new Date().getUTCFullYear();
        const y = d.getUTCFullYear();
        if (isNaN(d.getTime()) || d.getTime() > Date.now() || y < nowY - 100 || y > nowY - 10) bdOk = false;
      }
      if (!bdOk) errors.push(req.t('dd.err.birthdate'));
      if (values.gender !== 'male' && values.gender !== 'female') errors.push(req.t('dd.err.gender'));
      if (!values.ktp) errors.push(req.t('dd.err.ktp')); // just collect the number, no verification
      if (!values.experience) errors.push(req.t('dd.err.experience'));
      // Instagram username + followers are optional — crew talents don't need them.
      let followers = null;
      if (values.instagram_followers) {
        const n = parseInt(values.instagram_followers.replace(/[.,\s]/g, ''), 10);
        if (Number.isNaN(n) || n < 0 || n > 1e9) errors.push(req.t('dd.err.followers'));
        else followers = n;
      }
      if (errors.length) {
        const events = teaserEvents(await st.listEvents());
        return res.status(400).send(V.talentDataDiri(type, { account: acc, events, values, errors, lang: req.lang, next: safeNext(req.body.next) }));
      }
      await st.updateAccountProfile(acc.id, {
        province: values.province,
        city: values.city,
        ktp: values.ktp,
        birthdate: values.birthdate,
        gender: values.gender,
        instagram: values.instagram || null,
        instagram_followers: followers,
        experience: values.experience || null,
        profile_completed_at: acc.profile_completed_at || new Date().toISOString(),
      });
      // Resume where the talent came from (e.g. the event they were applying to).
      res.redirect(safeNext(req.body.next) || ('/talent?lang=' + req.lang));
    } catch (e) { next(e); }
  }];
}

// ---- Talent documents ("Dokumen Saya"): optional CV/portfolio + HYROX cert ----
const DOC_KINDS = { cv: 'cv_path', hyrox: 'hyrox_cert_path' };
const docTypeOk = (f) => f && (/^application\/pdf$/i.test(f.mimetype || '') || /^image\//i.test(f.mimetype || ''));
const docExt = (f) => {
  const m = String(f.originalname || '').toLowerCase().match(/\.[a-z0-9]{1,5}$/);
  if (m) return m[0];
  return /pdf/i.test(f.mimetype || '') ? '.pdf' : '.jpg';
};

// GET /dokumen — the documents page (req.account carries current values).
function docsGet() {
  return [requireAnyTalentReady(), async (req, res, next) => {
    try {
      const st = db();
      if (!st) return needConfig(req, res);
      res.send(V.talentDocuments(req.talent.type, { account: req.account, flash: String(req.query.saved || ''), need: req.query.need === '1', lang: req.lang }));
    } catch (e) { next(e); }
  }];
}

// POST /dokumen — save portfolio link + optional CV / HYROX cert uploads.
function docsPost() {
  return [
    requireAnyTalentReady(),
    // Run multer manually so an oversized/invalid file becomes a friendly error
    // instead of crashing into the generic 500 handler.
    (req, res, next) => uploadDocs(req, res, (err) => {
      if (err) return res.status(400).send(V.talentDocuments(req.talent.type, { account: req.account, errors: [req.t('doc.err.size')], lang: req.lang }));
      next();
    }),
    async (req, res, next) => {
      try {
        const st = db();
        if (!st) return needConfig(req, res);
        const type = req.talent.type;
        const acc = await st.getAccountById(req.talent.id);
        if (!acc) { auth.clearSession(res); return res.redirect('/login/talent'); }
        const isCreator = (type === 'kol');
        const files = req.files || {};
        const patch = {};
        const errors = [];

        if (isCreator) {
          const url = String(req.body.portfolio_url || '').trim().slice(0, 500);
          if (url && !/^https?:\/\/.+/i.test(url)) errors.push(req.t('doc.err.url'));
          else patch.portfolio_url = url || null;
        }

        const cvFile = isCreator && files.cv && files.cv[0];
        if (cvFile) {
          if (!docTypeOk(cvFile)) errors.push(req.t('doc.err.type'));
          else {
            const key = `docs/cv/${acc.id}/${crypto.randomUUID()}${docExt(cvFile)}`;
            await st.uploadImage(key, cvFile.buffer, cvFile.mimetype);
            if (acc.cv_path) await st.removeImage(acc.cv_path);
            patch.cv_path = key;
          }
        }

        const hxFile = files.hyrox_cert && files.hyrox_cert[0];
        if (hxFile) {
          if (!docTypeOk(hxFile)) errors.push(req.t('doc.err.type'));
          else {
            const key = `docs/hyrox/${acc.id}/${crypto.randomUUID()}${docExt(hxFile)}`;
            await st.uploadImage(key, hxFile.buffer, hxFile.mimetype);
            if (acc.hyrox_cert_path) await st.removeImage(acc.hyrox_cert_path);
            // A fresh upload resets verification back to pending.
            patch.hyrox_cert_path = key;
            patch.hyrox_cert_status = 'pending';
            patch.hyrox_cert_verified_by = null;
            patch.hyrox_cert_verified_at = null;
            patch.hyrox_cert_note = null;
          }
        }

        if (errors.length) {
          return res.status(400).send(V.talentDocuments(type, { account: acc, values: { portfolio_url: req.body.portfolio_url }, errors, lang: req.lang }));
        }
        if (Object.keys(patch).length) await st.updateAccountProfile(acc.id, patch);
        res.redirect('/dokumen?saved=1&lang=' + req.lang);
      } catch (e) { next(e); }
    },
  ];
}

// GET /{type}/dokumen/file/:kind — stream the talent's own CV / HYROX file.
function docFile() {
  return [requireAnyTalentReady(), async (req, res, next) => {
    try {
      const st = db();
      if (!st) return needConfig(req, res);
      const col = DOC_KINDS[req.params.kind];
      const key = col && req.account[col];
      if (!key) return res.redirect('/dokumen?lang=' + req.lang);
      const buf = await st.downloadImage(key);
      if (!buf) return res.redirect('/dokumen?lang=' + req.lang);
      const ext = (String(key).match(/\.[a-z0-9]+$/i) || [''])[0].toLowerCase();
      const ct = ext === '.pdf' ? 'application/pdf'
        : ext === '.png' ? 'image/png'
        : ext === '.webp' ? 'image/webp'
        : ext === '.gif' ? 'image/gif' : 'image/jpeg';
      res.setHeader('Content-Type', ct);
      res.setHeader('Content-Disposition', 'inline');
      res.send(buf);
    } catch (e) { next(e); }
  }];
}

// Archived prototype (served at /prototype).
let prototypeHtml = null;
try {
  const file = fs.readdirSync(__dirname).find((f) => f.toLowerCase().endsWith('.html'));
  if (file) prototypeHtml = fs.readFileSync(path.join(__dirname, file));
} catch (_) { /* ignore */ }

// ---------------------------------------------------------------- public ----

app.get('/health', (req, res) => res.type('text').send('ok'));

function readLang(req, res) {
  let lang = req.query.lang;
  if (lang !== 'id' && lang !== 'en') lang = (req.cookies && req.cookies.lang) || 'id';
  if (req.query.lang === 'id' || req.query.lang === 'en') {
    res.cookie('lang', lang, { maxAge: 365 * 24 * 3600 * 1000, sameSite: 'lax', path: '/' });
  }
  return lang;
}

// Landing hero background photos live in storage; their signed URLs expire, so
// cache them in-process (well under the 2h TTL) and refresh lazily. The admin
// uploader resets this cache so a new photo shows up immediately.
let _bgCache = { at: 0, urls: [] };
function resetLandingBgCache() { _bgCache = { at: 0, urls: [] }; }
async function landingBgUrls(st) {
  if (!st) return [];
  if (_bgCache.at && Date.now() - _bgCache.at < 50 * 60 * 1000) return _bgCache.urls;
  let urls;
  try { urls = await st.landingBgUrls(); }
  catch (_) { urls = null; }
  const clean = Array.isArray(urls) ? urls.filter(Boolean) : [];
  // A failed sign (null/thrown) OR a result with nothing usable must NOT be cached.
  // Otherwise one transient Supabase hiccup — or a just-resumed project whose
  // storage is still warming up and briefly can't sign the (existing) objects —
  // blanks the hero for the whole 50-min window. Keep the last known-good photos
  // and retry on the next request instead.
  if (!clean.length) return _bgCache.urls || [];
  _bgCache = { at: Date.now(), urls: clean };
  return clean;
}

app.get('/', async (req, res, next) => {
  try {
    const st = db();
    const bg = (await landingBgUrls(st)).filter(Boolean);
    // Events currently open for registration (within the reg window + at least
    // one position whose quota isn't full), each with its still-open positions.
    // Same live EO data the talent /events list uses — no dummy/static data.
    // Best-effort — the landing must still render if this fails.
    let events = [];
    if (st) {
      try { events = await openPositionEvents(st, null); }
      catch (_) { /* keep the landing up regardless */ }
    }
    const account = auth.anySession(req, auth.TALENT_TYPES);
    res.send(V.landingPage(req.lang, { bg, events, account, cities: eventCityList(events) }));
  } catch (e) { next(e); }
});
app.get('/about', (req, res) => res.send(V.aboutPage(req.lang)));

// Public sign-up / sign-in: a single account form, no talent-type picker.
// New accounts default to KOL; login resolves the account by email across all
// talent types and lands each on the dashboard for their type. Admin & EO still
// sign in via /admin/login and /login/eo (linked from the login page + footer).
// A post-login/register redirect target must be a same-site absolute path
// (guards against open redirects like //evil.com or javascript:).
function safeNext(n) { n = String(n || ''); return (/^\/[A-Za-z0-9]/.test(n) && !n.startsWith('//')) ? n.slice(0, 512) : null; }
// Resolve the event name behind a `next=/event/<ref>…` target so the auth page
// can show "you're applying to <event>". Best-effort, read-only.
async function eventNameFromNext(st, nxt) {
  const m = /^\/event\/([^/?#]+)/.exec(String(nxt || ''));
  if (!m || !st) return null;
  try { const ev = findEventByRef(await st.listEvents(), decodeURIComponent(m[1])); return ev ? ev.name : null; }
  catch (_) { return null; }
}
app.get('/register', async (req, res, nextFn) => {
  try {
    const nxt = safeNext(req.query.next);
    const tk = auth.currentTalent(req);
    if (tk && (tk.type === 'kol' || tk.type === 'main_power')) return res.redirect(nxt || '/talent');
    const eventName = nxt ? await eventNameFromNext(db(), nxt) : null;
    res.send(V.talentRegister('kol', { unified: true, lang: req.lang, next: nxt, eventName }));
  } catch (e) { nextFn(e); }
});
app.post('/register', talentRegisterPost('kol', { unified: true }));
async function talentLoginGet(req, res) {
  const nxt = safeNext(req.query.next);
  const tk = auth.currentTalent(req);
  if (tk && (tk.type === 'kol' || tk.type === 'main_power')) return res.redirect(nxt || '/talent');
  let eventName = null;
  try { if (nxt) eventName = await eventNameFromNext(db(), nxt); } catch (_) { /* best-effort */ }
  res.send(V.talentLogin('kol', { unified: true, lang: req.lang, next: nxt, eventName }));
}
app.get('/login/talent', talentLoginGet);
// /login kept as an alias of the canonical /login/talent (preserve ?next/?lang).
app.get('/login', (req, res) => {
  const q = [];
  if (req.query.next) q.push('next=' + encodeURIComponent(req.query.next));
  if (req.query.lang) q.push('lang=' + req.query.lang);
  res.redirect('/login/talent' + (q.length ? '?' + q.join('&') : ''));
});
const talentLoginPost = async (req, res, next) => {
  try {
    const st = db();
    if (!st) return needConfig(req, res);
    const login = String(req.body.login || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    const nxt = safeNext(req.body.next);

    let account = await st.findAccountByLogin(login);
    // 1) Local password — the existing path; fast and works even if the app API
    //    is down. Auto-provisioned app users also land here on later logins.
    if (account && auth.verifyPassword(password, account.password_hash)) {
      auth.setSession(res, account);
      return res.redirect(nxt || '/talent');
    }
    // 2) Fall back to the 20FIT app account directory (only when configured).
    //    On success we mirror the account locally so the rest of the site works,
    //    and keep the local password in step with the app so it stays the source
    //    of truth going forward.
    if (authApi.isConfigured() && login && password) {
      const r = await authApi.login(login, password);
      if (r.ok) {
        const hash = auth.hashPassword(password);
        if (account) {
          await st.setTalentPassword(account.id, hash);
        } else {
          const name = (r.user && r.user.name) || login.split('@')[0];
          const acc = { talent_type: 'kol', name, login, password_hash: hash };
          if (r.user && r.user.phone) acc.phone = r.user.phone;
          try {
            account = await st.createAccount(acc);
          } catch (e) {
            if (e && e.code === 'DUP') account = await st.findAccountByLogin(login);
            else throw e;
          }
        }
        if (account) {
          auth.setSession(res, account);
          return res.redirect(nxt || '/talent');
        }
      }
    }
    // 3) Neither the local password nor the app API accepted these credentials.
    return res.status(401).send(V.talentLogin('kol', { unified: true, errors: [req.t('err.badTalentCreds')], values: { login }, lang: req.lang, next: nxt }));
  } catch (e) { next(e); }
};
app.post('/login/talent', talentLoginPost);
app.post('/login', talentLoginPost); // alias so any stale form posting to /login still works

// PUBLIC (no login) post-proof submission: name + social username + event, with
// multiple feed screenshots and separate Reels / Story uploads. Every image is extracted.
app.get('/submit', async (req, res, next) => {
  try {
    const st = db();
    if (!st) return needConfig(req, res);
    const events = await st.listActiveEvents();
    res.send(V.publicSubmitPage({ events, lang: req.lang }));
  } catch (e) { next(e); }
});

app.post('/submit', uploadPublic, async (req, res, next) => {
  try {
    const st = db();
    if (!st) return needConfig(req, res);
    const name = String(req.body.name || '').trim();
    const username = String(req.body.username || '').trim().replace(/^@/, '');
    const eventId = String(req.body.event_id || '').trim();
    const postLink = String(req.body.post_link || '').trim();
    const files = req.files || {};
    const groups = [['feed', files.feed_images || []], ['reels', files.reels_images || []], ['story', files.story_images || []]];
    const totalFiles = groups.reduce((a, [, arr]) => a + arr.length, 0);

    const errors = [];
    if (!name) errors.push(req.t('err.nameRequired'));
    if (!username) errors.push(req.t('pub.errUsername'));
    if (!eventId) errors.push(req.t('err.eventRequired'));
    if (totalFiles === 0) errors.push(req.t('pub.errNoImage'));
    for (const [, arr] of groups) for (const f of arr) if (!/^image\//i.test(f.mimetype || '')) { errors.push(req.t('err.fileMustBeImage')); break; }
    if (postLink && !/^https?:\/\/.+/i.test(postLink)) errors.push(req.t('err.badLink'));

    if (errors.length) {
      const events = await st.listActiveEvents();
      return res.status(400).send(V.publicSubmitPage({ events, errors: [...new Set(errors)], values: { name, username, event_id: eventId, post_link: postLink }, lang: req.lang }));
    }

    const postedRaw = String(req.body.posted_at || '').trim();
    let postedAt = null;
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(postedRaw)) {
      const d = new Date((postedRaw.length === 16 ? postedRaw + ':00' : postedRaw) + '+07:00');
      if (!isNaN(d.getTime())) postedAt = d.toISOString();
    }

    let count = 0;
    for (const [ctype, arr] of groups) {
      for (const file of arr) {
        const proofId = crypto.randomUUID();
        const ext = (path.extname(file.originalname || '').toLowerCase().match(/^\.[a-z0-9]{1,5}$/) || ['.jpg'])[0];
        const key = `proofs/${proofId}${ext}`;
        await st.uploadImage(key, file.buffer, file.mimetype);
        await st.createProof({
          id: proofId, talent_id: null, talent_type: 'kol', event_id: eventId, screenshot_path: key,
          post_link: postLink || null, posted_at: postedAt, status: 'pending',
          submitter_name: name, submitter_username: username, content_type: ctype,
        });
        runExtraction(st, proofId, file.buffer, file.mimetype); // fire-and-forget
        count += 1;
      }
    }
    res.send(V.publicSubmitSuccess({ name, count, lang: req.lang }));
  } catch (e) { next(e); }
});

// Change language anytime (from any page's switcher); persists via cookie.
app.get('/lang/:code', (req, res) => {
  const l = i18n.normLang(req.params.code);
  res.cookie('lang', l, { maxAge: 365 * 24 * 3600 * 1000, sameSite: 'lax', path: '/' });
  let dest = '/';
  try { const u = new URL(req.get('referer')); dest = u.pathname + u.search; } catch (_) { /* no/invalid referer */ }
  res.redirect(dest);
});

app.get('/prototype', (req, res) => {
  if (!prototypeHtml) return res.status(404).type('text').send('No prototype file found.');
  res.type('html').send(prototypeHtml);
});

// --------------------------------------------------------------- KOL auth ----

app.get('/kol/register', (req, res) => res.redirect('/register' + (req.query.lang ? '?lang=' + req.query.lang : '')));

// Registration collects Full Name, Email, WhatsApp, Password + confirmation.
// The account is created inactive; the talent completes Data Diri next. Shared
// by both talent types (KOL + Man Power).
function talentRegisterPost(type, opts = {}) {
  const unified = !!opts.unified;
  const isCreator = (type === 'kol');
  return [
    // Optional CV / HYROX uploads can ride along with the signup form (creators).
    (req, res, next) => uploadDocs(req, res, (err) => {
      if (err) return res.status(400).send(V.talentRegister(type, { unified, errors: [req.t('doc.err.size')], values: { name: req.body.name, login: req.body.login, phone: req.body.phone, portfolio_url: req.body.portfolio_url }, lang: req.lang, next: safeNext(req.body && req.body.next) }));
      next();
    }),
    async (req, res, next) => {
      try {
        const st = db();
        if (!st) return needConfig(req, res);
        const name = String(req.body.name || '').trim();
        const login = String(req.body.login || '').trim().toLowerCase();
        const phone = String(req.body.phone || '').trim();
        const password = String(req.body.password || '');
        const password2 = String(req.body.password2 || '');
        const nxt = safeNext(req.body.next);
        // Optional profile fields captured on the redesigned unified signup form.
        let gender = String(req.body.gender || '').trim().toLowerCase();
        if (gender !== 'male' && gender !== 'female') gender = '';
        let birthdate = String(req.body.birthdate || '').trim();
        if (birthdate && !/^\d{4}-\d{2}-\d{2}$/.test(birthdate)) birthdate = '';
        const values = { name, login, phone, gender, birthdate, portfolio_url: req.body.portfolio_url };

        // Optional supporting documents (all creator-side, all optional at signup).
        const files = req.files || {};
        const portfolioUrl = isCreator ? String(req.body.portfolio_url || '').trim().slice(0, 500) : '';
        const cvFile = isCreator && files.cv && files.cv[0];
        const hxFile = files.hyrox_cert && files.hyrox_cert[0];

        const errors = [];
        if (!name) errors.push(req.t('err.nameRequired'));
        if (!login) errors.push(req.t('err.emailRequired'));
        else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(login)) errors.push(req.t('err.emailInvalid'));
        if (!phone) errors.push(req.t('dd.err.phone'));
        else if (!/^[0-9+()\-\s]{8,20}$/.test(phone)) errors.push(req.t('dd.err.phoneBad'));
        if (password.length < 6) errors.push(req.t('err.passwordMin6'));
        else if (password2 && password !== password2) errors.push(req.t('err.passwordMismatch'));
        if (portfolioUrl && !/^https?:\/\/.+/i.test(portfolioUrl)) errors.push(req.t('doc.err.url'));
        if (cvFile && !docTypeOk(cvFile)) errors.push(req.t('doc.err.type'));
        if (hxFile && !docTypeOk(hxFile)) errors.push(req.t('doc.err.type'));
        if (errors.length) return res.status(400).send(V.talentRegister(type, { unified, errors, values, lang: req.lang, next: nxt }));

        // Email must be unique across all talent types (login resolves by email).
        if (await st.findAccountByLogin(login)) {
          return res.status(400).send(V.talentRegister(type, { unified, errors: [req.t('err.dupAccount')], values, lang: req.lang, next: nxt }));
        }

        let account;
        try {
          const acc = { talent_type: type, name, login, phone, password_hash: auth.hashPassword(password) };
          if (gender) acc.gender = gender;
          if (birthdate) acc.birthdate = birthdate;
          account = await st.createAccount(acc);
        } catch (e) {
          if (e.code === 'DUP') return res.status(400).send(V.talentRegister(type, { unified, errors: [req.t('err.dupAccount')], values, lang: req.lang, next: nxt }));
          throw e;
        }

        // Persist any documents supplied at signup (files uploaded post-create so
        // the storage key can include the new account id).
        const patch = {};
        if (portfolioUrl) patch.portfolio_url = portfolioUrl;
        if (cvFile) {
          const key = `docs/cv/${account.id}/${crypto.randomUUID()}${docExt(cvFile)}`;
          await st.uploadImage(key, cvFile.buffer, cvFile.mimetype);
          patch.cv_path = key;
        }
        if (hxFile) {
          const key = `docs/hyrox/${account.id}/${crypto.randomUUID()}${docExt(hxFile)}`;
          await st.uploadImage(key, hxFile.buffer, hxFile.mimetype);
          patch.hyrox_cert_path = key;
          patch.hyrox_cert_status = 'pending';
        }
        if (Object.keys(patch).length) await st.updateAccountProfile(account.id, patch);

        auth.setSession(res, account);
        // Redirect back to the event the visitor came from (?next), otherwise land
        // on the dashboard (profile + browse events); profile completion is
        // prompted there and enforced only when applying to an event.
        res.redirect(nxt || ('/talent?lang=' + req.lang));
      } catch (e) { next(e); }
    },
  ];
}

app.post('/kol/register', talentRegisterPost('kol', { unified: true }));

app.get('/kol/login', (req, res) => res.redirect('/login/talent?lang=' + req.lang));

app.post('/kol/login', async (req, res, next) => {
  try {
    const st = db();
    if (!st) return needConfig(req, res);
    const login = String(req.body.login || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    const account = await st.findAccount('kol', login);
    if (!account || !auth.verifyPassword(password, account.password_hash)) {
      return res.status(401).send(V.talentLogin('kol', { unified: true, errors: [req.t('err.badTalentCreds')], values: { login }, lang: req.lang }));
    }
    auth.setSession(res, account);
    res.redirect('/talent');
  } catch (e) { next(e); }
});

// ---- Unified clean talent routes (talent type resolved from the session) ----
// Talent-facing pages live at plain paths (no /kol or /main-power prefix) so a
// talent only ever sees talent.20fit.id/…; the type is read from the session.
app.get('/data-diri', dataDiriGet());
app.post('/data-diri', dataDiriPost());
app.get('/dokumen', docsGet());
app.post('/dokumen', docsPost());
app.get('/dokumen/file/:kind', docFile());
app.get('/logout', talentLogout);
app.post('/logout', talentLogout);

// ---- Back-compat: old role-prefixed URLs redirect to the clean paths --------
// (bookmarks, links shared before the rename). Query string (lang) is carried.
function talentLogout(req, res) { auth.clearSession(res, auth.TALENT_TYPES); res.redirect('/?lang=' + req.lang); }
const withLang = (req, p) => p + (req.query.lang ? (p.includes('?') ? '&' : '?') + 'lang=' + req.query.lang : '');
[['/akun', '/talent'], ['/kol', '/talent'], ['/main-power', '/talent'],
 ['/kol/data-diri', '/data-diri'], ['/main-power/data-diri', '/data-diri'],
 ['/kol/dokumen', '/dokumen'], ['/main-power/dokumen', '/dokumen'],
 ['/kol/kirim-bukti', '/kirim-bukti'], ['/kol/event', '/acara'],
].forEach(([oldP, newP]) => app.get(oldP, (req, res) => res.redirect(withLang(req, newP))));
app.get('/kol/dokumen/file/:kind', (req, res) => res.redirect(withLang(req, '/dokumen/file/' + encodeURIComponent(req.params.kind))));
app.get('/main-power/dokumen/file/:kind', (req, res) => res.redirect(withLang(req, '/dokumen/file/' + encodeURIComponent(req.params.kind))));
app.get('/kol/event/:id', (req, res) => res.redirect(withLang(req, '/acara/' + encodeURIComponent(req.params.id))));
app.get('/kol/sertifikat/:id', (req, res) => res.redirect(withLang(req, '/sertifikat/' + encodeURIComponent(req.params.id))));
app.get('/main-power/apply/:eventId', (req, res) => res.redirect(withLang(req, '/lamar/' + encodeURIComponent(req.params.eventId))));
// Old POST endpoints kept as aliases so any stale open form still submits.
app.post('/kol/logout', talentLogout);
app.post('/main-power/logout', talentLogout);
app.post('/kol/data-diri', dataDiriPost());
app.post('/main-power/data-diri', dataDiriPost());
app.post('/kol/dokumen', docsPost());
app.post('/main-power/dokumen', docsPost());

// ------------------------------------------------------------- KOL form ------

// Sign thumbnails + attach event/talent names to a list of proofs.
async function enrichProofs(st, proofs, ctx) {
  ctx = ctx || {};
  const events = ctx.events || await st.listEvents();
  const eventName = new Map(events.map((e) => [e.id, e.name]));
  const paths = proofs.map((p) => p.screenshot_path).filter(Boolean);
  const signed = paths.length ? await st.signImageUrls(paths) : [];
  const urlByPath = new Map(paths.map((p, i) => [p, signed[i]]));
  return proofs.map((p) => ({
    ...p,
    event_name: eventName.get(p.event_id) || null,
    talent_name: (ctx.talentNameById && ctx.talentNameById.get(p.talent_id)) || p.submitter_name || null,
    thumb: p.screenshot_path ? urlByPath.get(p.screenshot_path) : null,
  }));
}

// Extract stats from a proof screenshot via the LLM, in the background.
async function runExtraction(st, proofId, buffer, mimeType, priorStatus) {
  try {
    await st.updateProof(proofId, { status: 'processing' });
    const { model, extracted, ocr_text } = await llm.extractFromImage(buffer, mimeType);
    // Re-extracting a proof a human already decided on keeps that decision;
    // a fresh upload (pending) lands on 'extracted'.
    const keep = (priorStatus === 'verified' || priorStatus === 'rejected') ? priorStatus : 'extracted';
    await st.updateProof(proofId, {
      status: keep, platform: extracted.platform || null,
      extracted, ocr_text, extract_model: model, extract_error: null,
      processed_at: new Date().toISOString(),
    });
  } catch (e) {
    const noKey = e && e.code === 'NO_KEY';
    await st.updateProof(proofId, {
      status: noKey ? 'pending' : 'failed',
      extract_error: String((e && e.message) || 'error').slice(0, 300),
      processed_at: new Date().toISOString(),
    }).catch(() => {});
    if (!noKey) console.error('[extract]', proofId, e && e.message);
  }
}

// KOL dashboard (sidebar app shell): Profil (home) · Event · Kirim Bukti.
// req.account (full profile) is attached by requireTalentReady.
// Unified talent home. Dispatches by session type: Man Power sees the
// self-apply dashboard; KOL / photographer see the profile + history page.
app.get('/talent', requireAnyTalentBrowse(), async (req, res, next) => {
  try {
    const st = db();
    if (!st) return needConfig(req, res);
    if (req.talent.type === 'main_power') return await renderMpHome(req, res, st);
    // Lazily issue any certificates the talent has earned (attended + finished).
    const [myApps, events] = await Promise.all([st.listApplicationsForTalent(req.talent.id), st.listEvents()]);
    const eventById = new Map(events.map((e) => [e.id, e]));
    await issueCertsForApps(st, myApps, eventById, new Map([[req.talent.id, req.account.name]]));
    const [certs, proofs] = await Promise.all([st.listCertificatesForTalent(req.talent.id), st.listProofsForTalent(req.talent.id)]);
    // Per-position application history (one application = one position now):
    // resolve each application's single chosen position label for the profile list.
    const choices = await st.listApplicationChoices();
    const choicesByApp = new Map();
    choices.forEach((c) => { const arr = choicesByApp.get(c.application_id) || []; arr.push(c); choicesByApp.set(c.application_id, arr); });
    const posLabelById = new Map();
    for (const evId of [...new Set(myApps.map((a) => a.event_id))]) {
      (await st.listEventPositions(evId)).forEach((p) => posLabelById.set(String(p.position_id), p));
    }
    const appliedEvents = myApps
      .map((a) => {
        const ev = eventById.get(a.event_id);
        if (!ev) return null;
        // One application now holds 1-3 ranked choices. Display the accepted
        // position when approved, else the top (choice 1) pick; expose the full
        // ranked list + which picks were dropped for the dashboard explanation.
        const chs = (choicesByApp.get(a.id) || []).slice().sort((x, y) => x.priority - y.priority);
        const accepted = chs.find((c) => c.accepted) || null;
        const primary = accepted || chs[0] || null;
        const position = primary ? posLabelById.get(String(primary.position_id)) : null;
        const picks = chs.map((c) => ({ priority: c.priority, accepted: !!c.accepted, pos: posLabelById.get(String(c.position_id)) || null }));
        const acceptedPos = accepted ? posLabelById.get(String(accepted.position_id)) : null;
        const otherPos = accepted ? chs.filter((c) => !c.accepted).map((c) => posLabelById.get(String(c.position_id))).filter(Boolean) : [];
        const ref = (chs.length && (ev.slug || ev.id)) || null;
        return { name: ev.name, ref, location: ev.location || null, starts_at: ev.starts_at, ends_at: ev.ends_at, status: a.status, station: a.station || null, position, role: a.role, note: a.note || null, picks, acceptedPos, otherPos };
      })
      .filter(Boolean);
    // Real, countable profile stats (no fabricated ratings).
    const stats = {
      events: appliedEvents.length,
      approved: appliedEvents.filter((e) => ['approved', 'assigned', 'completed'].includes(e.status)).length,
      proofs: proofs.length,
      certs: certs.length,
    };
    res.send(V.kolProfilePage({ account: req.account, certs, events: appliedEvents, stats, lang: req.lang, cancelFlash: String(req.query.cancel || '') }));
  } catch (e) { next(e); }
});

// Talent downloads their own certificate PDF.
app.get('/sertifikat/:id', requireAnyTalentReady(), async (req, res, next) => {
  try {
    const st = db();
    if (!st) return needConfig(req, res);
    const c = await st.getCertificate(req.params.id);
    if (!c || c.talent_id !== req.talent.id || c.revoked_at) return res.redirect('/talent?lang=' + req.lang);
    const base = (process.env.APP_BASE_URL || (req.protocol + '://' + req.get('host'))).replace(/\/+$/, '');
    const buf = await cert.renderCertificatePDF({ ...c, issued_at: fmtDayID(c.issued_at), verifyUrl: base + '/cert/' + c.cert_no });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="Sertifikat-${c.cert_no}.pdf"`);
    res.send(buf);
  } catch (e) { next(e); }
});

// Public certificate verification page.
app.get('/cert/:certNo', async (req, res, next) => {
  try {
    const st = db();
    if (!st) return needConfig(req, res);
    const c = await st.getCertificateByNo(String(req.params.certNo));
    res.send(V.certVerifyPage({ cert: (c && !c.revoked_at) ? c : null, certNo: String(req.params.certNo), lang: req.lang }));
  } catch (e) { next(e); }
});

// ongoing (started, not ended) / upcoming / ended, from date-only comparison.
function eventStatusOf(e) {
  const today = new Date().toISOString().slice(0, 10);
  const s = e.starts_at ? String(e.starts_at).slice(0, 10) : null;
  const en = e.ends_at ? String(e.ends_at).slice(0, 10) : null;
  if (en && en < today) return 'ended';
  if (s && s > today) return 'upcoming';
  return 'ongoing';
}
// Categories an event opens (from talent_event_needs), labelled for the UI.
function eventCats(ev) {
  return (ev.needs || []).filter((n) => V.CAT_LABEL[n.talent_type])
    .map((n) => ({ type: n.talent_type, label: V.CAT_LABEL[n.talent_type], headcount: n.headcount }));
}

// Short ID date, e.g. "12 Sep 2026"; range if ends differs from starts.
const CERT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
function fmtDayID(d) {
  if (!d) return null;
  const p = String(d).slice(0, 10).split('-');
  if (p.length !== 3) return String(d);
  return `${+p[2]} ${CERT_MONTHS[+p[1] - 1] || ''} ${p[0]}`;
}
function eventDateStr(ev) {
  const s = fmtDayID(ev.starts_at);
  if (!s) return null;
  const e = ev.ends_at && String(ev.ends_at).slice(0, 10) !== String(ev.starts_at).slice(0, 10) ? fmtDayID(ev.ends_at) : null;
  return e ? `${s} – ${e}` : s;
}
// English event date, e.g. "August 6–7, 2026" (same month) or "August 6, 2026".
const EN_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
function eventDateStrEn(ev) {
  const s = String(ev.starts_at || '').slice(0, 10).split('-');
  if (s.length !== 3) return eventDateStr(ev);
  const y = +s[0], m = +s[1] - 1, d1 = +s[2];
  const mn = EN_MONTHS[m] || '';
  const eSame = ev.ends_at && String(ev.ends_at).slice(0, 10) !== String(ev.starts_at).slice(0, 10);
  if (eSame) {
    const e = String(ev.ends_at).slice(0, 10).split('-');
    const y2 = +e[0], m2 = +e[1] - 1, d2 = +e[2];
    if (y2 === y && m2 === m) return `${mn} ${d1}–${d2}, ${y}`;
    return `${mn} ${d1}, ${y} – ${EN_MONTHS[m2] || ''} ${d2}, ${y2}`;
  }
  return `${mn} ${d1}, ${y}`;
}

// Issue certificates for eligible applications: attended + event finished +
// cert_auto (not explicitly off). Idempotent via the unique (talent,event)
// constraint, so it is safe to call repeatedly (auto-issue + lazy backfill).
async function issueCertsForApps(st, apps, eventById, nameById) {
  for (const a of apps || []) {
    if (!a.attended) continue;
    const ev = eventById.get(a.event_id);
    if (!ev || !ev.completed_at || ev.cert_auto === false) continue;
    try {
      await st.createCertificate({
        cert_no: cert.makeCertNo(),
        talent_id: a.talent_id,
        event_id: a.event_id,
        role: a.role || V.CAT_LABEL[a.talent_type] || a.talent_type,
        talent_name: (a.answers && a.answers.name) || (nameById && nameById.get(a.talent_id)) || '',
        event_name: ev.name,
        event_date: eventDateStr(ev),
        issued_by: null,
      });
    } catch (e) { if (e.code !== 'DUP') throw e; }
  }
}

// Enrich event objects in place with a signed `mockup_url` for any that have a
// stored mockup_path, so covers can render the uploaded image. Accepts one event
// or an array; returns the same reference.
async function attachMockups(st, events) {
  const list = Array.isArray(events) ? events : [events];
  // A full http(s) mockup_path is an external image URL — use it as-is; only
  // storage paths need a signed URL.
  list.forEach((e) => { if (e && e.mockup_path && /^https?:\/\//i.test(e.mockup_path)) e.mockup_url = e.mockup_path; });
  const withPath = list.map((e, i) => ({ i, p: e && e.mockup_path })).filter((x) => x.p && !/^https?:\/\//i.test(x.p));
  if (withPath.length) {
    const urls = await st.signCovers(withPath.map((x) => x.p));
    withPath.forEach((x, k) => { list[x.i].mockup_url = urls[k] || null; });
  }
  return events;
}

// Upload an event mockup image to storage and return its path. Only accepts
// images; returns null when there's no usable file.
async function saveMockup(st, eventId, file) {
  if (!file || !file.buffer || !file.buffer.length) return null;
  if (!/^image\//.test(file.mimetype || '')) return null;
  const ext = (path.extname(file.originalname || '').toLowerCase().match(/^\.[a-z0-9]{1,5}$/) || ['.jpg'])[0];
  const key = 'events/' + eventId + '/mockup-' + Date.now() + ext;
  await st.uploadImage(key, file.buffer, file.mimetype);
  return key;
}

// Talent Home: active events (ongoing + upcoming) with their category needs.
app.get('/acara', requireTalentBrowse('kol'), async (req, res, next) => {
  try {
    const st = db();
    if (!st) return needConfig(req, res);
    const [allEvents, myApps] = await Promise.all([st.listEvents(), st.listApplicationsForTalent(req.talent.id)]);
    const appByEvent = new Map(myApps.map((a) => [a.event_id, a]));
    const rank = { ongoing: 0, upcoming: 1 };
    // Position-based events render as their own cards; keep the legacy list to
    // events with old-style needs and not already shown above (no duplicates).
    const eoEvents = await openPositionEvents(st, req.talent.id);
    const eoIds = new Set(eoEvents.map((e) => e.id));
    const events = allEvents.filter((e) => e.is_active && !eoIds.has(e.id))
      .map((e) => ({
        id: e.id, name: e.name, location: e.location, starts_at: e.starts_at, ends_at: e.ends_at, mockup_path: e.mockup_path, status: eventStatusOf(e), cats: eventCats(e),
        applied: appByEvent.has(e.id) ? {
          category: appByEvent.get(e.id).talent_type, status: appByEvent.get(e.id).status,
          station: appByEvent.get(e.id).station, station_loc: appByEvent.get(e.id).station_loc,
        } : null,
      }))
      .filter((e) => e.status !== 'ended' && e.cats.length > 0)
      .sort((a, b) => (rank[a.status] - rank[b.status]) || String(a.starts_at || '').localeCompare(String(b.starts_at || '')));
    await attachMockups(st, events);
    res.send(V.kolEventsPage({ account: req.account, events, eoEvents, lang: req.lang }));
  } catch (e) { next(e); }
});

// Event detail: pick a category to register for (or see your registration).
app.get('/acara/:id', requireTalentBrowse('kol'), async (req, res, next) => {
  try {
    const st = db();
    if (!st) return needConfig(req, res);
    const [allEvents, myApps] = await Promise.all([st.listEvents(), st.listApplicationsForTalent(req.talent.id)]);
    const ev = allEvents.find((e) => e.id === req.params.id);
    if (!ev || !ev.is_active) return res.redirect('/acara?lang=' + req.lang);
    const myApplication = myApps.find((a) => a.event_id === ev.id) || null;
    const event = await attachMockups(st, { ...ev, status: eventStatusOf(ev) });
    res.send(V.kolEventDetail({ account: req.account, event, cats: eventCats(ev), myApplication, lang: req.lang }));
  } catch (e) { next(e); }
});

// Dynamic registration form for one category.
app.get('/acara/:id/apply', requireTalentReady('kol'), async (req, res, next) => {
  try {
    const st = db();
    if (!st) return needConfig(req, res);
    const [allEvents, myApps] = await Promise.all([st.listEvents(), st.listApplicationsForTalent(req.talent.id)]);
    const ev = allEvents.find((e) => e.id === req.params.id);
    const cat = String(req.query.cat || '');
    const opensCat = ev && ev.is_active && V.CAT_LABEL[cat] && (ev.needs || []).some((n) => n.talent_type === cat);
    if (!opensCat) return res.redirect('/acara/' + req.params.id + '?lang=' + req.lang);
    if (myApps.some((a) => a.event_id === ev.id)) return res.redirect('/acara/' + ev.id + '?lang=' + req.lang);
    // Creator roles require a CV + portfolio on file before applying.
    if (V.CREATOR_ROLES.includes(cat) && !V.hasCreatorDocs(req.account)) return res.redirect('/dokumen?need=1&lang=' + req.lang);
    res.send(V.kolApplyForm({ account: req.account, event: ev, cat, lang: req.lang }));
  } catch (e) { next(e); }
});

app.post('/acara/:id/apply', requireTalentReady('kol'), async (req, res, next) => {
  try {
    const st = db();
    if (!st) return needConfig(req, res);
    const allEvents = await st.listEvents();
    const ev = allEvents.find((e) => e.id === req.params.id);
    const cat = String(req.body.cat || '');
    const opensCat = ev && ev.is_active && V.CAT_LABEL[cat] && (ev.needs || []).some((n) => n.talent_type === cat);
    if (!opensCat) return res.redirect('/acara?lang=' + req.lang);
    // Creator roles require a CV + portfolio on file before applying.
    if (V.CREATOR_ROLES.includes(cat) && !V.hasCreatorDocs(req.account)) return res.redirect('/dokumen?need=1&lang=' + req.lang);

    const values = { name: String(req.body.name || '').trim(), phone: String(req.body.phone || '').trim() };
    if (cat === 'main_power') values.city = String(req.body.city || '').trim().slice(0, 80);
    (V.CAT_FIELDS[cat] || []).forEach((f) => { values[f.k] = String(req.body[f.k] || '').trim().slice(0, 200); });

    const errors = [];
    if (!values.name) errors.push(req.t('err.nameRequired'));
    if (!values.phone || !/^[0-9+()\-\s]{8,20}$/.test(values.phone)) errors.push(req.t('dd.err.phoneBad'));
    if (cat === 'main_power' && !values.city) errors.push(req.t('dd.err.city'));
    (V.CAT_FIELDS[cat] || []).forEach((f) => {
      if (f.req && !values[f.k]) errors.push(req.t('apply.errRequired', { field: req.t(f.label) }));
      else if (f.type === 'url' && values[f.k] && !/^https?:\/\/.+/i.test(values[f.k])) errors.push(req.t('apply.errUrl', { field: req.t(f.label) }));
    });
    if (errors.length) return res.status(400).send(V.kolApplyForm({ account: req.account, event: ev, cat, values, errors, lang: req.lang }));

    try {
      await st.createApplication({ event_id: ev.id, talent_id: req.talent.id, talent_type: cat, role: V.CAT_LABEL[cat], answers: values });
    } catch (e) {
      if (e.code === 'DUP') return res.redirect('/acara/' + ev.id + '?lang=' + req.lang);
      throw e;
    }
    res.send(V.kolApplyDone({ account: req.account, event: ev, lang: req.lang }));
  } catch (e) { next(e); }
});

// ---- Type-agnostic talent apply to position-based (EO) events ---------------
// Any logged-in talent (KOL / Man Power / Fotografer) with a complete profile
// can browse open EO events and apply with 1..3 prioritised position choices.
function requireAnyTalentReady() {
  return async (req, res, next) => {
    try {
      const t = auth.anySession(req, auth.TALENT_TYPES);
      if (!t) return res.redirect('/login/talent?next=' + encodeURIComponent(req.originalUrl));
      const st = db();
      if (!st) return needConfig(req, res);
      const acc = await st.getAccountById(t.id);
      if (!acc) { auth.clearSession(res, auth.TALENT_TYPES); return res.redirect('/login/talent?next=' + encodeURIComponent(req.originalUrl)); }
      if (!acc.profile_completed_at) {
        // Carry the resume target (e.g. the event being applied to) through the
        // profile-completion step so the talent lands back where they started.
        const rn = safeNext(req.query.next) || safeNext(req.body && req.body.next);
        return res.redirect('/data-diri?lang=' + req.lang + (rn ? '&next=' + encodeURIComponent(rn) : ''));
      }
      req.talent = t; req.account = acc;
      next();
    } catch (e) { next(e); }
  };
}

// Like requireAnyTalentReady but without the profile-complete gate — lets a new
// talent browse the open events before completing their profile.
function requireAnyTalentBrowse() {
  return async (req, res, next) => {
    try {
      const t = auth.anySession(req, auth.TALENT_TYPES);
      if (!t) return res.redirect('/login/talent?next=' + encodeURIComponent(req.originalUrl));
      const st = db();
      if (!st) return needConfig(req, res);
      const acc = await st.getAccountById(t.id);
      if (!acc) { auth.clearSession(res, auth.TALENT_TYPES); return res.redirect('/login/talent?next=' + encodeURIComponent(req.originalUrl)); }
      req.talent = t; req.account = acc;
      next();
    } catch (e) { next(e); }
  };
}

// Optional talent session: attaches req.talent + req.account when a talent is
// logged in, but never redirects — public pages (event detail) render for
// logged-out visitors too, who only hit the login wall when they try to apply.
function optionalTalent() {
  return async (req, res, next) => {
    try {
      const t = auth.anySession(req, auth.TALENT_TYPES);
      if (t) {
        const st = db();
        if (st) {
          const acc = await st.getAccountById(t.id);
          if (acc) { req.talent = t; req.account = acc; }
          else auth.clearSession(res, auth.TALENT_TYPES);
        }
      }
      next();
    } catch (e) { next(e); }
  };
}

// Is the event currently accepting applications? (published + within reg window)
function eventRegOpen(ev) {
  if (!ev || ev.status !== 'published' || ev.reg_closed_at) return false;
  const today = jakartaDateStr();
  if (ev.reg_open && today < String(ev.reg_open).slice(0, 10)) return false;
  if (ev.reg_deadline && today > String(ev.reg_deadline).slice(0, 10)) return false;
  // Registration always closes at H-1 before the event starts, regardless of the
  // EO-set deadline: no sign-ups from the day before the event onward.
  if (ev.starts_at) {
    const h1 = addDaysYMD(String(ev.starts_at).slice(0, 10), -1);
    if (today >= h1) return false;
  }
  return true;
}

// Event start as an epoch (ms), interpreting starts_at (date) + start_time
// ("HH:MM", default 00:00) as Asia/Jakarta / WIB (UTC+7, no DST). Returns null if
// no date is stored. All H-1 day / H-12 hour math flows through here so the cutoff
// is computed one way, in WIB, on the server — never from the UI or server clock TZ.
function eventStartMs(ev) {
  if (!ev || !ev.starts_at) return null;
  const d = String(ev.starts_at).slice(0, 10);
  const t = (ev.start_time && /^\d{2}:\d{2}/.test(String(ev.start_time))) ? String(ev.start_time).slice(0, 5) : '00:00';
  const ms = Date.parse(d + 'T' + t + ':00+07:00');
  return Number.isNaN(ms) ? null : ms;
}
function hoursUntilEvent(ev) { const ms = eventStartMs(ev); return ms == null ? null : (ms - Date.now()) / 3600000; }
// Talent may self-cancel until H-1 day (24h before start). Unknown start = leave
// open (never close the exit early — the spec's rationale).
function cancelWindowOpen(ev) { const h = hoursUntilEvent(ev); return h == null ? true : h > 24; }
// Standby list stays callable until H-12 hours before start.
function standbyWindowOpen(ev) { const h = hoursUntilEvent(ev); return h == null ? true : h > 12; }

// --- New attendance & reliability system (Tahap 2+) ------------------------
// The three real-world outcomes the leader records. NULL = belum ditandai
// (unmarked) — never defaulted to "present". Only 'absent_no_notice' is a
// reliability violation; 'absent_notified' (told the EO via WhatsApp) is not.
const ATT_STATUSES = ['present', 'absent_notified', 'absent_no_notice'];
// Leader link opens H-3 hours before the event start (user decision) so the PIC
// can prepare on-site, and stays active until the correction window closes.
function attendanceOpenMs(ev) { const s = eventStartMs(ev); return s == null ? null : s - 3 * 3600 * 1000; }
// Correction window closes at end of the 10th day (23:59:59 WIB) after the
// event ends. After this the day is LOCKED to the leader/EO — only a super
// admin may still edit (with a recorded reason). Checked on the server so the
// UI can never widen it.
function correctionCloseMs(ev) {
  const end = String((ev && (ev.ends_at || ev.starts_at)) || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(end)) return null;
  const ms = Date.parse(addDaysYMD(end, 10) + 'T23:59:59+07:00');
  return Number.isNaN(ms) ? null : ms;
}
// The leader link is active (can mark / re-mark) only inside [open, close].
function attendanceWindowActive(ev, at) {
  const now = at == null ? Date.now() : at;
  const open = attendanceOpenMs(ev); const close = correctionCloseMs(ev);
  if (open == null || close == null) return false;
  return now >= open && now <= close;
}
// A day is locked once the correction window has passed (leader/EO can no
// longer change it; only a super admin can, with a reason).
function attendanceLocked(ev, at) { const c = correctionCloseMs(ev); return c == null ? false : (at == null ? Date.now() : at) > c; }
// Random, long, unguessable link token — NOT derived from the event id, so the
// public URL leaks nothing about which event it belongs to.
function randomAttToken() { return crypto.randomBytes(24).toString('base64url'); }

// E: a talent's reliability snapshot for curation — events participated,
// non-emergency cancellations (with how close to the event the nearest one was),
// and no-shows. Emergency-flagged cancellations are excluded (admin-set).
// scopeEventIds: when provided (a Set), only count the talent's history within
// those events — so an EO sees reliability from THEIR OWN events only, never
// another organizer's data. Pass null for the platform super-admin (sees all).
function computeReliability(tid, apps, eventsById, scopeEventIds) {
  const mine = (apps || []).filter((a) => a.talent_id === tid && (!scopeEventIds || scopeEventIds.has(a.event_id)));
  const placed = (a) => ['approved', 'assigned', 'completed'].includes(a.status);
  const participated = mine.filter(placed).length;
  const cancels = mine.filter((a) => a.status === 'cancelled' && !a.cancel_is_emergency);
  let closestCancelDay = null;
  cancels.forEach((a) => {
    const ev = eventsById.get(a.event_id);
    if (ev && ev.starts_at && a.cancelled_at) {
      // "H-x" = whole WIB calendar days between the cancel date and the event date
      // (event parlance), not an hour-precise diff — so it's stable across the day.
      const eventYMD = String(ev.starts_at).slice(0, 10);
      const cancelYMD = new Date(a.cancelled_at).toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
      const days = Math.max(0, Math.round((Date.parse(eventYMD + 'T00:00:00Z') - Date.parse(cancelYMD + 'T00:00:00Z')) / 86400000));
      if (closestCancelDay == null || days < closestCancelDay) closestCancelDay = days;
    }
  });
  const now = Date.now();
  const noShows = mine.filter((a) => placed(a) && a.attended === false && (() => { const ev = eventsById.get(a.event_id); const s = ev ? eventStartMs(ev) : null; return s != null && s < now; })()).length;
  return { participated, cancels: cancels.length, closestCancelDay, noShows };
}

// === Tahap 6: attendance reliability + cross-EO privacy ====================
// ONE place that decides how much of a talent's attendance history a viewer may
// see (centralized so the rule can change later without hunting call sites):
//   - super admin: everything;
//   - the EO that owns the event: full detail (event name, note);
//   - any other EO: LIMITED — only date + position category + status. Never the
//     event name, the other EO's identity, or the keterangan.
function attendanceVisibility(viewerStaffId, ev, isSuperAdmin) {
  if (isSuperAdmin) return 'full';
  if (ev && ev.created_by && viewerStaffId && ev.created_by === viewerStaffId) return 'full';
  return 'limited';
}
// Six calendar months in ms (H expiry: an old no-notice stops being an ACTIVE
// warning after 6 months but is never deleted — still counted in the total).
const ATT_SIX_MONTHS_MS = 183 * 86400000;
function computeAttendanceReliability(talentId, attRows, eventsById, positionLabelById, viewerStaffId, isSuperAdmin, nowMs) {
  const now = nowMs == null ? Date.now() : nowMs;
  const agg = { present: 0, absentNotified: 0, absentNoNotice: 0, noNoticeActive: 0, events: 0 };
  const own = []; const other = [];
  const seenEvents = new Set();
  (attRows || []).forEach((a) => {
    if (a.talent_id !== talentId || !a.status) return;
    if (a.is_emergency) return; // Super-Admin-flagged emergency: excluded from the record
    seenEvents.add(a.event_id);
    if (a.status === 'present') agg.present++;
    else if (a.status === 'absent_notified') agg.absentNotified++;
    else if (a.status === 'absent_no_notice') {
      agg.absentNoNotice++;
      const dayMs = Date.parse(String(a.event_day) + 'T00:00:00+07:00');
      if (!Number.isNaN(dayMs) && (now - dayMs) <= ATT_SIX_MONTHS_MS) agg.noNoticeActive++;
    }
    const ev = eventsById.get(a.event_id) || null;
    const posLabel = positionLabelById.get(a.position_id) || null;
    if (attendanceVisibility(viewerStaffId, ev, isSuperAdmin) === 'full') {
      own.push({ eventName: ev ? ev.name : null, date: a.event_day, positionLabel: posLabel, status: a.status, note: a.status === 'absent_notified' ? (a.note || null) : null });
    } else {
      other.push({ date: a.event_day, positionCategory: posLabel, status: a.status });
    }
  });
  agg.events = seenEvents.size;
  own.sort((x, y) => String(y.date).localeCompare(String(x.date)));
  other.sort((x, y) => String(y.date).localeCompare(String(x.date)));
  return { agg, own, other, hasAny: (agg.present + agg.absentNotified + agg.absentNoNotice) > 0 };
}

// Build the apply context for one event + talent (positions, open slots, my application).
async function positionApplyCtx(st, ev, talentId) {
  const [positions, apps, choices] = await Promise.all([st.listEventPositions(ev.id), st.listApplications(), st.listApplicationChoices()]);
  const view = eoEventView(ev, positions, apps, choices);
  const openPositions = view.positions.filter((p) => !p.closed_at && !p.full);
  const posById = new Map(view.positions.map((p) => [p.position_id, p]));
  // Option B: ONE application per (talent, event) holding 1-3 ranked choices.
  // Map each chosen position to its choice row so the UI can show the rank +
  // status and block duplicate/over-limit applies.
  const myApp = talentId ? (apps.find((a) => a.talent_id === talentId && a.event_id === ev.id) || null) : null;
  const myChoices = myApp ? choices.filter((c) => c.application_id === myApp.id).slice().sort((a, b) => a.priority - b.priority) : [];
  const myByPosition = new Map(myChoices.map((c) => [String(c.position_id), c]));
  // A/D: standby designations for this talent + any pending substitute offer.
  let myStandby = [];
  let mySubOffer = null;
  if (myApp) {
    myStandby = (await st.listStandbyForApp(myApp.id)) || [];
    const subs = await st.listSubstitutions(ev.id);
    mySubOffer = subs.find((s) => s.incoming_application_id === myApp.id && s.state === 'offered') || null;
  }
  return { view, positions: view.positions, openPositions, posById, myApp, myChoices, myByPosition, regOpen: eventRegOpen(ev), cancelOpen: cancelWindowOpen(ev), standbyOpen: standbyWindowOpen(ev), myStandby, mySubOffer };
}

// Position-based EO events currently open to a talent: published, within the
// reg window, at least one free position. Shared by /events and the per-type
// talent lists (KOL page, Man Power dashboard) so EO events show up inline.
async function openPositionEvents(st, talentId) {
  const [events, apps, choices, staff] = await Promise.all([st.listEvents(), st.listApplications(), st.listApplicationChoices(), st.listStaff()]);
  const eoName = new Map(staff.map((s) => [s.id, s.name]));
  const myAppByEvent = new Map(apps.filter((a) => a.talent_id === talentId).map((a) => [a.event_id, a]));
  const open = [];
  for (const ev of events) {
    if (!eventRegOpen(ev)) continue;
    const positions = await st.listEventPositions(ev.id);
    if (!positions.length) continue;
    const view = eoEventView(ev, positions, apps, choices);
    const openPos = view.positions.filter((p) => !p.closed_at && !p.full);
    if (!openPos.length) continue;
    const myApp = myAppByEvent.get(ev.id) || null;
    open.push(Object.assign({}, ev, {
      openPositions: openPos, eoName: eoName.get(ev.created_by) || '',
      applied: !!myApp, myStatus: myApp ? myApp.status : null, status: eventStatusOf(ev),
    }));
  }
  open.sort((a, b) => String(a.reg_deadline || '9999').localeCompare(String(b.reg_deadline || '9999')));
  await attachMockups(st, open);
  return open;
}

// Lowercase haystack for one open event: name + location + EO name + each open
// position's key/labels — so a search matches by event name, city/location, the
// organizer, or the kind of role being hired (KOL, photographer, manpower…).
// Shared by the header search API and the /events catalog filter.
function eventSearchText(e) {
  const pos = (e.openPositions || []).map((p) => `${p.key || ''} ${p.label_id || ''} ${p.label_en || ''}`).join(' ');
  return `${e.name || ''} ${e.location || ''} ${e.eoName || ''} ${pos}`.toLowerCase();
}
const eventCity = (loc) => { const parts = String(loc || '').split(','); return (parts[parts.length - 1] || '').trim(); };
// City filter: keep events whose location contains the chosen city (empty = all).
const eventInCity = (e, city) => !city || String(e.location || '').toLowerCase().includes(String(city).toLowerCase());
// Distinct cities of a set of events, for the Location dropdown.
const eventCityList = (events) => Array.from(new Set((events || []).map((e) => eventCity(e.location)).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'id'));

// PUBLIC live event search (search-as-you-type for the landing header). Only
// events currently open for registration appear — the same live data as the
// landing "events open" section and the /events catalog. Filters by keyword
// (q) and/or Location (city). Returns a small JSON list for the dropdown; each
// result links to the public /event/:id detail.
app.get('/api/events/search', async (req, res) => {
  try {
    const st = db();
    const L = req.lang;
    const q = String(req.query.q || '').trim().toLowerCase();
    const city = String(req.query.city || '').trim();
    if (!st || (!q && !city)) return res.json({ results: [] });
    const open = await openPositionEvents(st, null);
    const results = open
      .filter((e) => (!q || eventSearchText(e).includes(q)) && eventInCity(e, city))
      .slice(0, 8)
      .map((e) => ({
        name: e.name,
        city: eventCity(e.location),
        url: '/event/' + (e.slug || e.id) + '?lang=' + L,
        thumb: e.mockup_url || null,
      }));
    res.json({ results });
  } catch (_) { res.json({ results: [] }); }
});

// Events open to talents: published, position-based, within reg window, with a
// free slot. Accepts ?q= (keyword) and ?city= (Location) from the header search.
app.get('/events', requireAnyTalentBrowse(), async (req, res, next) => {
  try {
    const st = db();
    if (!st) return needConfig(req, res);
    let open = await openPositionEvents(st, req.talent.id);
    const cities = eventCityList(open); // all open-event cities, for the Location dropdown
    const q = String(req.query.q || '').trim();
    const city = String(req.query.city || '').trim();
    if (q) { const ql = q.toLowerCase(); open = open.filter((e) => eventSearchText(e).includes(ql)); }
    if (city) { open = open.filter((e) => eventInCity(e, city)); }
    res.send(V.talentOpenEvents({ account: req.account, events: open, lang: req.lang, q, city, cities }));
  } catch (e) { next(e); }
});

// Resolve a position-based event by its UUID id or a friendly slug (e.g. "iss").
const findEventByRef = (events, ref) => (events || []).find((e) => e.id === ref || (e.slug && e.slug === ref));
// Prefer the slug in outgoing URLs so friendly links (…/event/iss) stick.
const eventRef = (ev) => (ev && ev.slug) || (ev && ev.id);

// PUBLIC: anyone can view an event's detail (positions, jobdesk, Open/Closed).
// Login is only required when they actually apply (POST /event/:id/apply).
app.get('/event/:id', optionalTalent(), async (req, res, next) => {
  try {
    const st = db();
    if (!st) return needConfig(req, res);
    const ev = findEventByRef(await st.listEvents(), req.params.id);
    // Logged-out visitors bounce to the public landing, not the login-gated catalog.
    const fallback = req.talent ? '/events' : '/';
    if (!ev) return res.redirect(fallback);
    const ctx = await positionApplyCtx(st, ev, req.talent ? req.talent.id : null);
    if (!ctx.positions.length) return res.redirect(fallback); // not a position-based event
    await attachMockups(st, ev);
    // D: an accepted talent sees their own attendance for this event (status per
    // day, who marked + when) and can request a correction. Only when accepted.
    let attendance = null;
    if (req.talent && ctx.myApp && ctx.myApp.status === 'approved' && (ctx.myChoices || []).some((c) => c.accepted)) {
      const accepted = ctx.myChoices.find((c) => c.accepted);
      const allRows = await st.listAttendanceForTalent(req.talent.id);
      const rows = allRows.filter((r) => r.application_id === ctx.myApp.id);
      const rowIds = new Set(rows.map((r) => r.id));
      const byDay = {}; rows.forEach((r) => { byDay[r.event_day] = r; });
      const corrections = (await st.listCorrectionsForTalent(req.talent.id)).filter((c) => rowIds.has(c.attendance_id));
      // I: graduated-sanction signal to the talent — active (within 6mo) no-notice
      // absences across ALL their events, excluding Super-Admin emergency flags.
      const nowMs = Date.now();
      let noNoticeActive = 0;
      allRows.forEach((r) => {
        if (r.is_emergency || r.status !== 'absent_no_notice') return;
        const dm = Date.parse(String(r.event_day) + 'T00:00:00+07:00');
        if (!Number.isNaN(dm) && (nowMs - dm) <= 183 * 86400000) noNoticeActive++;
      });
      attendance = { days: eventDays(ev), byDay, positionId: accepted ? accepted.position_id : null, corrections, active: attendanceWindowActive(ev), locked: attendanceLocked(ev), closeMs: correctionCloseMs(ev), noNoticeActive };
    }
    res.send(V.talentEventApply({ account: req.account || null, event: ev, ctx, lang: req.lang, saved: req.query.saved === '1', cancelFlash: String(req.query.cancel || ''), standbyFlash: String(req.query.standby || ''), subFlash: String(req.query.sub || ''), attendance, corrFlash: String(req.query.koreksi || '') }));
  } catch (e) { next(e); }
});


// D: an accepted talent asks the Super Admin to correct one of their attendance
// records — submits a reason; the record itself is never changed here (Tahap 5).
app.post('/event/:id/koreksi', requireAnyTalentReady(), async (req, res, next) => {
  try {
    const st = db();
    if (!st) return needConfig(req, res);
    const ev = findEventByRef(await st.listEvents(), req.params.id);
    if (!ev) return res.redirect('/events');
    const back = '/event/' + eventRef(ev) + '?lang=' + req.lang;
    const attId = String(req.body.attendance_id || '');
    const att = await st.getAttendanceById(attId);
    if (!att || att.talent_id !== req.talent.id || att.event_id !== ev.id) return res.redirect(back);
    const reason = String(req.body.reason || '').trim().slice(0, 600);
    if (reason.length < 3) return res.redirect(back + '&koreksi=empty');
    // One pending correction per record — silently coalesce repeat submits.
    const pending = (await st.listCorrectionsForTalent(req.talent.id)).find((c) => c.attendance_id === attId && c.state === 'pending');
    if (!pending) await st.createCorrection({ attendance_id: attId, talent_id: req.talent.id, reason });
    res.redirect(back + '&koreksi=sent');
  } catch (e) { next(e); }
});

app.post('/event/:id/apply', requireAnyTalentReady(), async (req, res, next) => {
  try {
    const st = db();
    if (!st) return needConfig(req, res);
    const ev = findEventByRef(await st.listEvents(), req.params.id);
    if (!ev) return res.redirect('/events');
    const ctx = await positionApplyCtx(st, ev, req.talent.id);
    if (!ctx.positions.length) return res.redirect('/events');
    // Option B: ONE application per (talent, event) holding 1-3 RANKED choices.
    // Rank = order of applying (1st position picked = choice 1, ...). Max 3.
    const positionId = String(req.body.position_id || '');
    const pos = ctx.posById.get(positionId);
    const fail = (key) => res.status(400).send(V.talentEventApply({ account: req.account, event: ev, ctx: Object.assign({}, ctx, { errors: [req.t(key)] }), lang: req.lang }));
    if (!pos) return fail('ta.err.notOpen');
    if (ctx.myByPosition.has(positionId)) return res.redirect('/event/' + eventRef(ev) + '?lang=' + req.lang); // already picked this position
    if (!ctx.regOpen) return fail('ta.err.closed');
    if (pos.closed_at || pos.full) return fail('ta.err.notOpen');
    if ((ctx.myChoices || []).length >= 3) return fail('ta.err.max3'); // max 3 ranked picks per event
    // Creator positions (KOL / photographer / videographer) require CV + portfolio on file.
    if (V.CREATOR_ROLES.includes(pos.key) && req.talent.type === 'kol' && !V.hasCreatorDocs(req.account)) return res.redirect('/dokumen?need=1&lang=' + req.lang);
    let appId = ctx.myApp ? ctx.myApp.id : null;
    if (!appId) {
      const app = await st.createApplication({ event_id: ev.id, talent_id: req.talent.id, talent_type: req.talent.type, role: null, answers: null });
      await st.updateApplication(app.id, { status: 'applied' });
      appId = app.id;
    }
    await st.addApplicationChoices(appId, [{ position_id: positionId, priority: (ctx.myChoices || []).length + 1 }]);
    res.redirect('/event/' + eventRef(ev) + '?lang=' + req.lang + '&saved=1');
  } catch (e) { next(e); }
});

app.post('/event/:id/cancel', requireAnyTalentReady(), async (req, res, next) => {
  try {
    const st = db();
    if (!st) return needConfig(req, res);
    const ev = findEventByRef(await st.listEvents(), req.params.id);
    if (!ev) return res.redirect('/events');
    const ctx = await positionApplyCtx(st, ev, req.talent.id);
    const posId = String(req.body.position_id || '');
    const choice = ctx.myByPosition.get(posId);
    const app = ctx.myApp;
    // Cancel one ranked pick while the application is still pending + reg open.
    // Remaining picks keep contiguous priorities; drop the whole application if none left.
    if (choice && app && ['applied', 'pending', 'under_review'].includes(app.status) && eventRegOpen(ev)) {
      const remaining = (ctx.myChoices || []).filter((c) => String(c.position_id) !== posId)
        .map((c, i) => ({ position_id: c.position_id, priority: i + 1 }));
      if (!remaining.length) await st.deleteApplication(app.id);
      else await st.replaceApplicationChoices(app.id, remaining);
    }
    res.redirect('/event/' + eventRef(ev) + '?lang=' + req.lang);
  } catch (e) { next(e); }
});

// K4: an accepted talent confirms (v=1) or clears (v=0) their availability for the
// position they were accepted into. Records confirmed_at; does not change quota.
app.post('/event/:id/confirm', requireAnyTalentReady(), async (req, res, next) => {
  try {
    const st = db();
    if (!st) return needConfig(req, res);
    const ev = findEventByRef(await st.listEvents(), req.params.id);
    if (!ev) return res.redirect('/events');
    const app = (await st.listApplicationsForTalent(req.talent.id)).find((a) => a.event_id === ev.id);
    if (app && app.status === 'approved') await st.setApplicationConfirmed(app.id, String(req.body.v || '1') === '1');
    res.redirect('/event/' + eventRef(ev) + '?lang=' + req.lang);
  } catch (e) { next(e); }
});

// Allowed cancellation reasons (talent-facing). 'other' pairs with a free-text note.
const CANCEL_REASONS = ['schedule_conflict', 'sick', 'family', 'changed_mind', 'other'];

// B: an accepted talent cancels their participation. Allowed only until H-1 day
// (24h before start), re-checked on the SERVER here AND inside the RPC. Runs as one
// transaction: free the slot, log the status change, notify the EO.
app.post('/event/:id/withdraw', requireAnyTalentReady(), async (req, res, next) => {
  try {
    const st = db();
    if (!st) return needConfig(req, res);
    const ev = findEventByRef(await st.listEvents(), req.params.id);
    if (!ev) return res.redirect('/events');
    const app = (await st.listApplicationsForTalent(req.talent.id)).find((a) => a.event_id === ev.id);
    if (!app || app.status !== 'approved') return res.redirect('/event/' + eventRef(ev) + '?lang=' + req.lang);
    // Server-side window guard (rule 5): closed within H-1 day → must contact EO.
    if (!cancelWindowOpen(ev)) return res.redirect('/event/' + eventRef(ev) + '?lang=' + req.lang + '&cancel=closed');
    const reason = CANCEL_REASONS.includes(String(req.body.reason || '')) ? String(req.body.reason) : 'other';
    const note = String(req.body.note || '').trim().slice(0, 300) || null;
    const outcome = await st.cancelApplicationTxn(app.id, reason, note, req.talent.id);
    if (outcome === 'closed') return res.redirect('/event/' + eventRef(ev) + '?lang=' + req.lang + '&cancel=closed');
    return res.redirect('/talent?lang=' + req.lang + '&cancel=done');
  } catch (e) { next(e); }
});

app.get('/kirim-bukti', requireTalentReady('kol'), async (req, res, next) => {
  try {
    const st = db();
    if (!st) return needConfig(req, res);
    const [events, allEvents, myProofs, myAssignments, settings] = await Promise.all([
      st.listActiveEvents(), st.listEvents(), st.listProofsForTalent(req.talent.id), st.listAssignmentsForTalent(req.talent.id), st.getSettings(),
    ]);
    const eventById = new Map(allEvents.map((e) => [e.id, e]));
    const assignments = myAssignments.map((a) => {
      const ev = eventById.get(a.event_id);
      if (!ev) return null;
      return { event_name: ev.name, ends_at: ev.ends_at, is_active: ev.is_active, hasProof: myProofs.some((p) => p.event_id === a.event_id && p.status !== 'rejected') };
    }).filter(Boolean);
    const proofs = await enrichProofs(st, myProofs, { events: allEvents });
    res.send(V.kolProofPage({ talent: req.account, events, proofs, assignments, lang: req.lang, settings }));
  } catch (e) { next(e); }
});

app.post('/kirim-bukti', requireTalentReady('kol'), upload.single('screenshot'), async (req, res, next) => {
  try {
    const st = db();
    if (!st) return needConfig(req, res);
    const eventId = String(req.body.event_id || '').trim();
    const postLink = String(req.body.post_link || '').trim();
    const file = req.file;

    const errors = [];
    if (!eventId) errors.push(req.t('err.eventRequired'));
    if (!file) errors.push(req.t('err.ssRequired'));
    else if (!/^image\//i.test(file.mimetype || '')) errors.push(req.t('err.fileMustBeImage'));
    if (postLink && !/^https?:\/\/.+/i.test(postLink)) errors.push(req.t('err.badLink'));

    if (errors.length) {
      const [events, myProofs] = await Promise.all([st.listActiveEvents(), st.listProofsForTalent(req.talent.id)]);
      const proofs = await enrichProofs(st, myProofs, { events });
      return res.status(400).send(V.kolProofPage({ talent: req.talent, events, proofs, errors, lang: req.lang }));
    }

    // Posting time from the datetime-local input, interpreted as WIB (UTC+7).
    const postedRaw = String(req.body.posted_at || '').trim();
    let postedAt = null;
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(postedRaw)) {
      const d = new Date((postedRaw.length === 16 ? postedRaw + ':00' : postedRaw) + '+07:00');
      if (!isNaN(d.getTime())) postedAt = d.toISOString();
    }

    const proofId = crypto.randomUUID();
    const ext = (path.extname(file.originalname || '').toLowerCase().match(/^\.[a-z0-9]{1,5}$/) || ['.jpg'])[0];
    const key = `proofs/${proofId}${ext}`;
    await st.uploadImage(key, file.buffer, file.mimetype);
    await st.createProof({
      id: proofId, talent_id: req.talent.id, talent_type: 'kol',
      event_id: eventId, screenshot_path: key, post_link: postLink || null, posted_at: postedAt, status: 'pending',
    });

    runExtraction(st, proofId, file.buffer, file.mimetype); // fire-and-forget
    res.redirect('/kirim-bukti');
  } catch (e) { next(e); }
});

// ------------------------------------------------------------ Man Power ----
// Man Power talents self-apply to events that open MP slots. An application
// (jobdesk + SOW agreement + answers) is reviewed by the Super Admin.

// Active events opening MP slots, each with remaining slots (quota − approved).
function mpOpenEvents(events, allApps) {
  const approvedByEvent = new Map();
  (allApps || []).forEach((a) => {
    if (a.talent_type === 'main_power' && a.status === 'approved') {
      approvedByEvent.set(a.event_id, (approvedByEvent.get(a.event_id) || 0) + 1);
    }
  });
  return (events || [])
    .filter((e) => e.is_active && (e.needs || []).some((n) => n.talent_type === 'main_power'))
    .map((e) => {
      const need = (e.needs || []).find((n) => n.talent_type === 'main_power');
      const headcount = (need && need.headcount) || 0;
      return { id: e.id, name: e.name, starts_at: e.starts_at, ends_at: e.ends_at, mp_sow: e.mp_sow, headcount, slotsLeft: Math.max(0, headcount - (approvedByEvent.get(e.id) || 0)) };
    });
}

app.get('/main-power/register', (req, res) => res.redirect('/register' + (req.query.lang ? '?lang=' + req.query.lang : '')));

app.post('/main-power/register', talentRegisterPost('main_power', { unified: true }));

app.get('/main-power/login', (req, res) => res.redirect('/login/talent?lang=' + req.lang));

app.post('/main-power/login', async (req, res, next) => {
  try {
    const st = db();
    if (!st) return needConfig(req, res);
    const login = String(req.body.login || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    const account = await st.findAccount('main_power', login);
    if (!account || !auth.verifyPassword(password, account.password_hash)) {
      return res.status(401).send(V.talentLogin('main_power', { unified: true, errors: [req.t('err.badTalentCreds')], values: { login }, lang: req.lang }));
    }
    auth.setSession(res, account);
    res.redirect('/talent');
  } catch (e) { next(e); }
});

// Man Power home body (rendered from the unified /talent route).
async function renderMpHome(req, res, st) {
  const [events, allApps, myApps] = await Promise.all([
    st.listEvents(), st.listApplications(), st.listApplicationsForTalent(req.talent.id),
  ]);
  const eventName = new Map(events.map((e) => [e.id, e.name]));
  const appliedEventIds = new Set(myApps.map((a) => a.event_id));
  const openEvents = mpOpenEvents(events, allApps).filter((e) => !appliedEventIds.has(e.id));
  const myAppsEnriched = myApps.map((a) => ({ ...a, event_name: eventName.get(a.event_id) || null }));
  const eoEvents = await openPositionEvents(st, req.talent.id);
  res.send(V.mainPowerDashboard({ talent: req.talent, openEvents, eoEvents, myApps: myAppsEnriched, lang: req.lang, applied: req.query.applied === '1' }));
}

app.get('/lamar/:eventId', requireTalentReady('main_power'), async (req, res, next) => {
  try {
    const st = db();
    if (!st) return needConfig(req, res);
    const [events, myApps] = await Promise.all([st.listEvents(), st.listApplicationsForTalent(req.talent.id)]);
    const ev = events.find((e) => e.id === req.params.eventId);
    const isOpen = ev && ev.is_active && (ev.needs || []).some((n) => n.talent_type === 'main_power');
    if (!isOpen || myApps.some((a) => a.event_id === req.params.eventId)) return res.redirect('/talent?lang=' + req.lang);
    res.send(V.mainPowerApply({ talent: req.talent, event: ev, customSow: ev.mp_sow, lang: req.lang }));
  } catch (e) { next(e); }
});

app.post('/lamar/:eventId', requireTalentReady('main_power'), async (req, res, next) => {
  try {
    const st = db();
    if (!st) return needConfig(req, res);
    const events = await st.listEvents();
    const ev = events.find((e) => e.id === req.params.eventId);
    const isOpen = ev && ev.is_active && (ev.needs || []).some((n) => n.talent_type === 'main_power');
    if (!isOpen) return res.redirect('/talent?lang=' + req.lang);

    const role = String(req.body.role || '').trim();
    const agree = req.body.agree === '1' || req.body.agree === 'on';
    const answers = {
      q1: String(req.body.q1 || '').slice(0, 24),
      q2: String(req.body.q2 || '').slice(0, 24),
      q3: String(req.body.q3 || '').trim().slice(0, 1000),
      q4: String(req.body.q4 || '').slice(0, 24),
    };
    const errors = [];
    if (!V.MP_JOBDESKS.includes(role)) errors.push(req.t('mp.err.roleRequired'));
    if (!agree) errors.push(req.t('mp.err.sowRequired'));
    if (errors.length) {
      return res.status(400).send(V.mainPowerApply({ talent: req.talent, event: ev, customSow: ev.mp_sow, lang: req.lang, errors, values: { role, agree, ...answers } }));
    }
    // Main Power keeps its "one SOW application per event" rule (role-based).
    // Guard duplicates explicitly now that createApplication allows multiples.
    const dupMp = (await st.listApplicationsForTalent(req.talent.id)).some((a) => a.event_id === ev.id && a.role);
    if (dupMp) return res.redirect('/talent?lang=' + req.lang);
    await st.createApplication({ event_id: ev.id, talent_id: req.talent.id, talent_type: 'main_power', role, answers });
    res.send(V.mainPowerApplyDone({ event: ev, lang: req.lang }));
  } catch (e) { next(e); }
});

// -------------------------------------------------------- password reset ----
// Self-service "forgot password": request a reset link (per talent type), then
// set a new password via a one-time, 1-hour token delivered by email. The
// request response is always the same (no account enumeration).

// Email is unique across talent types, so the reset request is type-agnostic:
// look the account up by login and mail the link. Response is always identical.
async function forgotPostAny(req, res, next) {
  try {
    const st = db();
    if (!st) return needConfig(req, res);
    const login = String(req.body.login || '').trim().toLowerCase();
    if (login) {
      const account = await st.findAccountByLogin(login);
      if (account && auth.TALENT_TYPES.includes(account.talent_type)) {
        const token = crypto.randomBytes(32).toString('hex');
        const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
        const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
        await st.createPasswordReset({ talent_id: account.id, token_hash: tokenHash, expires_at: expiresAt });
        const base = (process.env.APP_BASE_URL || (req.protocol + '://' + req.get('host'))).replace(/\/+$/, '');
        const link = base + '/reset-password?token=' + token;
        try { await mailer.sendResetEmail({ to: account.login, name: account.name, link, lang: req.lang }); }
        catch (e) { console.error('[reset-mail]', (e && e.message) || e); }
      }
    }
    res.send(V.forgotPasswordSent({ lang: req.lang }));
  } catch (e) { next(e); }
}
app.get('/forgot-password', (req, res) => res.send(V.forgotPassword('kol', { lang: req.lang })));
app.post('/forgot-password', forgotPostAny);
// Back-compat: old role-prefixed forgot-password URLs.
app.get('/kol/forgot-password', (req, res) => res.redirect('/forgot-password' + (req.query.lang ? '?lang=' + req.query.lang : '')));
app.get('/main-power/forgot-password', (req, res) => res.redirect('/forgot-password' + (req.query.lang ? '?lang=' + req.query.lang : '')));
app.post('/kol/forgot-password', forgotPostAny);
app.post('/main-power/forgot-password', forgotPostAny);

async function validResetToken(st, token) {
  if (!token || token.length < 32) return null;
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const r = await st.getPasswordReset(tokenHash);
  if (!r || r.used_at) return null;
  if (new Date(r.expires_at).getTime() < Date.now()) return null;
  return r;
}

app.get('/reset-password', async (req, res, next) => {
  try {
    const st = db();
    if (!st) return needConfig(req, res);
    const token = String(req.query.token || '');
    const reset = await validResetToken(st, token);
    res.send(V.resetPassword({ token, valid: !!reset, lang: req.lang }));
  } catch (e) { next(e); }
});

app.post('/reset-password', async (req, res, next) => {
  try {
    const st = db();
    if (!st) return needConfig(req, res);
    const token = String(req.body.token || '');
    const reset = await validResetToken(st, token);
    if (!reset) return res.status(400).send(V.resetPassword({ token, valid: false, lang: req.lang }));
    const password = String(req.body.password || '');
    const confirm = String(req.body.confirm || '');
    const errors = [];
    if (password.length < 6) errors.push(req.t('err.passwordMin6'));
    if (password !== confirm) errors.push(req.t('err.passwordMismatch'));
    if (errors.length) return res.status(400).send(V.resetPassword({ token, valid: true, errors, lang: req.lang }));
    await st.setTalentPassword(reset.talent_id, auth.hashPassword(password));
    await st.markPasswordResetUsed(reset.id);
    const account = await st.getAccountById(reset.talent_id);
    res.send(V.resetPasswordDone({ type: account ? account.talent_type : 'kol', lang: req.lang }));
  } catch (e) { next(e); }
});

// ----------------------------------------------------------------- admin ----

// Where a signed-in staff member belongs, based on their role.
function staffHome(type) { return type === 'eo' ? '/eo' : '/admin'; }

app.get('/admin/login', (req, res) => {
  const t = auth.anySession(req, ['super_admin', 'eo']);
  if (t) return res.redirect(staffHome(t.type));
  res.send(V.staffLogin({ lang: req.lang, variant: 'admin' }));
});

app.get('/login/eo', (req, res) => {
  const t = auth.anySession(req, ['super_admin', 'eo']);
  if (t) return res.redirect(staffHome(t.type));
  res.send(V.staffLogin({ lang: req.lang, variant: 'eo' }));
});
// /eo/login kept as an alias of the canonical /login/eo.
app.get('/eo/login', (req, res) => res.redirect('/login/eo' + (req.query.lang ? '?lang=' + req.query.lang : '')));

// Both staff login links authenticate against the same staff_accounts. The
// account's role (not which URL was used) decides permissions, so either link
// is safe for any staff member — they just land on the same role-aware dashboard.
function staffLoginHandler(variant) {
  return async (req, res, next) => {
    try {
      const st = db();
      if (!st) return needConfig(req, res);
      const login = String(req.body.login || '').trim().toLowerCase();
      const password = String(req.body.password || '');
      const staff = await st.findStaff(login);
      if (!staff || !auth.verifyPassword(password, staff.password_hash)) {
        return res.status(401).send(V.staffLogin({ errors: [req.t('err.badStaffCreds')], values: { login }, lang: req.lang, variant }));
      }
      if (staff.status === 'suspended') {
        return res.status(403).send(V.staffLogin({ errors: [req.t('eo.err.suspended')], values: { login }, lang: req.lang, variant }));
      }
      auth.setSession(res, staff);
      res.redirect(staffHome(staff.role));
    } catch (e) { next(e); }
  };
}
app.post('/admin/login', staffLoginHandler('admin'));
app.post('/login/eo', staffLoginHandler('eo'));
app.post('/eo/login', staffLoginHandler('eo')); // alias for stale forms

// EO self-registration: an EO creates their own account, then completes their
// profile before they can create events.
app.get('/eo/register', (req, res) => {
  if (auth.anySession(req, ['eo'])) return res.redirect('/eo');
  res.send(V.eoRegister({ lang: req.lang }));
});
app.post('/eo/register', async (req, res, next) => {
  try {
    const st = db();
    if (!st) return needConfig(req, res);
    const c = (k, max) => String(req.body[k] || '').trim().slice(0, max);
    const org_type = c('org_type', 20);
    const org_name = c('org_name', 140);
    const pic_name = c('pic_name', 140);
    const login = c('login', 160).toLowerCase();
    const phone = c('phone', 40);
    const province = c('province', 60);
    const city = c('city', 100);
    const description = c('description', 1000);
    const password = String(req.body.password || '');
    const password2 = String(req.body.password2 || '');
    const values = { org_type, org_name, pic_name, login, phone, province, city, description };
    const errors = [];
    if (!EO_ORG_TYPES.includes(org_type)) errors.push(req.t('eo.reg.err.type'));
    if (!org_name) errors.push(req.t('eo.reg.err.orgName'));
    if (!pic_name) errors.push(req.t('eo.reg.err.pic'));
    if (!login) errors.push(req.t('err.emailRequired'));
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(login)) errors.push(req.t('err.emailInvalid'));
    if (!phone) errors.push(req.t('eo.reg.err.phone'));
    if (!V.PROVINCES.includes(province)) errors.push(req.t('dd.err.province'));
    if (!city) errors.push(req.t('dd.err.city'));
    if (!description) errors.push(req.t('eo.err.desc'));
    if (password.length < 6) errors.push(req.t('err.passwordMin6'));
    else if (password !== password2) errors.push(req.t('err.passwordMismatch'));
    if (errors.length) return res.status(400).send(V.eoRegister({ lang: req.lang, errors, values }));
    let staff;
    try {
      // Account is active immediately — no email verification step.
      staff = await st.createStaff({ role: 'eo', name: org_name, login, password_hash: auth.hashPassword(password), status: 'active' });
    } catch (e) {
      if (e.code === 'DUP') return res.status(400).send(V.eoRegister({ lang: req.lang, errors: [req.t('eo.reg.err.dup')], values }));
      throw e;
    }
    // Full profile (incl. description) is captured at signup, so it's complete right away.
    await st.upsertEoProfile(staff.id, { org_type, org_name, pic_name, email: login, phone, province, city, description, completed_at: new Date().toISOString() });
    auth.setSession(res, staff);
    res.redirect('/eo');
  } catch (e) { next(e); }
});

// --- Staff (EO / super admin) forgot + reset password ------------------------
// Mirrors the talent flow but against staff_accounts + staff_password_resets.
function staffForgotPost() {
  return async (req, res, next) => {
    try {
      const st = db();
      if (!st) return needConfig(req, res);
      const login = String(req.body.login || '').trim().toLowerCase();
      if (login) {
        const staff = await st.findStaff(login);
        if (staff) {
          const token = crypto.randomBytes(32).toString('hex');
          const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
          const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
          await st.createStaffPasswordReset({ staff_id: staff.id, token_hash: tokenHash, expires_at: expiresAt });
          const base = (process.env.APP_BASE_URL || (req.protocol + '://' + req.get('host'))).replace(/\/+$/, '');
          const link = base + '/staff/reset-password?token=' + token;
          try { await mailer.sendResetEmail({ to: staff.login, name: staff.name, link, lang: req.lang }); }
          catch (e) { console.error('[staff-reset-mail]', (e && e.message) || e); }
        }
      }
      res.send(V.staffForgotSent({ lang: req.lang }));
    } catch (e) { next(e); }
  };
}
app.get('/eo/forgot-password', (req, res) => res.send(V.staffForgot({ variant: 'eo', lang: req.lang })));
app.post('/eo/forgot-password', staffForgotPost());
app.get('/admin/forgot-password', (req, res) => res.send(V.staffForgot({ variant: 'admin', lang: req.lang })));
app.post('/admin/forgot-password', staffForgotPost());

async function validStaffResetToken(st, token) {
  if (!token || token.length < 32) return null;
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const r = await st.getStaffPasswordReset(tokenHash);
  if (!r || r.used_at) return null;
  if (new Date(r.expires_at).getTime() < Date.now()) return null;
  return r;
}

app.get('/staff/reset-password', async (req, res, next) => {
  try {
    const st = db();
    if (!st) return needConfig(req, res);
    const token = String(req.query.token || '');
    const reset = await validStaffResetToken(st, token);
    res.send(V.staffReset({ token, valid: !!reset, lang: req.lang }));
  } catch (e) { next(e); }
});

app.post('/staff/reset-password', async (req, res, next) => {
  try {
    const st = db();
    if (!st) return needConfig(req, res);
    const token = String(req.body.token || '');
    const reset = await validStaffResetToken(st, token);
    if (!reset) return res.status(400).send(V.staffReset({ token, valid: false, lang: req.lang }));
    const password = String(req.body.password || '');
    const confirm = String(req.body.confirm || '');
    const errors = [];
    if (password.length < 6) errors.push(req.t('err.passwordMin6'));
    if (password !== confirm) errors.push(req.t('err.passwordMismatch'));
    if (errors.length) return res.status(400).send(V.staffReset({ token, valid: true, errors, lang: req.lang }));
    await st.setStaffPassword(reset.staff_id, auth.hashPassword(password));
    await st.markStaffPasswordResetUsed(reset.id);
    res.send(V.staffResetDone({ lang: req.lang }));
  } catch (e) { next(e); }
});

// Each staff area logs out only its own session, so signing out of EO doesn't
// touch a Super Admin session open in another tab (and vice versa).
app.post('/admin/logout', (req, res) => { auth.clearSession(res, 'super_admin'); res.redirect('/admin/login'); });
app.post('/eo/logout', (req, res) => { auth.clearSession(res, 'eo'); res.redirect('/login/eo'); });

// ------------------------------------------------------------------- EO ----
// Event Organizer area. EO staff see only their own data (events created_by
// them, and applications to those events). Profile must be complete before an
// EO can create events (enforced in the event phase; surfaced as a reminder here).
const requireEo = auth.requireStaff(['eo']);

function eoCtx(req) { return { role: 'eo', name: req.staff.name }; }

// Required EO profile fields; profile is "complete" only when all are filled.
const EO_ORG_TYPES = ['company', 'community', 'individual'];
const EO_REQUIRED = ['org_type', 'org_name', 'pic_name', 'email', 'phone', 'city', 'description'];
function eoProfileComplete(p) { return !!(p && EO_REQUIRED.every((k) => String(p[k] || '').trim())); }

// Dashboard summary numbers, scoped to one EO's events.
async function eoStats(st, staffId) {
  const [allEvents, allApps] = await Promise.all([st.listEvents(), st.listApplications()]);
  const mine = allEvents.filter((e) => e.created_by === staffId);
  const myIds = new Set(mine.map((e) => e.id));
  const apps = allApps.filter((a) => myIds.has(a.event_id));
  const accepted = new Set(['approved', 'assigned', 'completed']);
  return {
    totalEvents: mine.length,
    activeEvents: mine.filter((e) => e.is_active && !e.completed_at).length,
    totalApplies: apps.length,
    accepted: apps.filter((a) => accepted.has(a.status)).length,
    doneEvents: mine.filter((e) => e.completed_at).length,
  };
}

app.get('/eo', requireEo, async (req, res, next) => {
  try {
    const st = db();
    if (!st) return needConfig(req, res);
    const [stats, profile] = await Promise.all([eoStats(st, req.staff.id), st.getEoProfile(req.staff.id)]);
    res.send(V.eoDashboard({ staff: eoCtx(req), stats, profileComplete: eoProfileComplete(profile), lang: req.lang }));
  } catch (e) { next(e); }
});

app.get('/eo/profile', requireEo, async (req, res, next) => {
  try {
    const st = db();
    if (!st) return needConfig(req, res);
    const [profile0, staffRec] = await Promise.all([st.getEoProfile(req.staff.id), st.getStaffById(req.staff.id)]);
    const profile = profile0 || {};
    // Pre-fill for a first-time profile; email always mirrors the login (read-only).
    if (!profile.org_name) profile.org_name = req.staff.name || '';
    profile.email = profile.email || (staffRec && staffRec.login) || '';
    res.send(V.eoProfile({ staff: eoCtx(req), profile, saved: req.query.saved === '1', lang: req.lang }));
  } catch (e) { next(e); }
});

app.post('/eo/profile', requireEo, async (req, res, next) => {
  try {
    const st = db();
    if (!st) return needConfig(req, res);
    const clean = (k, max) => String(req.body[k] || '').trim().slice(0, max);
    const patch = {
      org_type: clean('org_type', 20),
      org_name: clean('org_name', 140),
      pic_name: clean('pic_name', 140),
      phone: clean('phone', 40),
      province: clean('province', 60),
      city: clean('city', 100),
      description: clean('description', 1000),
    };
    const [existing, staffRec] = await Promise.all([st.getEoProfile(req.staff.id), st.getStaffById(req.staff.id)]);
    const ex = existing || {};
    // Email is the login credential — read-only; never changed from the profile form.
    patch.email = ex.email || (staffRec && staffRec.login) || '';
    const errors = [];
    if (!EO_ORG_TYPES.includes(patch.org_type)) errors.push(req.t('eo.reg.err.type'));
    if (!patch.org_name) errors.push(req.t('eo.err.orgName'));
    if (!patch.pic_name) errors.push(req.t('eo.reg.err.pic'));
    if (!patch.phone) errors.push(req.t('eo.reg.err.phone'));
    if (!V.PROVINCES.includes(patch.province)) errors.push(req.t('dd.err.province'));
    if (!patch.city) errors.push(req.t('dd.err.city'));
    if (!patch.description) errors.push(req.t('eo.err.desc'));
    if (errors.length) {
      return res.status(400).send(V.eoProfile({ staff: eoCtx(req), profile: Object.assign({}, ex, patch), errors, lang: req.lang }));
    }
    patch.completed_at = ex.completed_at || new Date().toISOString();
    await st.upsertEoProfile(req.staff.id, patch);
    res.redirect('/eo/profile?saved=1');
  } catch (e) { next(e); }
});

// --- EO: event management ---------------------------------------------------
const EO_STATUSES = ['draft', 'published']; // EO-settable; 'closed' comes from the close button

// Load an EO's own event by id, or null if not theirs.
async function eoOwnedEvent(st, staffId, eventId) {
  return (await st.listEvents()).find((e) => e.id === eventId && e.created_by === staffId) || null;
}
const POS_DETAIL_KEYS = ['work_hours', 'venue_detail', 'dresscode', 'meeting_point', 'kol_content', 'kol_deadline', 'kol_min_followers', 'kol_hashtags', 'photo_output', 'photo_deadline', 'photo_equipment'];
function eoSelMap(positions) {
  const m = {};
  (positions || []).forEach((p) => {
    const o = { quota: p.quota, jobdesk: p.jobdesk || '', requirement: p.requirement || '', fee: p.fee || '' };
    POS_DETAIL_KEYS.forEach((k) => { o[k] = p[k] || ''; });
    m[p.position_id] = o;
  });
  return m;
}

// Per-event view: opened positions with filled(accepted)/applicants/quota, apply count, display status.
function eoEventView(ev, positions, apps, choices) {
  const evApps = apps.filter((a) => a.event_id === ev.id);
  const appIds = new Set(evApps.map((a) => a.id));
  const evChoices = (choices || []).filter((c) => appIds.has(c.application_id));
  const filled = {}; const applicants = {};
  evChoices.forEach((c) => { applicants[c.position_id] = (applicants[c.position_id] || 0) + 1; if (c.accepted) filled[c.position_id] = (filled[c.position_id] || 0) + 1; });
  const pos = (positions || []).map((p) => { const f = filled[p.position_id] || 0; return Object.assign({}, p, { filled: f, applicants: applicants[p.position_id] || 0, full: p.quota > 0 && f >= p.quota }); });
  const allFull = pos.length > 0 && pos.every((p) => p.full);
  let display;
  if (ev.completed_at) display = 'done';
  else if (ev.status === 'draft') display = 'draft';
  else if (ev.status === 'closed' || ev.reg_closed_at || allFull) display = 'closed';
  else display = 'published';
  return { applyCount: evApps.length, positions: pos, allFull, status: display };
}

// Parse the create/edit event form. positionsMaster gives the valid position ids.
function parseEventForm(req, positionsMaster) {
  const s = (k, max) => String(req.body[k] || '').trim().slice(0, max);
  const st = s('status', 12);
  const data = {
    name: s('name', 140), description: s('description', 4000) || null, category: s('category', 80) || null,
    location: s('location', 200) || null, starts_at: s('starts_at', 10) || null, ends_at: s('ends_at', 10) || null,
    start_time: s('start_time', 5) || null, end_time: s('end_time', 5) || null,
    reg_open: s('reg_open', 10) || null, reg_deadline: s('reg_deadline', 10) || null,
    status: EO_STATUSES.includes(st) ? st : 'draft',
  };
  const validIds = new Set((positionsMaster || []).map((p) => p.id));
  const keyById = new Map((positionsMaster || []).map((p) => [String(p.id), p.key]));
  const chosen = [].concat(req.body.pos || []);
  const seen = new Set(); const positions = [];
  chosen.forEach((id) => {
    id = String(id);
    if (!validIds.has(id) || seen.has(id)) return;
    const q = Math.max(0, parseInt(req.body['quota_' + id], 10) || 0);
    if (q <= 0) return;
    // Per-field getter (trim + cap length; empty -> null).
    const g = (f, max) => String(req.body[f + '_' + id] || '').trim().slice(0, max) || null;
    const key = keyById.get(id);
    const pos = {
      position_id: id, quota: q,
      jobdesk: g('jobdesk', 1000), requirement: g('requirement', 1000), fee: g('fee', 200),
      // General extra fields (all categories).
      work_hours: g('work_hours', 120), venue_detail: g('venue_detail', 200),
      dresscode: g('dresscode', 400), meeting_point: g('meeting_point', 400),
      // Category-specific fields are only stored for the matching position type.
      kol_content: null, kol_deadline: null, kol_min_followers: null, kol_hashtags: null,
      photo_output: null, photo_deadline: null, photo_equipment: null,
    };
    if (key === 'kol') { pos.kol_content = g('kol_content', 200); pos.kol_deadline = g('kol_deadline', 120); pos.kol_min_followers = g('kol_min_followers', 120); pos.kol_hashtags = g('kol_hashtags', 400); }
    if (key === 'fotografer') { pos.photo_output = g('photo_output', 300); pos.photo_deadline = g('photo_deadline', 120); pos.photo_equipment = g('photo_equipment', 400); }
    seen.add(id); positions.push(pos);
  });
  return { data, positions, echo: Object.assign({}, data, { positions }) };
}
function validateEventForm(f, req) {
  const e = [];
  if (!f.data.name) e.push(req.t('eo.ev.err.name'));
  if (!f.data.category) e.push(req.t('eo.ev.err.category'));
  if (!f.data.location) e.push(req.t('eo.ev.err.location'));
  if (!f.data.starts_at) e.push(req.t('eo.ev.err.date'));
  // Start time (WIB) is now required — the H-1 day / H-12 hour cutoffs depend on it.
  if (!f.data.start_time || !/^\d{2}:\d{2}$/.test(String(f.data.start_time))) e.push(req.t('eo.ev.err.startTime'));
  if (!f.positions.length) e.push(req.t('eo.ev.err.positions'));
  return e;
}

app.get('/eo/events', requireEo, async (req, res, next) => {
  try {
    const st = db();
    if (!st) return needConfig(req, res);
    const [events, apps, choices] = await Promise.all([st.listEvents(), st.listApplications(), st.listApplicationChoices()]);
    const mine = events.filter((e) => e.created_by === req.staff.id);
    const withView = await Promise.all(mine.map(async (e) => Object.assign(e, { view: eoEventView(e, await st.listEventPositions(e.id), apps, choices) })));
    await attachMockups(st, withView);
    const profile = await st.getEoProfile(req.staff.id);
    res.send(V.eoEvents({ staff: eoCtx(req), events: withView, profileComplete: eoProfileComplete(profile), lang: req.lang }));
  } catch (e) { next(e); }
});

app.get('/eo/events/new', requireEo, async (req, res, next) => {
  try {
    const st = db();
    if (!st) return needConfig(req, res);
    if (!eoProfileComplete(await st.getEoProfile(req.staff.id))) return res.redirect('/eo/profile');
    const positionsMaster = await st.listPositions();
    res.send(V.eoEventForm({ staff: eoCtx(req), event: null, positionsMaster, selected: {}, lang: req.lang }));
  } catch (e) { next(e); }
});

app.post('/eo/events', requireEo, upload.single('poster'), async (req, res, next) => {
  try {
    const st = db();
    if (!st) return needConfig(req, res);
    if (!eoProfileComplete(await st.getEoProfile(req.staff.id))) return res.redirect('/eo/profile');
    const positionsMaster = await st.listPositions();
    const f = parseEventForm(req, positionsMaster);
    const errors = validateEventForm(f, req);
    if (errors.length) return res.status(400).send(V.eoEventForm({ staff: eoCtx(req), event: f.echo, positionsMaster, selected: eoSelMap(f.positions), errors, lang: req.lang }));
    const ev = await st.createEvent(Object.assign({}, f.data, { created_by: req.staff.id }));
    if (ev && ev.id) {
      await st.setEventPositions(ev.id, f.positions);
      const poster = await saveMockup(st, ev.id, req.file); if (poster) await st.updateEvent(ev.id, { mockup_path: poster });
    }
    res.redirect('/eo/events');
  } catch (e) { next(e); }
});

app.get('/eo/events/:id/edit', requireEo, async (req, res, next) => {
  try {
    const st = db();
    if (!st) return needConfig(req, res);
    const ev = await eoOwnedEvent(st, req.staff.id, req.params.id);
    if (!ev) return res.redirect('/eo/events');
    const [positionsMaster, evPos] = await Promise.all([st.listPositions(), st.listEventPositions(ev.id)]);
    await attachMockups(st, ev);
    res.send(V.eoEventForm({ staff: eoCtx(req), event: ev, positionsMaster, selected: eoSelMap(evPos), lang: req.lang }));
  } catch (e) { next(e); }
});

app.post('/eo/events/:id/edit', requireEo, upload.single('poster'), async (req, res, next) => {
  try {
    const st = db();
    if (!st) return needConfig(req, res);
    const ev = await eoOwnedEvent(st, req.staff.id, req.params.id);
    if (!ev) return res.redirect('/eo/events');
    const [positionsMaster, evPos, apps, choices] = await Promise.all([st.listPositions(), st.listEventPositions(ev.id), st.listApplications(), st.listApplicationChoices()]);
    const f = parseEventForm(req, positionsMaster);
    const errors = validateEventForm(f, req);
    // Guards: a position with applicants can't be removed; quota can't drop below accepted.
    const view = eoEventView(ev, evPos, apps, choices);
    const newByPos = eoSelMap(f.positions);
    view.positions.forEach((p) => {
      if (p.applicants > 0 && !(p.position_id in newByPos)) errors.push(req.t('eo.ev.err.cantRemovePos'));
      if (p.position_id in newByPos && newByPos[p.position_id].quota < p.filled) errors.push(req.t('eo.ev.err.quotaBelowAccepted'));
    });
    if (errors.length) return res.status(400).send(V.eoEventForm({ staff: eoCtx(req), event: Object.assign({}, ev, f.echo), positionsMaster, selected: newByPos, errors, lang: req.lang }));
    const patch = Object.assign({}, f.data);
    const poster = await saveMockup(st, ev.id, req.file); if (poster) patch.mockup_path = poster;
    await st.updateEvent(ev.id, patch);
    await st.setEventPositions(ev.id, f.positions);
    res.redirect('/eo/events');
  } catch (e) { next(e); }
});

app.post('/eo/events/:id/close', requireEo, async (req, res, next) => {
  try {
    const st = db();
    if (!st) return needConfig(req, res);
    const ev = await eoOwnedEvent(st, req.staff.id, req.params.id);
    if (ev) await st.updateEvent(ev.id, req.body.reopen ? { status: 'published', reg_closed_at: null } : { status: 'closed', reg_closed_at: new Date().toISOString() });
    res.redirect('/eo/events');
  } catch (e) { next(e); }
});

// Delete only if the event has no applicants; otherwise close it (never drop someone's application).
app.post('/eo/events/:id/delete', requireEo, async (req, res, next) => {
  try {
    const st = db();
    if (!st) return needConfig(req, res);
    const ev = await eoOwnedEvent(st, req.staff.id, req.params.id);
    if (ev) {
      const hasApplicants = (await st.listApplications()).some((a) => a.event_id === ev.id);
      if (hasApplicants) await st.updateEvent(ev.id, { status: 'closed', reg_closed_at: new Date().toISOString() });
      else await st.deleteEvent(ev.id);
    }
    res.redirect('/eo/events');
  } catch (e) { next(e); }
});

app.get('/eo/events/:id', requireEo, async (req, res, next) => {
  try {
    const st = db();
    if (!st) return needConfig(req, res);
    const ev = await eoOwnedEvent(st, req.staff.id, req.params.id);
    if (!ev) return res.redirect('/eo/events');
    const [positions, apps, choices, talents, allEvents] = await Promise.all([
      st.listEventPositions(ev.id), st.listApplications(), st.listApplicationChoices(), st.listTalents(), st.listEvents(),
    ]);
    const eventsById = new Map(allEvents.map((x) => [x.id, x]));
    // Data isolation: reliability counts only THIS EO's own events, never another organizer's.
    const myEventIds = new Set(allEvents.filter((x) => x.created_by === req.staff.id).map((x) => x.id));
    const view = eoEventView(ev, positions, apps, choices);
    // Tahap 6: applicants for this event, each with their prioritised choices + contact.
    const talentById = new Map(talents.map((tt) => [tt.id, tt]));
    const choicesByApp = new Map();
    choices.forEach((c) => { const a = choicesByApp.get(c.application_id) || []; a.push(c); choicesByApp.set(c.application_id, a); });
    // #7: as soon as the owning EO opens the applicant list, move this event's
    // still-new applications to "under_review" so the talent's tracker lights up
    // the Review stage. Idempotent — only touches applied/pending rows.
    for (const a of apps) {
      if (a.event_id === ev.id && (a.status === 'applied' || a.status === 'pending') && (choicesByApp.get(a.id) || []).length) {
        await st.updateApplication(a.id, { status: 'under_review' }); a.status = 'under_review';
      }
    }
    const applicantApps = apps.filter((a) => a.event_id === ev.id && (choicesByApp.get(a.id) || []).length);
    // Tahap 6: attendance history for each applicant, across ALL organizers, with
    // cross-EO privacy applied inside computeAttendanceReliability (this EO sees
    // its own events in full; other organizers' events show only date/category/status).
    const applicantTalentIds = [...new Set(applicantApps.map((a) => a.talent_id))];
    const positionsMaster = await st.listPositions();
    const positionLabelById = new Map(positionsMaster.map((p) => [p.id, p.label_id || p.label_en || p.id]));
    const attByTalent = await Promise.all(applicantTalentIds.map((tid) => st.listAttendanceForTalent(tid)));
    const allAttRows = attByTalent.flat();
    const applicants = applicantApps
      .map((a) => {
        const tt = talentById.get(a.talent_id) || {};
        const ch = (choicesByApp.get(a.id) || []).slice().sort((x, y) => x.priority - y.priority)
          .map((c) => ({ priority: c.priority, position_id: c.position_id, accepted: !!c.accepted }));
        return {
          id: a.id, talentId: a.talent_id, name: tt.name || '—', type: a.talent_type || tt.talent_type || null,
          phone: tt.phone || null, city: tt.city || null, instagram: tt.instagram || null, login: tt.login || null,
          hyroxStatus: tt.hyrox_cert_status || 'none',
          status: a.status || 'applied', createdAt: a.created_at, confirmedAt: a.confirmed_at || null, choices: ch,
          reliability: computeReliability(a.talent_id, apps, eventsById, myEventIds),
          attRel: computeAttendanceReliability(a.talent_id, allAttRows, eventsById, positionLabelById, req.staff.id, false),
        };
      })
      .sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
    // C + edge cases: all active, unread alerts for this event (never silent):
    // cancellation, substitute declined/expired, cross-position chain effect.
    const notifs = (await st.listEoNotifications(req.staff.id, { unreadOnly: true }))
      .filter((n) => n.event_id === ev.id);
    const standbyRows = await st.listStandby(ev.id);
    const availByPos = {};
    standbyRows.forEach((s) => { if (s.state === 'available') availByPos[s.position_id] = (availByPos[s.position_id] || 0) + 1; });
    const cancelAlerts = notifs.map((n) => {
      const a = apps.find((x) => x.id === n.application_id);
      const tt = a ? talentById.get(a.talent_id) : null;
      const data = n.data || {};
      return { id: n.id, kind: n.kind, appId: n.application_id, positionId: n.position_id, talentName: tt ? tt.name : '—',
        reason: data.reason || null, note: data.note || null, data, when: n.created_at, standbyAvail: availByPos[n.position_id] || 0 };
    });
    await attachMockups(st, ev);
    const flash = { ok: String(req.query.ok || ''), err: String(req.query.err || '') };
    // Tahap 2/3: the event's single leader attendance link (if generated) +
    // whether the marking window is open, so the EO can share/copy it.
    const attLinkRow = await st.getAttendanceLinkForEvent(ev.id);
    const att = { url: attLinkRow ? publicBase(req) + '/absen/' + attLinkRow.token : null, active: attendanceWindowActive(ev), openMs: attendanceOpenMs(ev), closeMs: correctionCloseMs(ev) };
    res.send(V.eoEventDetail({ staff: eoCtx(req), event: ev, view, applicants, flash, lang: req.lang, cancelAlerts, hoursLeft: hoursUntilEvent(ev), att }));
  } catch (e) { next(e); }
});

// C: EO dismisses a cancellation alert (only their own).
app.post('/eo/notifications/:id/read', requireEo, async (req, res, next) => {
  try {
    const st = db();
    if (!st) return needConfig(req, res);
    const n = (await st.listEoNotifications(req.staff.id, {})).find((x) => x.id === req.params.id);
    if (n) await st.markEoNotificationRead(n.id);
    return res.redirect(safeNext(req.body.next) || '/eo/events');
  } catch (e) { next(e); }
});

// Tahap 7: EO processes an applicant. Loads the EO-owned event + the application
// (which must belong to that event) and returns them, or null if not authorised.
async function eoOwnedApplication(st, staffId, eventId, appId) {
  const ev = await eoOwnedEvent(st, staffId, eventId);
  if (!ev) return null;
  const app = (await st.listApplications()).find((a) => a.id === appId && a.event_id === ev.id);
  if (!app) return null;
  return { ev, app };
}

// Accept an applicant into one of their chosen positions. The quota check, the
// acceptance, the auto-decline of the talent's other picks for the event, and the
// status-history rows all run inside st.acceptApplicationTxn as ONE transaction
// (#4 quota race + #5 one accepted position per talent/event).
app.post('/eo/events/:id/applicants/:appId/accept', requireEo, async (req, res, next) => {
  try {
    const st = db();
    if (!st) return needConfig(req, res);
    const found = await eoOwnedApplication(st, req.staff.id, req.params.id, req.params.appId);
    if (!found) return res.redirect('/eo/events');
    const backTo = '/eo/events/' + found.ev.id + '?lang=' + req.lang;
    const positionId = String(req.body.position_id || '');
    const wasApproved = found.app.status === 'approved';
    // One transaction (#4): quota check + accept + auto-decline the talent's other
    // picks for this event + status-history rows, all inside acceptApplicationTxn.
    const outcome = await st.acceptApplicationTxn(found.app.id, positionId, req.staff.id);
    if (outcome === 'full') return res.redirect(backTo + '&err=full');
    if (outcome === 'skip') return res.redirect(backTo);
    // Email the talent their acceptance only on the first approval (re-accepting a
    // different position won't resend).
    if (!wasApproved) notifyPositionAcceptance(st, found.app, found.ev, positionId).catch((e) => console.error('[mail] EO acceptance email failed:', e && e.message));
    res.redirect(backTo + '&ok=accepted');
  } catch (e) { next(e); }
});

// Reject an applicant (clears any acceptance).
app.post('/eo/events/:id/applicants/:appId/reject', requireEo, async (req, res, next) => {
  try {
    const st = db();
    if (!st) return needConfig(req, res);
    const found = await eoOwnedApplication(st, req.staff.id, req.params.id, req.params.appId);
    if (!found) return res.redirect('/eo/events');
    // 'not_selected' = the EO decided against this talent (vs 'not_continued',
    // which is set automatically when they're accepted into another position).
    const wasRejected = ['not_selected', 'rejected'].includes(found.app.status);
    await st.clearApplicationAccepted(found.app.id);
    await st.logStatusChange(found.app.id, found.app.status, 'not_selected', req.staff.id);
    await st.updateApplication(found.app.id, { status: 'not_selected', reviewed_by: req.staff.id, reviewed_at: new Date().toISOString() });
    if (!wasRejected) notifyPositionRejection(st, found.app, found.ev).catch((e) => console.error('[mail] EO rejection email failed:', e && e.message));
    res.redirect('/eo/events/' + found.ev.id + '?lang=' + req.lang + '&ok=rejected');
  } catch (e) { next(e); }
});

// Undo a decision: back to pending, acceptance cleared.
app.post('/eo/events/:id/applicants/:appId/reset', requireEo, async (req, res, next) => {
  try {
    const st = db();
    if (!st) return needConfig(req, res);
    const found = await eoOwnedApplication(st, req.staff.id, req.params.id, req.params.appId);
    if (!found) return res.redirect('/eo/events');
    await st.clearApplicationAccepted(found.app.id);
    await st.logStatusChange(found.app.id, found.app.status, 'applied', req.staff.id);
    await st.updateApplication(found.app.id, { status: 'applied', reviewed_by: null, reviewed_at: null });
    res.redirect('/eo/events/' + found.ev.id + '?lang=' + req.lang);
  } catch (e) { next(e); }
});

// A: EO designates an applicant as standby (cadangan) for one of their chosen
// positions, assigning the next rank per position, then emails the availability
// request. The applicant's bucket becomes 'standby' until accepted or closed.
app.post('/eo/events/:id/applicants/:appId/standby', requireEo, async (req, res, next) => {
  try {
    const st = db();
    if (!st) return needConfig(req, res);
    const found = await eoOwnedApplication(st, req.staff.id, req.params.id, req.params.appId);
    if (!found) return res.redirect('/eo/events');
    const backTo = '/eo/events/' + found.ev.id + '?lang=' + req.lang;
    const positionId = String(req.body.position_id || '');
    if (found.app.status === 'approved') return res.redirect(backTo); // already placed
    const choices = (await st.listApplicationChoices()).filter((c) => c.application_id === found.app.id);
    if (!choices.some((c) => c.position_id === positionId)) return res.redirect(backTo);
    const existing = (await st.listStandby(found.ev.id)).filter((s) => s.position_id === positionId);
    await st.upsertStandby({ event_id: found.ev.id, application_id: found.app.id, position_id: positionId, rank: existing.length + 1, state: 'offered', created_by: req.staff.id });
    if (found.app.status !== 'standby') { await st.logStatusChange(found.app.id, found.app.status, 'standby', req.staff.id); await st.updateApplication(found.app.id, { status: 'standby' }); }
    notifyStandbyOffer(st, found.app, found.ev).catch((e) => console.error('[mail] standby offer failed:', e && e.message));
    res.redirect(backTo + '&ok=standby');
  } catch (e) { next(e); }
});

// A: an offered standby talent states availability (v=1 available / v=0 declined).
// Callable only while the standby window is open (until H-12h), re-checked here.
app.post('/event/:id/standby', requireAnyTalentReady(), async (req, res, next) => {
  try {
    const st = db();
    if (!st) return needConfig(req, res);
    const ev = findEventByRef(await st.listEvents(), req.params.id);
    if (!ev) return res.redirect('/events');
    const app = (await st.listApplicationsForTalent(req.talent.id)).find((a) => a.event_id === ev.id);
    if (!app) return res.redirect('/event/' + eventRef(ev) + '?lang=' + req.lang);
    const positionId = String(req.body.position_id || '');
    const sb = (await st.listStandbyForApp(app.id)).find((s) => s.position_id === positionId);
    if (!sb || !['offered', 'available', 'declined'].includes(sb.state)) return res.redirect('/event/' + eventRef(ev) + '?lang=' + req.lang);
    if (!standbyWindowOpen(ev)) return res.redirect('/event/' + eventRef(ev) + '?lang=' + req.lang + '&standby=closed');
    const available = String(req.body.v || '1') === '1';
    await st.updateStandby(sb.id, { state: available ? 'available' : 'declined', responded_at: new Date().toISOString() });
    res.redirect('/event/' + eventRef(ev) + '?lang=' + req.lang + '&standby=' + (available ? 'ok' : 'declined'));
  } catch (e) { next(e); }
});

// D/F: a called substitute confirms (v=1) or declines (v=0) their offer. Confirm
// locks the slot in one transaction; decline frees the candidate and alerts the EO
// so they can pick the next one.
app.post('/event/:id/substitute', requireAnyTalentReady(), async (req, res, next) => {
  try {
    const st = db();
    if (!st) return needConfig(req, res);
    const ev = findEventByRef(await st.listEvents(), req.params.id);
    if (!ev) return res.redirect('/events');
    const app = (await st.listApplicationsForTalent(req.talent.id)).find((a) => a.event_id === ev.id);
    if (!app) return res.redirect('/event/' + eventRef(ev) + '?lang=' + req.lang);
    const subId = String(req.body.sub_id || '');
    const sub = (await st.listSubstitutions(ev.id)).find((s) => s.id === subId && s.incoming_application_id === app.id && s.state === 'offered');
    if (!sub) return res.redirect('/event/' + eventRef(ev) + '?lang=' + req.lang);
    const accept = String(req.body.v || '1') === '1';
    if (accept) {
      const outcome = await st.confirmSubstituteTxn(sub.id, req.talent.id);
      // Edge #4: a cross-position pull shrinks the origin position's pool — make it
      // visible to the EO rather than silent.
      if (outcome === 'ok' && sub.from_position_id && sub.from_position_id !== sub.position_id) {
        await st.createEoNotification({ event_id: ev.id, staff_id: sub.created_by || null, kind: 'cross_position_filled', application_id: sub.incoming_application_id, position_id: sub.position_id, data: { name: (req.account && req.account.name) || null, from_position: sub.from_position_id, to_position: sub.position_id } });
      }
      return res.redirect('/event/' + eventRef(ev) + '?lang=' + req.lang + '&sub=' + (outcome === 'ok' ? 'done' : outcome));
    }
    // decline: free the candidate's standby and notify the EO to pick the next one.
    await st.updateSubstitution(sub.id, { state: 'declined', responded_at: new Date().toISOString() });
    const backSb = (await st.listStandbyForApp(app.id)).find((s) => s.position_id === sub.from_position_id);
    if (backSb) await st.updateStandby(backSb.id, { state: 'available' });
    await st.createEoNotification({ event_id: ev.id, staff_id: sub.created_by || null, kind: 'substitute_declined', application_id: sub.outgoing_application_id, position_id: sub.position_id, data: { declined_by: app.id } });
    res.redirect('/event/' + eventRef(ev) + '?lang=' + req.lang + '&sub=declined');
  } catch (e) { next(e); }
});

// D: manual substitute picker. Lists available standby candidates for the vacated
// position (ranked), then standby from OTHER positions (labelled), excluding anyone
// already holding an accepted slot in this event. Shows contacts so the EO can call.
async function buildReplaceCandidates(st, ev, posId) {
  const [standbyRows, apps, choices, talents] = await Promise.all([
    st.listStandby(ev.id), st.listApplications(), st.listApplicationChoices(), st.listTalents(),
  ]);
  const talentById = new Map(talents.map((tt) => [tt.id, tt]));
  const appById = new Map(apps.map((a) => [a.id, a]));
  const positions = await st.listEventPositions(ev.id);
  const posLbl = (pid) => { const p = positions.find((x) => x.position_id === pid); return p ? (p.label_id || p.label_en || pid) : pid; };
  // apps that already hold an accepted slot in this event (one-per-event exclusion)
  const eventAppIds = new Set(apps.filter((a) => a.event_id === ev.id).map((a) => a.id));
  const acceptedAppIds = new Set(choices.filter((c) => c.accepted && eventAppIds.has(c.application_id)).map((c) => c.application_id));
  const cands = standbyRows
    .filter((s) => s.state === 'available' && !acceptedAppIds.has(s.application_id))
    .map((s) => {
      const app = appById.get(s.application_id) || {};
      const tt = talentById.get(app.talent_id) || {};
      return { standbyId: s.id, applicationId: s.application_id, positionId: s.position_id, rank: s.rank || null,
        name: tt.name || '—', phone: tt.phone || null, samePosition: s.position_id === posId, positionLabel: posLbl(s.position_id) };
    });
  cands.sort((a, b) => (a.samePosition === b.samePosition ? 0 : (a.samePosition ? -1 : 1))
    || String(a.positionLabel).localeCompare(String(b.positionLabel)) || ((a.rank || 999) - (b.rank || 999)));
  return cands;
}
app.get('/eo/events/:id/replace', requireEo, async (req, res, next) => {
  try {
    const st = db();
    if (!st) return needConfig(req, res);
    const ev = await eoOwnedEvent(st, req.staff.id, req.params.id);
    if (!ev) return res.redirect('/eo/events');
    const posId = String(req.query.pos || '');
    const outgoingAppId = String(req.query.app || '');
    const apps = await st.listApplications();
    const outApp = apps.find((a) => a.id === outgoingAppId && a.event_id === ev.id) || null;
    const talents = await st.listTalents();
    const outName = outApp ? ((talents.find((tt) => tt.id === outApp.talent_id) || {}).name || '—') : '—';
    const positions = await st.listEventPositions(ev.id);
    const posLabelStr = ((positions.find((p) => p.position_id === posId) || {}).label_id) || posId;
    const windowOpen = standbyWindowOpen(ev);
    const candidates = windowOpen ? await buildReplaceCandidates(st, ev, posId) : [];
    res.send(V.eoReplacePicker({ staff: eoCtx(req), event: ev, outgoingApp: outgoingAppId, outName, positionId: posId, positionLabel: posLabelStr, candidates, windowOpen, flash: String(req.query.err || ''), lang: req.lang }));
  } catch (e) { next(e); }
});
app.post('/eo/events/:id/replace', requireEo, async (req, res, next) => {
  try {
    const st = db();
    if (!st) return needConfig(req, res);
    const ev = await eoOwnedEvent(st, req.staff.id, req.params.id);
    if (!ev) return res.redirect('/eo/events');
    const posId = String(req.body.position_id || '');
    const outgoingAppId = String(req.body.outgoing_app || '');
    const standbyId = String(req.body.standby_id || '');
    const backPicker = '/eo/events/' + ev.id + '/replace?app=' + encodeURIComponent(outgoingAppId) + '&pos=' + encodeURIComponent(posId) + '&lang=' + req.lang;
    if (!standbyWindowOpen(ev)) return res.redirect(backPicker + '&err=closed');
    const chosen = (await st.listStandby(ev.id)).find((s) => s.id === standbyId && s.state === 'available');
    if (!chosen) return res.redirect(backPicker + '&err=gone');
    // deadline: min(now + 24h, event start); fall back to now + 24h if no start.
    const startMs = eventStartMs(ev);
    const dlMs = Math.min(Date.now() + 24 * 3600 * 1000, startMs == null ? Infinity : startMs);
    const deadlineAt = new Date(Number.isFinite(dlMs) ? dlMs : Date.now() + 24 * 3600 * 1000).toISOString();
    const subId = await st.offerSubstituteTxn({ event_id: ev.id, position_id: posId, outgoing_application_id: outgoingAppId, incoming_application_id: chosen.application_id, from_position_id: chosen.position_id, deadline_at: deadlineAt, created_by: req.staff.id });
    if (!subId) return res.redirect(backPicker + '&err=ineligible');
    const incomingApp = (await st.listApplications()).find((a) => a.id === chosen.application_id);
    if (incomingApp) notifySubstituteOffer(st, incomingApp, ev, deadlineAt).catch((e) => console.error('[mail] substitute offer failed:', e && e.message));
    res.redirect('/eo/events/' + ev.id + '?lang=' + req.lang + '&ok=offered');
  } catch (e) { next(e); }
});

// E: super admin marks/unmarks a cancellation as an emergency, so it is excluded
// from the talent's reliability count (illness, family emergency, etc.).
app.post('/admin/applications/:id/cancel-emergency', auth.requireStaff(['super_admin']), async (req, res, next) => {
  try {
    const st = db();
    if (!st) return needConfig(req, res);
    const app = await st.getApplication(req.params.id);
    if (app && app.status === 'cancelled') await st.updateApplication(app.id, { cancel_is_emergency: !app.cancel_is_emergency });
    res.redirect(safeNext(req.body.next) || '/admin/applications');
  } catch (e) { next(e); }
});

// Public diagnostic (no secrets): reports whether the service key can read staff accounts.
app.get('/admin/health', async (req, res) => {
  const st = db();
  const out = { serviceKeyConfigured: !!st };
  if (!st) {
    out.diagnosis = 'MASALAH: SUPABASE_SERVICE_ROLE_KEY belum di-set di Railway.';
  } else {
    try {
      const staff = await st.listStaff();
      out.canReadStaff = true;
      out.staffCount = staff.length;
      out.diagnosis = staff.length > 0
        ? 'OK: service key jalan, login admin harusnya bisa.'
        : 'MASALAH: 0 akun staff terbaca. SUPABASE_SERVICE_ROLE_KEY kemungkinan salah (terisi anon key, bukan service_role key).';
    } catch (e) {
      out.canReadStaff = false;
      out.error = String(e.message || '').slice(0, 160);
      out.diagnosis = 'MASALAH: gagal membaca data (' + out.error + ').';
    }
  }
  res.type('application/json').send(JSON.stringify(out, null, 2));
});

function staffCtx(req) { return { role: req.staff.type, name: req.staff.name }; }

// Tab 1 — Dashboard: aggregate KOL statistics. Attaches talent names to proofs
// but skips thumbnail signing (not shown here).
app.get('/admin', auth.requireStaff(['super_admin']), async (req, res, next) => {
  try {
    const st = db();
    if (!st) return needConfig(req, res);
    const [rawProofs, events, talentsAll, assignments, settings] = await Promise.all([
      st.listProofs(), st.listEvents(), st.listTalents(), st.listAssignments(), st.getSettings(),
    ]);
    const talentNameById = new Map(talentsAll.map((t) => [t.id, t.name]));
    const proofs = rawProofs.map((p) => ({ ...p, talent_name: talentNameById.get(p.talent_id) || p.submitter_name || null }));
    res.send(V.adminDashboard({ staff: staffCtx(req), proofs, events, talents: talentsAll, assignments, settings, lang: req.lang }));
  } catch (e) { next(e); }
});

// Per-KOL eligibility detail (both staff roles).
app.get('/admin/kol/:id', auth.requireStaff(['super_admin']), async (req, res, next) => {
  try {
    const st = db();
    if (!st) return needConfig(req, res);
    const [talent, rawProofs, events, settings] = await Promise.all([
      st.getAccountById(req.params.id), st.listProofsForTalent(req.params.id), st.listEvents(), st.getSettings(),
    ]);
    const eventNameById = new Map(events.map((e) => [e.id, e.name]));
    const proofs = rawProofs.map((p) => ({ ...p, event_name: eventNameById.get(p.event_id) || null }));
    res.send(V.adminKolDetail({ staff: staffCtx(req), talent, proofs, settings, lang: req.lang }));
  } catch (e) { next(e); }
});

// Tab — Analisis: engagement metric breakdowns (both staff roles).
app.get('/admin/analytics', auth.requireStaff(['super_admin']), async (req, res, next) => {
  try {
    const st = db();
    if (!st) return needConfig(req, res);
    const [rawProofs, events, talentsAll] = await Promise.all([st.listProofs(), st.listEvents(), st.listTalents()]);
    const talentNameById = new Map(talentsAll.map((t) => [t.id, t.name]));
    const eventNameById = new Map(events.map((e) => [e.id, e.name]));
    const proofs = rawProofs.map((p) => ({
      ...p,
      talent_name: talentNameById.get(p.talent_id) || p.submitter_name || null,
      event_name: eventNameById.get(p.event_id) || null,
    }));
    res.send(V.adminAnalysis({ staff: staffCtx(req), proofs, lang: req.lang }));
  } catch (e) { next(e); }
});

// Tab — Ringkasan Performa: per-event totals + per-KOL breakdown.
app.get('/admin/overview', auth.requireStaff(['super_admin']), async (req, res, next) => {
  try {
    const st = db();
    if (!st) return needConfig(req, res);
    const [rawProofs, events, talentsAll] = await Promise.all([st.listProofs(), st.listEvents(), st.listTalents()]);
    const talentNameById = new Map(talentsAll.map((t) => [t.id, t.name]));
    const eventNameById = new Map(events.map((e) => [e.id, e.name]));
    const proofs = rawProofs.map((p) => ({
      ...p,
      talent_name: talentNameById.get(p.talent_id) || p.submitter_name || null,
      event_name: eventNameById.get(p.event_id) || null,
    }));
    res.send(V.adminOverview({ staff: staffCtx(req), proofs, lang: req.lang }));
  } catch (e) { next(e); }
});

// AI insight over the aggregated performance data (JSON; fetched by the overview page).
app.get('/admin/overview/insight', auth.requireStaff(['super_admin']), async (req, res) => {
  try {
    const st = db();
    if (!st) return res.status(503).json({ error: 'not configured' });
    const [rawProofs, talentsAll] = await Promise.all([st.listProofs(), st.listTalents()]);
    const talentNameById = new Map(talentsAll.map((t) => [t.id, t.name]));
    const useful = rawProofs.filter((p) => p.extracted && (p.status === 'extracted' || p.status === 'verified'));
    if (!useful.length) return res.json({ insight: req.t('ins.noData') });
    const engOf = (x) => (Number(x.likes) || 0) + (Number(x.comments) || 0) + (Number(x.shares) || 0) + (Number(x.saves) || 0);
    const byType = {}; const byKol = {};
    useful.forEach((p) => {
      const x = p.extracted || {};
      const ct = p.content_type || 'feed';
      const kol = talentNameById.get(p.talent_id) || p.submitter_name || '—';
      const bt = byType[ct] || (byType[ct] = { type: ct, posts: 0, views: 0, engagement: 0 });
      bt.posts += 1; bt.views += Number(x.views) || 0; bt.engagement += engOf(x);
      const bk = byKol[kol] || (byKol[kol] = { kol, posts: 0, views: 0, engagement: 0 });
      bk.posts += 1; bk.views += Number(x.views) || 0; bk.engagement += engOf(x);
    });
    const round = (o) => ({ ...o, avgEngagement: Math.round(o.engagement / o.posts), avgViews: Math.round(o.views / o.posts) });
    const summary = {
      perContentType: Object.values(byType).map(round),
      perKol: Object.values(byKol).map(round).sort((a, b) => b.engagement - a.engagement).slice(0, 10),
    };
    const insight = await llm.generateInsight(summary, req.lang);
    res.json({ insight });
  } catch (e) {
    res.status(200).json({ error: (e && e.code === 'NO_KEY') ? 'OPENROUTER_API_KEY belum di-set di Railway.' : (req.t ? req.t('ins.err') : 'error') });
  }
});

// Tab 2 — Bukti Post: full proof list with thumbnails (+ actions for super admin).
app.get('/admin/proofs', auth.requireStaff(['super_admin']), async (req, res, next) => {
  try {
    const st = db();
    if (!st) return needConfig(req, res);
    const [rawProofs, events, talentsAll, settings] = await Promise.all([st.listProofs(), st.listEvents(), st.listTalents(), st.getSettings()]);
    const talentNameById = new Map(talentsAll.map((t) => [t.id, t.name]));
    const proofs = await enrichProofs(st, rawProofs.slice(0, 200), { events, talentNameById });
    res.send(V.adminProofs({ staff: staffCtx(req), proofs, lang: req.lang, settings }));
  } catch (e) { next(e); }
});

// Tab 3 — Kelola (super admin only): events, assignments, EO accounts.
app.get('/admin/manage', auth.requireStaff(['super_admin']), async (req, res, next) => {
  try {
    const st = db();
    if (!st) return needConfig(req, res);
    const [events, assignments, talents, eos, settings, proofs] = await Promise.all([
      st.listEvents(), st.listAssignments(), st.listTalents(), st.listStaff('eo'), st.getSettings(), st.listProofs(),
    ]);
    await attachMockups(st, events);
    res.send(V.adminManage({ staff: staffCtx(req), events, assignments, talents, eos, proofs, lang: req.lang, settings }));
  } catch (e) { next(e); }
});

// Super admin: manage the landing hero background photos (1-2, alternating).
app.get('/admin/landing', auth.requireStaff(['super_admin']), async (req, res, next) => {
  try {
    const st = db();
    if (!st) return needConfig(req, res);
    const urls = (await st.landingBgUrls()) || [];
    res.send(V.adminLanding({ staff: staffCtx(req), lang: req.lang, urls, saved: req.query.saved === '1' }));
  } catch (e) { next(e); }
});
app.post('/admin/landing', auth.requireStaff(['super_admin']), uploadLanding, async (req, res, next) => {
  try {
    const st = db();
    if (!st) return needConfig(req, res);
    const files = req.files || {};
    const jobs = [];
    [['bg1', 1], ['bg2', 2]].forEach(([field, slot]) => {
      const f = files[field] && files[field][0];
      if (f && f.buffer && f.buffer.length && /^image\//.test(f.mimetype || '')) {
        jobs.push(st.putLandingBg(slot, f.buffer, f.mimetype));
      }
    });
    if (!jobs.length) return res.status(400).json({ ok: false, error: 'no image' });
    await Promise.all(jobs);
    resetLandingBgCache();
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// Aplikasi MP (super admin only): review Man Power event applications.
app.get('/admin/applications', auth.requireStaff(['super_admin']), async (req, res, next) => {
  try {
    const st = db();
    if (!st) return needConfig(req, res);
    const [apps, events, talents, certs, choicesAll, positions] = await Promise.all([st.listApplications(), st.listEvents(), st.listTalents(), st.listCertificates(), st.listApplicationChoices(), st.listPositions()]);
    const eventName = new Map(events.map((e) => [e.id, e.name]));
    const eventById = new Map(events.map((e) => [e.id, e]));
    const talentById = new Map(talents.map((tt) => [tt.id, tt]));
    const certByKey = new Map(certs.map((c) => [c.talent_id + '|' + c.event_id, c]));
    // Position-based applications store their picks in choices, not a single role.
    const posById = new Map(positions.map((p) => [p.id, p]));
    const appById = new Map(apps.map((a) => [a.id, a]));
    const choicesByApp = new Map();
    (choicesAll || []).forEach((c) => { const arr = choicesByApp.get(c.application_id) || []; arr.push(c); choicesByApp.set(c.application_id, arr); });
    // Quota per (event, position) + accepted counts, so the picker can flag full positions.
    const posEventIds = [...new Set(apps.filter((a) => choicesByApp.has(a.id)).map((a) => a.event_id))];
    const evPositions = new Map();
    await Promise.all(posEventIds.map(async (eid) => evPositions.set(eid, await st.listEventPositions(eid))));
    const acceptedCount = new Map();
    (choicesAll || []).forEach((c) => { if (!c.accepted) return; const a = appById.get(c.application_id); if (!a) return; const k = a.event_id + '|' + c.position_id; acceptedCount.set(k, (acceptedCount.get(k) || 0) + 1); });
    const applications = apps.map((a) => {
      const tt = talentById.get(a.talent_id) || {};
      const ev = eventById.get(a.event_id) || {};
      const choices = (choicesByApp.get(a.id) || []).slice().sort((x, y) => x.priority - y.priority)
        .map((c) => {
          const p = posById.get(c.position_id) || {};
          const evPos = (evPositions.get(a.event_id) || []).find((ep) => ep.position_id === c.position_id);
          const quota = evPos ? evPos.quota : 0;
          const full = quota > 0 && !c.accepted && (acceptedCount.get(a.event_id + '|' + c.position_id) || 0) >= quota;
          return { position_id: c.position_id, priority: c.priority, label_id: p.label_id, label_en: p.label_en, key: p.key, accepted: !!c.accepted, full };
        });
      return {
        ...a, event_name: eventName.get(a.event_id) || null, talent_name: tt.name || null, talent_login: tt.login || null, profile: tt,
        event_completed: !!ev.completed_at, certificate: certByKey.get(a.talent_id + '|' + a.event_id) || null, choices,
        reliability: computeReliability(a.talent_id, apps, eventById),
      };
    });
    // Attendance links: one per event that has any approved talent, for on-site PICs.
    const mpCount = new Map();
    for (const a of applications) {
      if (a.status === 'approved') mpCount.set(a.event_id, (mpCount.get(a.event_id) || 0) + 1);
    }
    const attendanceLinks = [...mpCount.entries()].map(([eid, n]) => ({
      eventId: eid, name: eventName.get(eid) || '—', count: n,
      path: '/absensi/' + encodeURIComponent(eid) + '?k=' + auth.attendanceToken(eid),
    })).sort((a, b) => a.name.localeCompare(b.name));
    // Separate the review by category so cert-required creators (KOL / photog /
    // videog) don't get mixed with Man Power crew. Category = the primary (P1)
    // position, falling back to talent_type for the older category-form apps.
    const cat = ['kol', 'creative', 'man_power'].includes(String(req.query.cat)) ? String(req.query.cat) : 'man_power';
    const catOf = (a) => {
      const primary = (a.choices && a.choices[0] && a.choices[0].key) || a.talent_type;
      if (primary === 'kol') return 'kol';
      if (primary === 'fotografer' || primary === 'videografer') return 'creative';
      return 'man_power';
    };
    const filtered = applications.filter((a) => catOf(a) === cat);
    res.send(V.adminApplications({ staff: staffCtx(req), applications: filtered, attendanceLinks, cat, lang: req.lang, flash: String(req.query.mail || '') }));
  } catch (e) { next(e); }
});

// Super admin: approve (optionally assign station) or reject an application.
app.post('/admin/applications/:id/review', auth.requireStaff(['super_admin']), async (req, res, next) => {
  try {
    const st = db();
    if (!st) return needConfig(req, res);
    const action = String(req.body.action || '');
    if (action !== 'approve' && action !== 'reject') return res.redirect('/admin/applications');
    const prior = await st.getApplication(req.params.id);
    // Capture the prior status as a primitive *before* updating: the memory store
    // returns a live row reference that updateApplication() mutates in place, so
    // reading prior.status after the update would already show 'approved'.
    const alreadyApproved = !!(prior && prior.status === 'approved');
    const alreadyRejected = !!(prior && prior.status === 'rejected');
    const patch = { reviewed_by: req.staff.id, reviewed_at: new Date().toISOString() };
    const note = String(req.body.note || '').trim().slice(0, 300);
    patch.note = note || null;
    if (action === 'approve') {
      patch.status = 'approved';
      patch.station = String(req.body.station || '').trim().slice(0, 120) || null;
      patch.station_loc = String(req.body.station_loc || '').trim().slice(0, 120) || null;
    } else {
      patch.status = 'rejected';
    }
    if (prior && prior.status !== patch.status) await st.logStatusChange(req.params.id, prior.status, patch.status, req.staff.id);
    await st.updateApplication(req.params.id, patch);
    // On the first approval (transition into approved), email the talent their placement.
    // Fire-and-forget: a mail hiccup must never block or fail the approval itself.
    if (action === 'approve' && prior && !alreadyApproved) {
      notifyAcceptance(st, prior, patch).catch((e) => console.error('[mail] acceptance email failed:', e && e.message));
    } else if (action === 'reject' && prior && !alreadyRejected) {
      const ev = (await st.listEvents()).find((e) => e.id === prior.event_id);
      notifyPositionRejection(st, prior, ev).catch((e) => console.error('[mail] rejection email failed:', e && e.message));
    }
    res.redirect('/admin/applications');
  } catch (e) { next(e); }
});

// Super Admin per-position review of position-based applications (mirrors the EO
// flow so both roles can accept a talent into any of their ranked picks).
app.post('/admin/applications/:id/accept-position', auth.requireStaff(['super_admin']), async (req, res, next) => {
  try {
    const st = db();
    if (!st) return needConfig(req, res);
    const positionId = String(req.body.position_id || '');
    const app0 = (await st.listApplications()).find((a) => a.id === req.params.id);
    if (!app0) return res.redirect('/admin/applications');
    const wasApproved = app0.status === 'approved';
    // One transaction (#4): mirrors the EO accept path.
    const outcome = await st.acceptApplicationTxn(app0.id, positionId, req.staff.id);
    if (outcome === 'ok' && !wasApproved) {
      const ev = (await st.listEvents()).find((e) => e.id === app0.event_id);
      if (ev) notifyPositionAcceptance(st, app0, ev, positionId).catch((e) => console.error('[mail] acceptance email failed:', e && e.message));
    }
    res.redirect('/admin/applications');
  } catch (e) { next(e); }
});

app.post('/admin/applications/:id/reject-position', auth.requireStaff(['super_admin']), async (req, res, next) => {
  try {
    const st = db();
    if (!st) return needConfig(req, res);
    const app = (await st.listApplications()).find((a) => a.id === req.params.id);
    if (!app) return res.redirect('/admin/applications');
    const wasRejected = ['not_selected', 'rejected'].includes(app.status);
    await st.clearApplicationAccepted(app.id);
    await st.logStatusChange(app.id, app.status, 'not_selected', req.staff.id);
    await st.updateApplication(app.id, { status: 'not_selected', reviewed_by: req.staff.id, reviewed_at: new Date().toISOString() });
    if (!wasRejected) {
      const ev = (await st.listEvents()).find((e) => e.id === app.event_id);
      notifyPositionRejection(st, app, ev).catch((e) => console.error('[mail] rejection email failed:', e && e.message));
    }
    res.redirect('/admin/applications');
  } catch (e) { next(e); }
});

app.post('/admin/applications/:id/reset-position', auth.requireStaff(['super_admin']), async (req, res, next) => {
  try {
    const st = db();
    if (!st) return needConfig(req, res);
    const app = (await st.listApplications()).find((a) => a.id === req.params.id);
    if (!app) return res.redirect('/admin/applications');
    await st.clearApplicationAccepted(app.id);
    await st.logStatusChange(app.id, app.status, 'applied', req.staff.id);
    await st.updateApplication(app.id, { status: 'applied', reviewed_by: null, reviewed_at: null });
    res.redirect('/admin/applications');
  } catch (e) { next(e); }
});

// Email an approved talent their placement (event, location, station). Best-effort.
async function notifyAcceptance(st, app, patch) {
  const account = await st.getAccountById(app.talent_id);
  const to = account && account.login;
  if (!to || !/@/.test(to)) return; // no usable email on file
  const ev = (await st.listEvents()).find((e) => e.id === app.event_id) || {};
  await mailer.sendAcceptanceEmail({
    to, name: account.name, lang: 'en',
    eventName: ev.name || 'Event 20FIT',
    eventDate: eventDateStrEn(ev),
    location: ev.location || null,
    category: V.CAT_LABEL[app.talent_type] || app.talent_type,
    station: patch.station, stationLoc: patch.station_loc,
  });
}

// Email a talent whose EO accepted them into a position. The accepted position
// (e.g. "Judge") is shown as their assignment. Sent in Indonesian since talents
// are the audience. Best-effort — never blocks the accept response.
async function notifyPositionAcceptance(st, app, ev, positionId) {
  const account = await st.getAccountById(app.talent_id);
  const to = account && account.login;
  if (!to || !/@/.test(to)) return; // no usable email on file
  let posLabel = null;
  try {
    const positions = await st.listEventPositions(ev.id);
    const pos = positions.find((p) => p.position_id === positionId);
    if (pos) posLabel = pos.label_id || pos.label_en || null;
  } catch (_) { /* position label is best-effort */ }
  await mailer.sendAcceptanceEmail({
    to, name: account.name, lang: 'id',
    eventName: ev.name || 'Event 20FIT',
    eventDate: eventDateStr(ev),
    location: ev.location || null,
    category: V.CAT_LABEL[app.talent_type] || app.talent_type,
    station: posLabel, stationLoc: null,
  });
}

// Notify a talent their application was rejected (red email). Best-effort.
async function notifyPositionRejection(st, app, ev) {
  const account = await st.getAccountById(app.talent_id);
  const to = account && account.login;
  if (!to || !/@/.test(to)) return; // no usable email on file
  await mailer.sendRejectionEmail({
    to, name: account.name, lang: 'id',
    eventName: (ev && ev.name) || 'Event 20FIT',
    eventDate: ev ? eventDateStr(ev) : null,
    location: (ev && ev.location) || null,
    category: V.CAT_LABEL[app.talent_type] || app.talent_type,
  });
}

// Base URL for links inside emails (no req available in fire-and-forget notifiers).
function appBase() { return (process.env.APP_BASE_URL || 'https://talent.20fit.id').replace(/\/+$/, ''); }
// Compact WIB timestamp for email deadlines.
function fmtDeadlineWIB(iso) { try { return new Date(iso).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }); } catch (_) { return ''; } }
// Cancellation/standby flow notifiers (position-free, policy F). Each resolves the
// talent's email and points them to the web to see the detail + click approval.
async function _talentEmail(st, app) { const a = await st.getAccountById(app.talent_id); const to = a && a.login; return (to && /@/.test(to)) ? { to, name: a.name } : null; }
async function notifyStandbyOffer(st, app, ev) { const m = await _talentEmail(st, app); if (!m) return; await mailer.sendDecisionEmail({ to: m.to, name: m.name, lang: 'id', eventName: (ev && ev.name) || 'Event 20FIT', link: appBase() + '/event/' + (ev ? ev.id : ''), kind: 'standby' }); }
async function notifySubstituteOffer(st, app, ev, deadlineIso) { const m = await _talentEmail(st, app); if (!m) return; await mailer.sendDecisionEmail({ to: m.to, name: m.name, lang: 'id', eventName: (ev && ev.name) || 'Event 20FIT', link: appBase() + '/event/' + (ev ? ev.id : ''), kind: 'substitute', deadline: deadlineIso ? fmtDeadlineWIB(deadlineIso) : null }); }
async function notifyDecisionReminder(st, app, ev, deadlineIso) { const m = await _talentEmail(st, app); if (!m) return; await mailer.sendDecisionEmail({ to: m.to, name: m.name, lang: 'id', eventName: (ev && ev.name) || 'Event 20FIT', link: appBase() + '/event/' + (ev ? ev.id : ''), kind: 'reminder', deadline: deadlineIso ? fmtDeadlineWIB(deadlineIso) : null }); }
async function notifyClosing(st, app, ev, kind) { const m = await _talentEmail(st, app); if (!m) return; await mailer.sendClosingEmail({ to: m.to, name: m.name, lang: 'id', eventName: (ev && ev.name) || 'Event 20FIT', kind }); }

// --- H-1 event reminders --------------------------------------------------
// All date math is done in Asia/Jakarta (WIB) so "tomorrow" matches the local
// calendar day, not the server's UTC day.
function jakartaDateStr(d) { return (d || new Date()).toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' }); }
function addDaysYMD(ymd, n) { const d = new Date(ymd + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
function jakartaHour(d) { return parseInt((d || new Date()).toLocaleString('en-GB', { timeZone: 'Asia/Jakarta', hour: '2-digit', hour12: false }), 10); }

// Email an H-1 reminder to every approved talent whose event starts tomorrow
// and who hasn't been reminded yet. Idempotent via reminder_sent_at, so it is
// safe to call repeatedly. Returns the number of reminders sent.
async function runDueReminders(st) {
  if (!st) return { due: 0, sent: 0 };
  try {
    const target = addDaysYMD(jakartaDateStr(), 1); // events starting tomorrow (WIB)
    const events = await st.listEvents().catch((err) => {
      console.warn('[reminders] Could not fetch events:', err && err.message);
      return [];
    });
    const dueEvents = new Map(events
      .filter((e) => e.is_active && !e.completed_at && String(e.starts_at || '').slice(0, 10) === target)
      .map((e) => [e.id, e]));
    if (!dueEvents.size) return { due: 0, sent: 0 };
    const [apps, choices, positions] = await Promise.all([
      st.listApplications().catch(() => []),
      st.listApplicationChoices().catch(() => []),
      st.listPositions().catch(() => []),
    ]);
    // Accepted position label per app, so position-based talents get an assignment line too.
    const posById = new Map(positions.map((p) => [p.id, p]));
    const acceptedPos = new Map();
    choices.forEach((c) => { if (c.accepted) { const p = posById.get(c.position_id); if (p) acceptedPos.set(c.application_id, p.label_en || p.label_id || null); } });
    const due = apps.filter((a) => a.status === 'approved' && !a.reminder_sent_at && dueEvents.has(a.event_id));
    let sent = 0;
    for (const a of due) {
      try {
        const account = await st.getAccountById(a.talent_id);
        const to = account && account.login;
        if (!to || !/@/.test(to)) continue;
        const ev = dueEvents.get(a.event_id);
        const r = await mailer.sendReminderEmail({
          to, name: account.name, lang: 'id',
          eventName: ev.name || 'Event 20FIT', eventDate: eventDateStr(ev),
          location: ev.location || null, category: V.CAT_LABEL[a.talent_type] || a.talent_type,
          station: a.station || acceptedPos.get(a.id) || null, stationLoc: a.station_loc,
        });
        // Only mark as reminded once the email is genuinely delivered — so if the
        // mail service isn't configured yet, we retry on the next run instead of
        // silently burning the reminder.
        if (r && r.delivered) { await st.updateApplication(a.id, { reminder_sent_at: new Date().toISOString() }); sent++; }
      } catch (e) { console.error('[mail] reminder failed for app ' + a.id + ':', e && e.message); }
    }
    if (sent) console.log('[reminders] sent ' + sent + ' H-1 reminder(s) for events on ' + target);
    return { due: due.length, sent };
  } catch (err) {
    console.warn('[reminders] check skipped:', err && err.message);
    return { due: 0, sent: 0 };
  }
}

// A/D: hourly maintenance for the standby/substitute flow. Deactivates the standby
// list at H-12h, expires overdue substitute offers (frees them + alerts the EO +
// emails the lapsed candidate), and sends a pre-deadline reminder once. Idempotent
// via state transitions + reminded_at, so it is safe to run every hour.
async function runStandbyMaintenance(st) {
  if (!st) return { expiredStandby: 0, expiredOffers: 0, reminders: 0 };
  const events = await st.listEvents().catch(() => []);
  const now = Date.now();
  const active = events.filter((e) => e.is_active && !e.completed_at && eventStartMs(e) != null && eventStartMs(e) > now - 24 * 3600 * 1000);
  let exSb = 0, exOf = 0, rem = 0;
  for (const ev of active) {
    const [standby, subs] = await Promise.all([st.listStandby(ev.id).catch(() => []), st.listSubstitutions(ev.id).catch(() => [])]);
    if (!standbyWindowOpen(ev)) {
      for (const s of standby) { if (['offered', 'available'].includes(s.state)) { await st.updateStandby(s.id, { state: 'expired' }); exSb++; } }
    }
    for (const sub of subs) {
      if (sub.state !== 'offered') continue;
      const dl = sub.deadline_at ? new Date(sub.deadline_at).getTime() : null;
      if (dl != null && now > dl) {
        await st.updateSubstitution(sub.id, { state: 'expired' });
        await st.createEoNotification({ event_id: ev.id, staff_id: sub.created_by || null, kind: 'substitute_expired', application_id: sub.outgoing_application_id, position_id: sub.position_id, data: null });
        const inApp = await st.getApplication(sub.incoming_application_id);
        if (inApp) notifyClosing(st, inApp, ev, 'lapsed').catch(() => {});
        exOf++;
      } else if (dl != null && !sub.reminded_at && (dl - now) <= 3 * 3600 * 1000) {
        await st.updateSubstitution(sub.id, { reminded_at: new Date().toISOString() });
        const inApp = await st.getApplication(sub.incoming_application_id);
        if (inApp) notifyDecisionReminder(st, inApp, ev, sub.deadline_at).catch(() => {});
        rem++;
      }
    }
  }
  return { expiredStandby: exSb, expiredOffers: exOf, reminders: rem };
}

// Hourly scheduler: run the H-1 job once per day during daytime WIB (so nobody
// is pinged at 3am). reminder_sent_at guarantees a single reminder per talent
// even though the check runs every hour. Disable with REMINDERS_DISABLED=1.
let _remTimer = null;
function startReminderScheduler() {
  if (_remTimer || process.env.REMINDERS_DISABLED === '1') return;
  const tick = () => {
    // Standby/substitute maintenance runs every hour (state changes are time-
    // critical); the H-1 courtesy reminders stay gated to daytime WIB.
    runStandbyMaintenance(db()).catch((e) => console.warn('[standby] tick skipped:', e && e.message));
    const h = jakartaHour();
    if (h < 8 || h >= 21) return; // only send between 08:00–20:59 WIB
    runDueReminders(db()).catch((e) => console.warn('[reminders] tick skipped:', e && e.message));
  };
  _remTimer = setInterval(tick, 60 * 60 * 1000); // hourly
  if (_remTimer.unref) _remTimer.unref();
  const boot = setTimeout(tick, 15000); // also run shortly after boot
  if (boot.unref) boot.unref();
}

// Super admin: run the H-1 reminder job on demand (for testing / catch-up).
app.post('/admin/reminders/run', auth.requireStaff(['super_admin']), async (req, res, next) => {
  try {
    const st = db();
    if (!st) return needConfig(req, res);
    let flash = 'remerr';
    try {
      const { due, sent } = await runDueReminders(st);
      flash = due === 0 ? 'rem0' : (sent > 0 ? 'remsent' : 'remmock');
    } catch (e) { console.error('[reminders] manual run failed:', e && e.message); flash = 'remerr'; }
    res.redirect('/admin/applications?mail=' + flash);
  } catch (e) { next(e); }
});

// ---- HYROX certificate verification (Super Admin + EO) ----------------------
// Talents upload a HYROX 360 certificate on their Dokumen page; staff review it
// here. Verification is global (once verified it counts for every event).

// EO scope for the shared HYROX / certificate review pool: the set of talent
// ids who applied to at least one event this EO owns. Super admins are never
// restricted; an EO may only review talents connected to their own events.
async function eoApplicantTalentIds(st, staffId) {
  const [events, apps] = await Promise.all([st.listEvents(), st.listApplications()]);
  const myEvents = new Set(events.filter((e) => e.created_by === staffId).map((e) => e.id));
  return new Set(apps.filter((a) => myEvents.has(a.event_id)).map((a) => a.talent_id));
}
app.get('/admin/hyrox', auth.requireStaff(['super_admin', 'eo']), async (req, res, next) => {
  try {
    const st = db();
    if (!st) return needConfig(req, res);
    const rk = (s) => (s === 'pending' ? 0 : s === 'rejected' ? 1 : 2); // pending first
    let certs = (await st.listHyroxCerts()).slice();
    if (req.staff.type === 'eo') { const mine = await eoApplicantTalentIds(st, req.staff.id); certs = certs.filter((c) => mine.has(c.id)); }
    certs = certs.sort((a, b) => rk(a.hyrox_cert_status) - rk(b.hyrox_cert_status) || String(a.name || '').localeCompare(String(b.name || '')));
    res.send(V.adminHyroxCerts({ staff: staffCtx(req), certs, lang: req.lang }));
  } catch (e) { next(e); }
});

// Stream a talent's uploaded HYROX certificate to the reviewing staff member.
app.get('/admin/hyrox/:talentId/file', auth.requireStaff(['super_admin', 'eo']), async (req, res, next) => {
  try {
    const st = db();
    if (!st) return needConfig(req, res);
    if (req.staff.type === 'eo') { const mine = await eoApplicantTalentIds(st, req.staff.id); if (!mine.has(req.params.talentId)) return res.redirect('/admin/hyrox'); }
    const acc = await st.getAccountById(req.params.talentId);
    const key = acc && acc.hyrox_cert_path;
    if (!key) return res.redirect('/admin/hyrox');
    const buf = await st.downloadImage(key);
    if (!buf) return res.redirect('/admin/hyrox');
    const ext = (String(key).match(/\.[a-z0-9]+$/i) || [''])[0].toLowerCase();
    const ct = ext === '.pdf' ? 'application/pdf'
      : ext === '.png' ? 'image/png'
      : ext === '.webp' ? 'image/webp'
      : ext === '.gif' ? 'image/gif' : 'image/jpeg';
    res.setHeader('Content-Type', ct);
    res.setHeader('Content-Disposition', 'inline');
    res.send(buf);
  } catch (e) { next(e); }
});

// Verify or reject a talent's HYROX certificate.
app.post('/admin/hyrox/:talentId/review', auth.requireStaff(['super_admin', 'eo']), async (req, res, next) => {
  try {
    const st = db();
    if (!st) return needConfig(req, res);
    const action = String(req.body.action || '');
    if (action !== 'verify' && action !== 'reject') return res.redirect('/admin/hyrox');
    if (req.staff.type === 'eo') { const mine = await eoApplicantTalentIds(st, req.staff.id); if (!mine.has(req.params.talentId)) return res.redirect('/admin/hyrox'); }
    const acc = await st.getAccountById(req.params.talentId);
    if (!acc || !acc.hyrox_cert_path) return res.redirect('/admin/hyrox');
    const note = String(req.body.note || '').trim().slice(0, 300);
    await st.updateAccountProfile(req.params.talentId, {
      hyrox_cert_status: action === 'verify' ? 'verified' : 'rejected',
      hyrox_cert_verified_by: req.staff.id,
      hyrox_cert_verified_at: new Date().toISOString(),
      hyrox_cert_note: action === 'reject' ? (note || null) : null,
    });
    res.redirect('/admin/hyrox');
  } catch (e) { next(e); }
});

// Super admin: manually (re)send the acceptance email for an approved application.
// Unlike the auto-send on approval, this always sends — used to re-notify a talent
// who was approved before the auto-email existed, or whose placement changed.
app.post('/admin/applications/:id/resend-email', auth.requireStaff(['super_admin']), async (req, res, next) => {
  try {
    const st = db();
    if (!st) return needConfig(req, res);
    const app = await st.getApplication(req.params.id);
    let flash = 'error';
    if (app && app.status === 'approved') {
      try {
        await notifyAcceptance(st, app, { station: app.station, station_loc: app.station_loc });
        flash = mailer.configured() ? 'sent' : 'mock';
      } catch (e) { console.error('[mail] resend acceptance failed:', e && e.message); flash = 'error'; }
    }
    res.redirect('/admin/applications?mail=' + flash);
  } catch (e) { next(e); }
});

// Super admin: mark a talent as attended (basis for the digital certificate).
app.post('/admin/applications/:id/attend', auth.requireStaff(['super_admin']), async (req, res, next) => {
  try {
    const st = db();
    if (!st) return needConfig(req, res);
    const attended = req.body.attended === '1';
    await st.updateApplication(req.params.id, { attended, attended_at: attended ? new Date().toISOString() : null });
    res.redirect('/admin/applications');
  } catch (e) { next(e); }
});

// --- On-site attendance (tokened link, no login) --------------------------
// A super admin shares /absensi/:eventId?k=<token> with an on-site PIC. The PIC
// sees every approved Man Power for that event (sorted by name) and checks them
// in as they arrive. The token is an HMAC of the event id (auth.attendanceToken),
// so no account is needed and one link maps to exactly one event.

// Per-day attendance is stored as a reserved key on the application's answers
// JSON (answers.__att = ['YYYY-MM-DD', ...]) so no schema change is needed. The
// legacy attended/attended_at booleans are kept in sync (attended = any day) so
// certificate issuance keeps working.
function attDates(app) {
  const d = app && app.answers && app.answers.__att;
  return Array.isArray(d) ? d.filter((x) => typeof x === 'string') : [];
}
// Inclusive list of an event's calendar days (YYYY-MM-DD), capped for safety.
function eventDays(ev) {
  const s = String((ev && ev.starts_at) || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return [];
  let end = String((ev && ev.ends_at) || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(end) || end < s) end = s;
  const days = []; let d = s; let guard = 0;
  while (guard++ < 60) { days.push(d); if (d >= end) break; d = addDaysYMD(d, 1); }
  return days;
}

// Approved Man Power for an event, sorted by name, with per-day + total attendance.
async function attendanceRows(st, eventId, day) {
  const [apps, talents, choices, positions] = await Promise.all([st.listApplications(), st.listTalents(), st.listApplicationChoices(), st.listPositions()]);
  const nameById = new Map(talents.map((tt) => [tt.id, tt.name]));
  const posById = new Map(positions.map((p) => [p.id, p]));
  // For position-based apps the "station" is the accepted position (Man Power apps keep a.station).
  const acceptedPos = new Map();
  choices.forEach((c) => { if (c.accepted) { const p = posById.get(c.position_id); if (p) acceptedPos.set(c.application_id, p.label_id || p.label_en || null); } });
  return apps
    .filter((a) => a.event_id === eventId && a.status === 'approved')
    .map((a) => { const dates = attDates(a); return { id: a.id, name: nameById.get(a.talent_id) || '—', station: acceptedPos.get(a.id) || a.station || null, station_loc: a.station_loc || null, count: dates.length, checked: day ? dates.includes(day) : false }; })
    .sort((x, y) => x.name.localeCompare(y.name, 'id', { sensitivity: 'base' }));
}

app.get('/absensi/:eventId', async (req, res, next) => {
  try {
    const st = db();
    if (!st) return needConfig(req, res);
    const token = String(req.query.k || '');
    const eventId = req.params.eventId;
    const ok = auth.verifyAttendanceToken(eventId, token);
    const ev = (await st.listEvents()).find((e) => e.id === eventId) || null;
    if (!ok || !ev) return res.status(ok ? 404 : 403).send(V.attendancePage({ invalid: true, lang: req.lang }));
    const days = eventDays(ev);
    const today = jakartaDateStr();
    let day = String(req.query.day || '');
    if (!days.includes(day)) day = days.includes(today) ? today : (days[0] || today);
    const rows = await attendanceRows(st, eventId, day);
    res.send(V.attendancePage({ event: ev, eventDate: eventDateStr(ev), rows, days, day, token, lang: req.lang, done: String(req.query.done || '') }));
  } catch (e) { next(e); }
});

app.post('/absensi/:eventId/checkin', async (req, res, next) => {
  try {
    const st = db();
    if (!st) return needConfig(req, res);
    const token = String(req.body.k || '');
    const eventId = req.params.eventId;
    if (!auth.verifyAttendanceToken(eventId, token)) return res.status(403).send(V.attendancePage({ invalid: true, lang: req.lang }));
    const appId = String(req.body.app || '');
    const attended = req.body.attended === '1';
    const day = String(req.body.day || '');
    const ev = (await st.listEvents()).find((e) => e.id === eventId) || null;
    const app0 = await st.getApplication(appId);
    // Guard: token is event-scoped and the day must be one of the event's days.
    let doneName = '';
    if (ev && eventDays(ev).includes(day) && app0 && app0.event_id === eventId && app0.status === 'approved') {
      const set = new Set(attDates(app0));
      if (attended) set.add(day); else set.delete(day);
      const arr = [...set].sort();
      const answers = Object.assign({}, app0.answers || {}, { __att: arr });
      await st.updateApplication(appId, { answers, attended: arr.length > 0, attended_at: arr.length ? (app0.attended_at || new Date().toISOString()) : null });
      if (attended) { const tt = (await st.listTalents()).find((x) => x.id === app0.talent_id); doneName = (tt && tt.name) || ''; }
    }
    const q = 'k=' + encodeURIComponent(token) + '&day=' + encodeURIComponent(day) + (doneName ? '&done=' + encodeURIComponent(doneName) : '');
    res.redirect('/absensi/' + encodeURIComponent(eventId) + '?' + q);
  } catch (e) { next(e); }
});

// === Talent attendance & reliability system (Tahap 2+) =====================
// ONE public leader link per EVENT. The leader is external (no login) and sees
// ONLY name + position + 3-status buttons — never phone/email/personal data.
// A/B: the leader marks HADIR / TIDAK HADIR ADA KABAR / TIDAK HADIR TANPA KABAR
// per talent per day. Attendance is the basis of payment by an outside party,
// so every mark records who (leader name), when, and keeps a full change log.

// Accepted talents of an event grouped by their accepted position, each with
// per-day attendance rows. STRICTLY name + position + status — this feeds the
// public leader page, so no phone/email/IG/bank/personal field is ever read.
async function leaderAttendanceData(st, ev) {
  const [apps, talents, choices, positions, attRows] = await Promise.all([
    st.listApplications(), st.listTalents(), st.listApplicationChoices(),
    st.listEventPositions(ev.id), st.listAttendanceForEvent(ev.id),
  ]);
  const nameById = new Map(talents.map((tt) => [tt.id, tt.name]));
  const posById = new Map(positions.map((p) => [p.position_id, p]));
  const attByApp = new Map();
  attRows.forEach((a) => { const m = attByApp.get(a.application_id) || {}; m[a.event_day] = a; attByApp.set(a.application_id, m); });
  const acceptedPos = new Map();
  choices.forEach((c) => { if (c.accepted) acceptedPos.set(c.application_id, c.position_id); });
  const groups = new Map();
  apps.filter((a) => a.event_id === ev.id && a.status === 'approved' && acceptedPos.has(a.id)).forEach((a) => {
    const pid = acceptedPos.get(a.id); const p = posById.get(pid) || {};
    const label = p.label_id || p.label_en || pid;
    if (!groups.has(pid)) groups.set(pid, { position_id: pid, label, talents: [] });
    groups.get(pid).talents.push({ applicationId: a.id, talentId: a.talent_id, name: nameById.get(a.talent_id) || '—', byDay: attByApp.get(a.id) || {} });
  });
  const list = [...groups.values()].sort((x, y) => String(x.label).localeCompare(String(y.label), 'id'));
  list.forEach((g) => g.talents.sort((x, y) => String(x.name).localeCompare(String(y.name), 'id', { sensitivity: 'base' })));
  return list;
}

// Public absolute base for building the shareable leader URL.
function publicBase(req) {
  const env = String(process.env.PUBLIC_BASE_URL || '').replace(/\/+$/, '');
  if (env) return env;
  const proto = (req.get('x-forwarded-proto') || req.protocol || 'https').split(',')[0].trim();
  return proto + '://' + req.get('host');
}

// EO (owner) creates — or re-fetches — the single active leader link for their
// event. Token is random + long (crypto), never the event id.
app.post('/eo/events/:id/attendance-link', requireEo, async (req, res, next) => {
  try {
    const st = db();
    if (!st) return needConfig(req, res);
    const ev = await eoOwnedEvent(st, req.staff.id, req.params.id);
    if (!ev) return res.redirect('/eo/events');
    let link = await st.getAttendanceLinkForEvent(ev.id);
    if (!link) {
      let token = randomAttToken();
      for (let i = 0; i < 4 && (await st.getAttendanceLinkByToken(token)); i++) token = randomAttToken();
      link = await st.createAttendanceLink({ event_id: ev.id, token, created_by: req.staff.id });
    }
    res.redirect('/eo/events/' + ev.id + '?lang=' + req.lang + '&ok=link#absen');
  } catch (e) { next(e); }
});

// Simpang 5: a leaked link can be revoked. The old token stops working
// immediately (getAttendanceLinkByToken ignores revoked links); the EO can then
// generate a fresh, different token.
app.post('/eo/events/:id/attendance-link/revoke', requireEo, async (req, res, next) => {
  try {
    const st = db();
    if (!st) return needConfig(req, res);
    const ev = await eoOwnedEvent(st, req.staff.id, req.params.id);
    if (!ev) return res.redirect('/eo/events');
    const link = await st.getAttendanceLinkForEvent(ev.id);
    if (link) await st.revokeAttendanceLink(link.id);
    res.redirect('/eo/events/' + ev.id + '?lang=' + req.lang + '&ok=revoked#absen');
  } catch (e) { next(e); }
});

// Resolve a leader link token -> { link, ev } or null.
async function resolveAttLink(st, token) {
  const link = await st.getAttendanceLinkByToken(String(token || ''));
  if (!link) return null;
  const ev = (await st.listEvents()).find((e) => e.id === link.event_id) || null;
  if (!ev) return null;
  return { link, ev };
}
function leaderName(req) { try { return decodeURIComponent(String((req.cookies && req.cookies.att_name) || '')).trim().slice(0, 80); } catch (_) { return ''; } }

// Tahap 7: notify the talent on EVERY attendance status change (best-effort, so
// a mail hiccup never blocks or breaks the mark). Fire-and-forget.
function notifyTalentAttendance(st, ev, talentId, day, status, markedByName, lang) {
  (async () => {
    try {
      const acc = await st.getAccountById(talentId);
      if (!acc || !acc.login) return;
      await mailer.sendAttendanceEmail({ to: acc.login, name: acc.name, lang: lang || 'id', eventName: ev.name, day, status, markedBy: markedByName });
    } catch (_) { /* non-fatal */ }
  })().catch(() => {});
}

// Public leader page. No login. Window is enforced on the server.
app.get('/absen/:token', async (req, res, next) => {
  try {
    const st = db();
    if (!st) return needConfig(req, res);
    const found = await resolveAttLink(st, req.params.token);
    if (!found) return res.status(404).send(V.leaderAttendancePage({ invalid: true, lang: req.lang }));
    const { ev } = found;
    const now = Date.now();
    const openMs = attendanceOpenMs(ev); const closeMs = correctionCloseMs(ev);
    const active = attendanceWindowActive(ev, now);
    const notYet = openMs != null && now < openMs;
    const closed = closeMs != null && now > closeMs;
    if (!active) {
      return res.send(V.leaderAttendancePage({ closedWindow: true, notYet, closed, event: ev, eventDate: eventDateStr(ev), openMs, closeMs, lang: req.lang }));
    }
    const name = leaderName(req);
    if (!name) return res.send(V.leaderAttendancePage({ needName: true, event: ev, eventDate: eventDateStr(ev), token: req.params.token, lang: req.lang }));
    const days = eventDays(ev);
    const today = jakartaDateStr();
    let day = String(req.query.day || '');
    if (!days.includes(day)) day = days.includes(today) ? today : (days[days.length - 1] || today);
    const groups = await leaderAttendanceData(st, ev);
    res.send(V.leaderAttendancePage({ event: ev, eventDate: eventDateStr(ev), groups, days, day, token: req.params.token, leaderName: name, lang: req.lang, saved: String(req.query.saved || '') }));
  } catch (e) { next(e); }
});

// Public: leader records their name (mandatory, no login). Stored in a cookie
// and written onto every mark for payment-dispute traceability.
app.post('/absen/:token/name', async (req, res, next) => {
  try {
    const st = db();
    if (!st) return needConfig(req, res);
    const found = await resolveAttLink(st, req.params.token);
    if (!found) return res.status(404).send(V.leaderAttendancePage({ invalid: true, lang: req.lang }));
    const name = String(req.body.name || '').trim().replace(/\s+/g, ' ').slice(0, 80);
    if (name.length >= 2) res.cookie('att_name', encodeURIComponent(name), { maxAge: 30 * 24 * 3600 * 1000, sameSite: 'lax', path: '/', httpOnly: true });
    res.redirect('/absen/' + encodeURIComponent(req.params.token) + '?lang=' + req.lang);
  } catch (e) { next(e); }
});

// Public: leader clears their stored name (to re-enter it before the list).
app.get('/absen/:token/name-reset', (req, res) => {
  res.clearCookie('att_name', { path: '/' });
  res.redirect('/absen/' + encodeURIComponent(req.params.token) + '?lang=' + req.lang);
});

// --- Tahap 3: EO attendance recap + CSV export -----------------------------
// Talents grouped by position, each day's status, plus per-day + overall
// counts. The EO oversees on-site marking here; a super admin reuses the same
// shape (Tahap 5).
async function attendanceRecap(st, ev) {
  const groups = await leaderAttendanceData(st, ev);
  const days = eventDays(ev);
  const blank = () => ({ present: 0, absent_notified: 0, absent_no_notice: 0, unmarked: 0 });
  const countsByDay = {}; days.forEach((d) => { countsByDay[d] = blank(); });
  const overall = blank();
  let unmarkedTotal = 0; let markedTotal = 0;
  groups.forEach((g) => g.talents.forEach((tt) => days.forEach((d) => {
    const row = tt.byDay[d] || null;
    const s = row && row.status ? row.status : null;
    const key = s || 'unmarked';
    if (countsByDay[d][key] != null) countsByDay[d][key]++;
    if (overall[key] != null) overall[key]++;
    if (s) markedTotal++; else unmarkedTotal++;
  })));
  return { groups, days, countsByDay, overall, unmarkedTotal, markedTotal };
}

// Correction requests for one event, joined to talent name + the day/position/
// current status of the record. Read-only for the EO (Super Admin decides).
async function attendanceCorrectionsForEvent(st, eventId) {
  const attRows = await st.listAttendanceForEvent(eventId);
  const attById = new Map(attRows.map((a) => [a.id, a]));
  if (!attById.size) return [];
  const [allCorr, talents, positions] = await Promise.all([st.listCorrections({}), st.listTalents(), st.listPositions()]);
  const tName = new Map(talents.map((t) => [t.id, t.name]));
  const posLbl = new Map(positions.map((p) => [p.id, p.label_id || p.label_en || p.id]));
  return allCorr
    .filter((c) => attById.has(c.attendance_id))
    .map((c) => { const a = attById.get(c.attendance_id); return {
      talentName: tName.get(c.talent_id) || '—', day: a.event_day, posLabel: posLbl.get(a.position_id) || '',
      status: a.status || null, reason: c.reason, state: c.state, decisionNote: c.decision_note || null, createdAt: c.created_at,
    }; })
    .sort((x, y) => (x.state === 'pending' ? 0 : 1) - (y.state === 'pending' ? 0 : 1) || String(y.createdAt || '').localeCompare(String(x.createdAt || '')));
}

function csvCell(v) { const s = v == null ? '' : String(v); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
const ATT_CSV_LABEL = {
  id: { present: 'Hadir', absent_notified: 'Tidak hadir (ada kabar)', absent_no_notice: 'Tidak hadir (tanpa kabar)', unmarked: 'Belum ditandai' },
  en: { present: 'Present', absent_notified: 'Absent (notified)', absent_no_notice: 'Absent (no notice)', unmarked: 'Not marked' },
};
async function attendanceCsv(st, ev, lang) {
  const L = lang === 'en' ? 'en' : 'id';
  const recap = await attendanceRecap(st, ev);
  const head = L === 'en'
    ? ['Position', 'Name', 'Date', 'Status', 'Status code', 'Note', 'Marked by', 'Marked at (WIB)']
    : ['Posisi', 'Nama', 'Tanggal', 'Status', 'Kode status', 'Keterangan', 'Ditandai oleh', 'Waktu ditandai (WIB)'];
  const lines = [head.map(csvCell).join(',')];
  const whenWib = (iso) => { try { return new Date(iso).toLocaleString('sv-SE', { timeZone: 'Asia/Jakarta' }); } catch (_) { return ''; } };
  recap.groups.forEach((g) => g.talents.forEach((tt) => recap.days.forEach((d) => {
    const row = tt.byDay[d] || null; const s = row && row.status ? row.status : 'unmarked';
    lines.push([
      g.label, tt.name, d, ATT_CSV_LABEL[L][s] || s, (s === 'unmarked' ? '' : s),
      (row && row.note) || '', (row && row.marked_by_name) || '', (row && row.marked_at) ? whenWib(row.marked_at) : '',
    ].map(csvCell).join(','));
  })));
  return lines.join('\r\n');
}
function attFilenameSlug(name) { return String(name || 'event').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'event'; }

app.get('/eo/events/:id/absensi', requireEo, async (req, res, next) => {
  try {
    const st = db();
    if (!st) return needConfig(req, res);
    const ev = await eoOwnedEvent(st, req.staff.id, req.params.id);
    if (!ev) return res.redirect('/eo/events');
    const recap = await attendanceRecap(st, ev);
    const days = recap.days; const today = jakartaDateStr();
    let day = String(req.query.day || '');
    if (!days.includes(day)) day = days.includes(today) ? today : (days[days.length - 1] || today);
    const link = await st.getAttendanceLinkForEvent(ev.id);
    // Correction requests the talents filed for THIS event, so the owning EO can
    // read the reason (the decision itself stays with the Super Admin).
    const corrections = await attendanceCorrectionsForEvent(st, ev.id);
    res.send(V.eoAttendancePage({
      staff: eoCtx(req), event: ev, eventDate: eventDateStr(ev), recap, day, lang: req.lang,
      active: attendanceWindowActive(ev), locked: attendanceLocked(ev), openMs: attendanceOpenMs(ev), closeMs: correctionCloseMs(ev),
      linkUrl: link ? publicBase(req) + '/absen/' + link.token : null, corrections,
      flash: { ok: String(req.query.ok || ''), err: String(req.query.err || '') },
    }));
  } catch (e) { next(e); }
});

// EO marks/corrects a talent's status within the window (recorded as the EO).
app.post('/eo/events/:id/absensi/mark', requireEo, async (req, res, next) => {
  try {
    const st = db();
    if (!st) return needConfig(req, res);
    const ev = await eoOwnedEvent(st, req.staff.id, req.params.id);
    if (!ev) return res.redirect('/eo/events');
    const back = '/eo/events/' + ev.id + '/absensi?lang=' + req.lang + (req.body.day ? '&day=' + encodeURIComponent(String(req.body.day)) : '');
    if (!attendanceWindowActive(ev)) return res.redirect(back + '&err=locked');
    const status = String(req.body.status || '');
    if (!ATT_STATUSES.includes(status)) return res.redirect(back + '&err=bad');
    const day = String(req.body.day || '');
    if (!eventDays(ev).includes(day)) return res.redirect(back + '&err=bad');
    const appId = String(req.body.app || '');
    const app0 = await st.getApplication(appId);
    if (!app0 || app0.event_id !== ev.id || app0.status !== 'approved') return res.redirect(back + '&err=bad');
    const acc = (await st.listApplicationChoices()).find((c) => c.application_id === appId && c.accepted);
    if (!acc) return res.redirect(back + '&err=bad');
    const note = status === 'absent_notified' ? (String(req.body.note || '').trim().slice(0, 500) || null) : null;
    const existing = await st.getAttendance(appId, day);
    const from = existing ? (existing.status || null) : null;
    const nowIso = new Date().toISOString();
    const saved = await st.upsertAttendance({
      event_id: ev.id, talent_id: app0.talent_id, application_id: appId, position_id: acc.position_id,
      event_day: day, status, note, marked_by_name: req.staff.name, marked_by_staff: req.staff.id, marked_at: nowIso,
    });
    if (from !== status) {
      await st.addAttendanceLog({ attendance_id: saved.id, from_status: from, to_status: status, changed_by_name: req.staff.name, changed_by_staff: req.staff.id, reason: null });
      notifyTalentAttendance(st, ev, app0.talent_id, day, status, req.staff.name, req.lang);
    }
    res.redirect(back + '&ok=marked');
  } catch (e) { next(e); }
});

app.get('/eo/events/:id/absensi.csv', requireEo, async (req, res, next) => {
  try {
    const st = db();
    if (!st) return needConfig(req, res);
    const ev = await eoOwnedEvent(st, req.staff.id, req.params.id);
    if (!ev) return res.redirect('/eo/events');
    const csv = await attendanceCsv(st, ev, req.lang);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="absensi-' + attFilenameSlug(ev.name) + '.csv"');
    res.send('﻿' + csv); // BOM so Excel reads UTF-8 correctly
  } catch (e) { next(e); }
});

// --- Tahap 5: Super Admin correction queue + locked-day edit ---------------
// The super admin is the only party who can change data after the 10-day lock,
// and who decides correction requests. They see ALL events (cross-EO); every
// change carries a mandatory recorded reason + a change-log row.
app.get('/admin/koreksi', auth.requireStaff(['super_admin']), async (req, res, next) => {
  try {
    const st = db();
    if (!st) return needConfig(req, res);
    const [corrs, talents, events, positions] = await Promise.all([st.listCorrections({}), st.listTalents(), st.listEvents(), st.listPositions()]);
    const tById = new Map(talents.map((t) => [t.id, t.name]));
    const evById = new Map(events.map((e) => [e.id, e]));
    const posLbl = new Map(positions.map((p) => [p.id, p.label_id || p.label_en || p.id]));
    const items = [];
    for (const c of corrs) {
      const att = await st.getAttendanceById(c.attendance_id);
      if (!att) continue;
      const ev = evById.get(att.event_id) || null;
      items.push({
        id: c.id, state: c.state, reason: c.reason, decisionNote: c.decision_note, createdAt: c.created_at, decidedAt: c.decided_at,
        talentName: tById.get(c.talent_id) || '—', eventName: ev ? ev.name : '—', eventId: att.event_id, day: att.event_day,
        posLabel: posLbl.get(att.position_id) || att.position_id, status: att.status || null, attendanceId: att.id,
      });
    }
    const pending = items.filter((i) => i.state === 'pending');
    const decided = items.filter((i) => i.state !== 'pending').sort((a, b) => String(b.decidedAt || '').localeCompare(String(a.decidedAt || ''))).slice(0, 50);
    res.send(V.adminCorrections({ staff: staffCtx(req), pending, decided, lang: req.lang, flash: { ok: String(req.query.ok || '') } }));
  } catch (e) { next(e); }
});

// Decide one correction. Approve -> set the record to the chosen status with a
// mandatory reason (change-logged as the admin). Reject -> record the outcome.
app.post('/admin/koreksi/:id/decide', auth.requireStaff(['super_admin']), async (req, res, next) => {
  try {
    const st = db();
    if (!st) return needConfig(req, res);
    const c = await st.getCorrection(req.params.id);
    if (!c || c.state !== 'pending') return res.redirect('/admin/koreksi');
    const att = await st.getAttendanceById(c.attendance_id);
    if (!att) return res.redirect('/admin/koreksi');
    const decision = String(req.body.decision || '');
    const note = String(req.body.decision_note || '').trim().slice(0, 500) || null;
    const nowIso = new Date().toISOString();
    if (decision === 'approve') {
      const status = String(req.body.status || '');
      if (!ATT_STATUSES.includes(status)) return res.redirect('/admin/koreksi?ok=bad');
      if (!note || note.length < 3) return res.redirect('/admin/koreksi?ok=needreason'); // mandatory recorded reason
      const from = att.status || null;
      if (from !== status) {
        await st.updateAttendance(att.id, { status, note: status === 'absent_notified' ? (att.note || null) : null, marked_by_name: req.staff.name, marked_by_staff: req.staff.id, marked_at: nowIso });
        await st.addAttendanceLog({ attendance_id: att.id, from_status: from, to_status: status, changed_by_name: req.staff.name, changed_by_staff: req.staff.id, reason: 'Koreksi disetujui: ' + note });
        const evK = (await st.listEvents()).find((e) => e.id === att.event_id);
        if (evK) notifyTalentAttendance(st, evK, att.talent_id, att.event_day, status, req.staff.name, req.lang);
      }
      await st.updateCorrection(c.id, { state: 'approved', decided_by: req.staff.id, decided_at: nowIso, decision_note: note });
    } else if (decision === 'reject') {
      await st.updateCorrection(c.id, { state: 'rejected', decided_by: req.staff.id, decided_at: nowIso, decision_note: note });
    } else {
      return res.redirect('/admin/koreksi');
    }
    res.redirect('/admin/koreksi?ok=1');
  } catch (e) { next(e); }
});

// Admin per-event attendance: recap + edit that works even after the lock, each
// change requiring a recorded reason. Also renders the full change history.
app.get('/admin/events/:id/absensi', auth.requireStaff(['super_admin']), async (req, res, next) => {
  try {
    const st = db();
    if (!st) return needConfig(req, res);
    const ev = (await st.listEvents()).find((e) => e.id === req.params.id) || null;
    if (!ev) return res.redirect('/admin/manage');
    const recap = await attendanceRecap(st, ev);
    const days = recap.days; const today = jakartaDateStr();
    let day = String(req.query.day || '');
    if (!days.includes(day)) day = days.includes(today) ? today : (days[days.length - 1] || today);
    const logs = await st.listAttendanceLogsForEvent(ev.id);
    const logsByAtt = {};
    logs.forEach((l) => { (logsByAtt[l.attendance_id] = logsByAtt[l.attendance_id] || []).push(l); });
    res.send(V.adminAttendancePage({
      staff: staffCtx(req), event: ev, eventDate: eventDateStr(ev), recap, day, lang: req.lang,
      locked: attendanceLocked(ev), closeMs: correctionCloseMs(ev), logsByAtt,
      flash: { ok: String(req.query.ok || ''), err: String(req.query.err || '') },
    }));
  } catch (e) { next(e); }
});

// Admin marks/corrects any day (even locked) — mandatory reason, change-logged.
app.post('/admin/events/:id/absensi/mark', auth.requireStaff(['super_admin']), async (req, res, next) => {
  try {
    const st = db();
    if (!st) return needConfig(req, res);
    const ev = (await st.listEvents()).find((e) => e.id === req.params.id) || null;
    if (!ev) return res.redirect('/admin/manage');
    const back = '/admin/events/' + ev.id + '/absensi?lang=' + req.lang + (req.body.day ? '&day=' + encodeURIComponent(String(req.body.day)) : '');
    const status = String(req.body.status || '');
    if (!ATT_STATUSES.includes(status)) return res.redirect(back + '&err=bad');
    const day = String(req.body.day || '');
    if (!eventDays(ev).includes(day)) return res.redirect(back + '&err=bad');
    const reason = String(req.body.reason || '').trim().slice(0, 500);
    if (reason.length < 3) return res.redirect(back + '&err=needreason'); // mandatory recorded reason
    const appId = String(req.body.app || '');
    const app0 = await st.getApplication(appId);
    if (!app0 || app0.event_id !== ev.id || app0.status !== 'approved') return res.redirect(back + '&err=bad');
    const acc = (await st.listApplicationChoices()).find((c) => c.application_id === appId && c.accepted);
    if (!acc) return res.redirect(back + '&err=bad');
    const note = status === 'absent_notified' ? (String(req.body.note || '').trim().slice(0, 500) || null) : null;
    const existing = await st.getAttendance(appId, day);
    const from = existing ? (existing.status || null) : null;
    const nowIso = new Date().toISOString();
    const saved = await st.upsertAttendance({
      event_id: ev.id, talent_id: app0.talent_id, application_id: appId, position_id: acc.position_id,
      event_day: day, status, note, marked_by_name: req.staff.name, marked_by_staff: req.staff.id, marked_at: nowIso,
    });
    if (from !== status) {
      await st.addAttendanceLog({ attendance_id: saved.id, from_status: from, to_status: status, changed_by_name: req.staff.name, changed_by_staff: req.staff.id, reason: 'Admin: ' + reason });
      notifyTalentAttendance(st, ev, app0.talent_id, day, status, req.staff.name, req.lang);
    }
    res.redirect(back + '&ok=marked');
  } catch (e) { next(e); }
});

// Tahap 7 (I): Super Admin flags/unflags an incident as an EMERGENCY, excluding
// it from the talent's violation record. Who + reason are recorded; logged.
app.post('/admin/absensi/:attendanceId/emergency', auth.requireStaff(['super_admin']), async (req, res, next) => {
  try {
    const st = db();
    if (!st) return needConfig(req, res);
    const att = await st.getAttendanceById(req.params.attendanceId);
    if (!att) return res.redirect('/admin/manage');
    const back = '/admin/events/' + att.event_id + '/absensi?lang=' + req.lang + '&day=' + encodeURIComponent(att.event_day);
    const on = !att.is_emergency;
    const reason = String(req.body.reason || '').trim().slice(0, 500) || null;
    if (on && (!reason || reason.length < 3)) return res.redirect(back + '&err=needreason');
    const nowIso = new Date().toISOString();
    await st.updateAttendance(att.id, { is_emergency: on, emergency_by: on ? req.staff.id : null, emergency_reason: on ? reason : null, emergency_at: on ? nowIso : null });
    await st.addAttendanceLog({ attendance_id: att.id, from_status: att.status, to_status: att.status, changed_by_name: req.staff.name, changed_by_staff: req.staff.id, reason: (on ? 'Ditandai darurat (dikecualikan dari pelanggaran): ' : 'Batal tanda darurat: ') + (reason || '') });
    res.redirect(back + '&ok=marked');
  } catch (e) { next(e); }
});

// Public: leader marks/re-marks one talent's status for one day. Server re-checks
// the window; writes the attendance row + a change-log entry (never silent).
app.post('/absen/:token/mark', async (req, res, next) => {
  try {
    const st = db();
    if (!st) return needConfig(req, res);
    const wantsJson = req.body.ajax === '1' || String(req.get('accept') || '').includes('application/json');
    const back = '/absen/' + encodeURIComponent(req.params.token) + '?lang=' + req.lang + (req.body.day ? '&day=' + encodeURIComponent(String(req.body.day)) : '');
    const fail = (code, err) => wantsJson ? res.status(code).json({ ok: false, error: err }) : res.redirect(back + '&saved=' + err);
    const found = await resolveAttLink(st, req.params.token);
    if (!found) return fail(404, 'invalid');
    const { ev } = found;
    if (!attendanceWindowActive(ev)) return fail(403, 'closed');
    const name = leaderName(req);
    if (!name) return fail(400, 'name');
    const status = String(req.body.status || '');
    if (!ATT_STATUSES.includes(status)) return fail(400, 'status');
    const day = String(req.body.day || '');
    if (!eventDays(ev).includes(day)) return fail(400, 'day');
    const appId = String(req.body.app || '');
    const app0 = await st.getApplication(appId);
    if (!app0 || app0.event_id !== ev.id || app0.status !== 'approved') return fail(400, 'app');
    const acc = (await st.listApplicationChoices()).find((c) => c.application_id === appId && c.accepted);
    if (!acc) return fail(400, 'app');
    const note = status === 'absent_notified' ? (String(req.body.note || '').trim().slice(0, 500) || null) : null;
    const existing = await st.getAttendance(appId, day);
    const from = existing ? (existing.status || null) : null;
    const nowIso = new Date().toISOString();
    const saved = await st.upsertAttendance({
      event_id: ev.id, talent_id: app0.talent_id, application_id: appId, position_id: acc.position_id,
      event_day: day, status, note, marked_by_name: name, marked_by_staff: null, marked_at: nowIso,
    });
    if (from !== status) {
      await st.addAttendanceLog({ attendance_id: saved.id, from_status: from, to_status: status, changed_by_name: name, changed_by_staff: null, reason: null });
      notifyTalentAttendance(st, ev, app0.talent_id, day, status, name, req.lang);
    }
    if (wantsJson) return res.json({ ok: true, app: appId, day, status, note, marked_by: name, marked_at: nowIso });
    res.redirect(back + '&saved=1');
  } catch (e) { next(e); }
});

// Super admin: download a PDF report of Man Power who have checked in — bank
// details, phone, and how many days each attended. Payment/reconciliation aid.
app.get('/admin/applications/report.pdf', auth.requireStaff(['super_admin']), async (req, res, next) => {
  try {
    const st = db();
    if (!st) return needConfig(req, res);
    const [apps, events, talents] = await Promise.all([st.listApplications(), st.listEvents(), st.listTalents()]);
    const evById = new Map(events.map((e) => [e.id, e]));
    const tById = new Map(talents.map((tt) => [tt.id, tt]));
    const rows = apps
      .filter((a) => a.status === 'approved' && a.talent_type === 'main_power' && attDates(a).length > 0)
      .map((a) => {
        const tt = tById.get(a.talent_id) || {}; const ans = a.answers || {};
        return {
          name: tt.name || '—', event: (evById.get(a.event_id) || {}).name || '—',
          phone: tt.phone || '—', bank: ans.bank_name || '—', acct: ans.bank_account || '—',
          holder: ans.bank_holder || '—', count: attDates(a).length,
        };
      })
      .sort((x, y) => x.event.localeCompare(y.event) || x.name.localeCompare(y.name, 'id'));
    const buf = await cert.renderAttendanceReportPDF(rows, {});
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="Report-Absensi-Man-Power.pdf"');
    res.send(buf);
  } catch (e) { next(e); }
});

// Super admin: mark an event finished (enables certificate issuance) or reopen it.
app.post('/admin/events/:id/complete', auth.requireStaff(['super_admin']), async (req, res, next) => {
  try {
    const st = db();
    if (!st) return needConfig(req, res);
    const completed = req.body.completed === '1';
    await st.completeEvent(req.params.id, completed);
    if (completed) {
      const [events, apps, talents] = await Promise.all([st.listEvents(), st.listApplications(), st.listTalents()]);
      const eventById = new Map(events.map((e) => [e.id, e]));
      const nameById = new Map(talents.map((tt) => [tt.id, tt.name]));
      await issueCertsForApps(st, apps.filter((a) => a.event_id === req.params.id), eventById, nameById);
    }
    res.redirect('/admin/manage');
  } catch (e) { next(e); }
});

// Super admin: manually issue a certificate for an attended applicant.
app.post('/admin/applications/:id/issue-cert', auth.requireStaff(['super_admin']), async (req, res, next) => {
  try {
    const st = db();
    if (!st) return needConfig(req, res);
    const a = await st.getApplication(req.params.id);
    if (a && a.attended) {
      const [events, talents] = await Promise.all([st.listEvents(), st.listTalents()]);
      const ev = events.find((e) => e.id === a.event_id);
      const nameById = new Map(talents.map((tt) => [tt.id, tt.name]));
      if (ev) {
        try {
          await st.createCertificate({
            cert_no: cert.makeCertNo(), talent_id: a.talent_id, event_id: a.event_id,
            role: a.role || V.CAT_LABEL[a.talent_type] || a.talent_type,
            talent_name: (a.answers && a.answers.name) || nameById.get(a.talent_id) || '',
            event_name: ev.name, event_date: eventDateStr(ev), issued_by: req.staff.id,
          });
        } catch (e) { if (e.code !== 'DUP') throw e; }
      }
    }
    res.redirect('/admin/applications');
  } catch (e) { next(e); }
});

// Super admin: revoke / restore a certificate.
app.post('/admin/certificates/:id/revoke', auth.requireStaff(['super_admin']), async (req, res, next) => {
  try {
    const st = db();
    if (!st) return needConfig(req, res);
    await st.revokeCertificate(req.params.id, req.body.revoke === '1');
    res.redirect('/admin/applications');
  } catch (e) { next(e); }
});

// Staff: download a certificate PDF.
app.get('/admin/certificates/:id', auth.requireStaff(['super_admin', 'eo']), async (req, res, next) => {
  try {
    const st = db();
    if (!st) return needConfig(req, res);
    const c = await st.getCertificate(req.params.id);
    if (!c) return res.redirect('/admin/applications');
    if (req.staff.type === 'eo' && !(await eoOwnedEvent(st, req.staff.id, c.event_id))) return res.redirect('/admin/applications');
    const base = (process.env.APP_BASE_URL || (req.protocol + '://' + req.get('host'))).replace(/\/+$/, '');
    const buf = await cert.renderCertificatePDF({ ...c, issued_at: fmtDayID(c.issued_at), verifyUrl: base + '/cert/' + c.cert_no });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="Sertifikat-${c.cert_no}.pdf"`);
    res.send(buf);
  } catch (e) { next(e); }
});

// Super admin only: create an Event Organizer account.
app.post('/admin/eos', auth.requireStaff(['super_admin']), async (req, res, next) => {
  try {
    const st = db();
    if (!st) return needConfig(req, res);
    const name = String(req.body.name || '').trim();
    const login = String(req.body.login || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    if (name && login && password.length >= 6) {
      try {
        // Admin-created EO is vouched for → pre-verified & active (skips email verification).
        const s = await st.createStaff({ role: 'eo', name, login, password_hash: auth.hashPassword(password) });
        if (s && s.id) await st.setStaffVerified(s.id);
      } catch (e) { if (e.code !== 'DUP') throw e; }
    }
    res.redirect('/admin/manage');
  } catch (e) { next(e); }
});

// Super admin: create event with per-talent-type needs.
app.post('/admin/events', auth.requireStaff(['super_admin']), upload.single('mockup'), async (req, res, next) => {
  try {
    const st = db();
    if (!st) return needConfig(req, res);
    const name = String(req.body.name || '').trim();
    const location = String(req.body.location || '').trim().slice(0, 200) || null;
    const starts_at = String(req.body.starts_at || '').trim() || null;
    const ends_at = String(req.body.ends_at || '').trim() || null;
    const needs = [];
    if (req.body.need_kol) needs.push({ talent_type: 'kol' });
    if (req.body.need_main_power) needs.push({ talent_type: 'main_power', headcount: Math.max(1, parseInt(req.body.mp_headcount, 10) || 1) });
    if (req.body.need_fotografer) needs.push({ talent_type: 'fotografer' });
    const mp_sow = String(req.body.mp_sow || '').trim().slice(0, 2000) || null;
    if (name) {
      const ev = await st.createEvent({ name, location, starts_at, ends_at, created_by: req.staff.id, needs, mp_sow });
      const mockupPath = ev && ev.id ? await saveMockup(st, ev.id, req.file) : null;
      if (mockupPath) await st.updateEvent(ev.id, { mockup_path: mockupPath });
    }
    res.redirect('/admin/manage');
  } catch (e) { next(e); }
});

// Super admin: edit an event — schedule, talent needs + quotas, MP SOW.
app.get('/admin/events/:id/edit', auth.requireStaff(['super_admin']), async (req, res, next) => {
  try {
    const st = db();
    if (!st) return needConfig(req, res);
    const events = await st.listEvents();
    const event = events.find((e) => e.id === req.params.id);
    if (!event) return res.redirect('/admin/manage');
    await attachMockups(st, event);
    res.send(V.adminEventEdit({ staff: staffCtx(req), event, lang: req.lang }));
  } catch (e) { next(e); }
});

app.post('/admin/events/:id/edit', auth.requireStaff(['super_admin']), upload.single('mockup'), async (req, res, next) => {
  try {
    const st = db();
    if (!st) return needConfig(req, res);
    const name = String(req.body.name || '').trim();
    const location = String(req.body.location || '').trim().slice(0, 200) || null;
    const starts_at = String(req.body.starts_at || '').trim() || null;
    const ends_at = String(req.body.ends_at || '').trim() || null;
    const hc = (key) => Math.max(1, parseInt(req.body[key], 10) || 1);
    const needs = [];
    if (req.body.need_kol) needs.push({ talent_type: 'kol', headcount: hc('kol_headcount') });
    if (req.body.need_main_power) needs.push({ talent_type: 'main_power', headcount: hc('mp_headcount') });
    if (req.body.need_fotografer) needs.push({ talent_type: 'fotografer', headcount: hc('fg_headcount') });
    // mp_sow is no longer edited from the UI; leave any existing value untouched.
    const patch = { location, starts_at, ends_at, needs };
    if (name) patch.name = name;
    // Mockup: a new upload replaces it; the "remove" checkbox clears it.
    const newPath = await saveMockup(st, req.params.id, req.file);
    if (newPath) patch.mockup_path = newPath;
    else if (req.body.remove_mockup) patch.mockup_path = null;
    await st.updateEvent(req.params.id, patch);
    res.redirect('/admin/manage');
  } catch (e) { next(e); }
});

app.post('/admin/events/:id/toggle', auth.requireStaff(['super_admin']), async (req, res, next) => {
  try {
    const st = db();
    if (!st) return needConfig(req, res);
    await st.toggleEvent(req.params.id);
    res.redirect('/admin/manage');
  } catch (e) { next(e); }
});

// Super admin: assign a talent to an event.
app.post('/admin/assignments', auth.requireStaff(['super_admin']), async (req, res, next) => {
  try {
    const st = db();
    if (!st) return needConfig(req, res);
    const talentId = String(req.body.talent_id || '').trim();
    const eventId = String(req.body.event_id || '').trim();
    if (talentId && eventId) {
      const t = (await st.listTalents()).find((x) => x.id === talentId);
      if (t) await st.createAssignment({ event_id: eventId, talent_id: talentId, talent_type: t.talent_type, assigned_by: req.staff.id });
    }
    res.redirect('/admin/manage');
  } catch (e) { next(e); }
});

// Super admin: verify / reject / re-extract a proof.
async function setProofStatus(st, id, status, staffId) {
  await st.updateProof(id, { status, verified_by: staffId || null, verified_at: new Date().toISOString() });
}
app.post('/admin/proofs/:id/verify', auth.requireStaff(['super_admin']), async (req, res, next) => {
  try { const st = db(); if (!st) return needConfig(req, res); await setProofStatus(st, req.params.id, 'verified', req.staff.id); res.redirect('/admin/proofs'); } catch (e) { next(e); }
});
app.post('/admin/proofs/:id/reject', auth.requireStaff(['super_admin']), async (req, res, next) => {
  try { const st = db(); if (!st) return needConfig(req, res); await setProofStatus(st, req.params.id, 'rejected', req.staff.id); res.redirect('/admin/proofs'); } catch (e) { next(e); }
});
// Super admin: delete a proof (also removes its stored screenshot).
app.post('/admin/proofs/:id/delete', auth.requireStaff(['super_admin']), async (req, res, next) => {
  try { const st = db(); if (!st) return needConfig(req, res); await st.deleteProof(req.params.id); res.redirect('/admin/proofs'); } catch (e) { next(e); }
});
// Super admin: delete an event (with its needs & assignments) or an EO account.
app.post('/admin/events/:id/delete', auth.requireStaff(['super_admin']), async (req, res, next) => {
  try { const st = db(); if (!st) return needConfig(req, res); await st.deleteEvent(req.params.id); res.redirect('/admin/manage'); } catch (e) { next(e); }
});
// Super Admin read-only detail for one EO: profile + the events they created.
app.get('/admin/eos/:id', auth.requireStaff(['super_admin']), async (req, res, next) => {
  try {
    const st = db();
    if (!st) return needConfig(req, res);
    const eo = await st.getStaffById(req.params.id);
    if (!eo || eo.role !== 'eo') return res.redirect('/admin/manage');
    const [profile, allEvents, apps] = await Promise.all([
      st.getEoProfile(eo.id), st.listEvents(), st.listApplications(),
    ]);
    const applyCountByEvent = {};
    apps.forEach((a) => { applyCountByEvent[a.event_id] = (applyCountByEvent[a.event_id] || 0) + 1; });
    const events = allEvents
      .filter((e) => e.created_by === eo.id)
      .map((e) => {
        let displayStatus;
        if (e.completed_at) displayStatus = 'done';
        else if (e.status === 'draft') displayStatus = 'draft';
        else if (e.status === 'closed' || e.reg_closed_at) displayStatus = 'closed';
        else displayStatus = 'published';
        return Object.assign({}, e, { applyCount: applyCountByEvent[e.id] || 0, displayStatus });
      })
      .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
    res.send(V.adminEoDetail({ staff: staffCtx(req), eo, profile, events, lang: req.lang }));
  } catch (e) { next(e); }
});
app.post('/admin/eos/:id/delete', auth.requireStaff(['super_admin']), async (req, res, next) => {
  try {
    const st = db();
    if (!st) return needConfig(req, res);
    const target = await st.getStaffById(req.params.id);
    if (target && target.role === 'eo') await st.deleteStaff(req.params.id); // never delete a super admin
    res.redirect('/admin/manage');
  } catch (e) { next(e); }
});
// Super admin: suspend / activate an EO account. A suspended EO cannot log in
// (its existing events stay intact); reactivating restores access.
app.post('/admin/eos/:id/status', auth.requireStaff(['super_admin']), async (req, res, next) => {
  try {
    const st = db();
    if (!st) return needConfig(req, res);
    const target = await st.getStaffById(req.params.id);
    if (!target || target.role !== 'eo') return res.redirect('/admin/manage'); // never touch a super admin
    const next_ = req.body.status === 'suspended' ? 'suspended' : 'active';
    await st.setStaffStatus(target.id, next_);
    res.redirect('/admin/eos/' + target.id + '?lang=' + req.lang);
  } catch (e) { next(e); }
});
// Super admin: update the timeliness (SLA) thresholds.
app.post('/admin/settings', auth.requireStaff(['super_admin']), async (req, res, next) => {
  try {
    const st = db();
    if (!st) return needConfig(req, res);
    const M = { views: 'vpd', likes: 'lpd', comments: 'cpd', saves: 'spd', shares: 'shpd' };
    const patch = {};
    for (const [metric, pre] of Object.entries(M)) {
      const g = parseInt(req.body['g_' + metric], 10);
      const y = parseInt(req.body['y_' + metric], 10);
      if (Number.isFinite(g)) patch[pre + '_green'] = Math.max(0, g);
      if (Number.isFinite(y)) patch[pre + '_yellow'] = Math.max(0, y);
    }
    // KOL eligibility scoring thresholds.
    for (const key of ['score_target_views', 'score_target_eng', 'score_min_campaigns', 'score_eligible', 'score_consider']) {
      const v = parseInt(req.body[key], 10);
      if (Number.isFinite(v)) patch[key] = Math.max(0, v);
    }
    await st.updateSettings(patch);
    res.redirect('/admin/manage');
  } catch (e) { next(e); }
});
app.post('/admin/proofs/:id/reextract', auth.requireStaff(['super_admin']), async (req, res, next) => {
  try {
    const st = db();
    if (!st) return needConfig(req, res);
    const p = await st.getProof(req.params.id);
    if (p && p.screenshot_path) {
      const buf = await st.downloadImage(p.screenshot_path);
      const ext = String(p.screenshot_path).split('.').pop().toLowerCase();
      const mime = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
      if (buf) runExtraction(st, p.id, buf, mime, p.status);
    }
    res.redirect('/admin/proofs');
  } catch (e) { next(e); }
});

app.get('/performance', auth.requireStaff(['super_admin']), async (req, res, next) => {
  try {
    const st = db();
    if (!st) return needConfig(req, res);
    const subs = await st.listSubmissions();

    const map = new Map();
    subs.forEach((s) => {
      const e = map.get(s.kol_name) || { kol_name: s.kol_name, submissions: 0, posts: 0, images: 0, last: null };
      e.submissions += 1;
      e.posts += Array.isArray(s.post_links) ? s.post_links.length : 0;
      e.images += Array.isArray(s.image_urls) ? s.image_urls.length : 0;
      if (!e.last || s.created_at > e.last) e.last = s.created_at;
      map.set(s.kol_name, e);
    });
    const board = [...map.values()].sort((a, b) => b.submissions - a.submissions || b.posts - a.posts);
    res.send(V.performancePage(board, subs.length));
  } catch (e) { next(e); }
});

// In-memory dev mode serves placeholder thumbnails (Supabase mode uses signed URLs).
const PX = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
app.get('/__mockimg/*', (req, res) => { res.type('png').send(PX); });

// -------------------------------------------------------------- fallbacks ----

app.use((err, req, res, next) => {
  let msg = err.message || 'Terjadi kesalahan.';
  if (err.code === 'LIMIT_FILE_SIZE') msg = 'Ukuran gambar terlalu besar (maks 6 MB per file).';
  if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE') msg = 'Maksimal ' + MAX_IMAGES + ' gambar.';
  console.error('[error]', err.code || '', err.message);
  res.status(500).send(V.page500(msg));
});

// Start listening only when run directly; requiring this module (e.g. for tests)
// registers the app and helpers without opening a port.
if (require.main === module) {
  app.listen(PORT, HOST, () => {
    console.log('20FIT KOL server on http://' + HOST + ':' + PORT + ' (store: ' + MODE + ')');
    startReminderScheduler();
  });
}

module.exports = { app, runStandbyMaintenance, computeReliability, eventStartMs, cancelWindowOpen, standbyWindowOpen, attendanceOpenMs, correctionCloseMs, attendanceWindowActive, attendanceLocked, computeAttendanceReliability, attendanceVisibility };
