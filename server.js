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
// Never let a browser/CDN cache an auth-flow response. These routes render
// login-state-dependent content and issue role-based redirects (e.g. /eo/login
// -> /login/eo -> dashboard-or-form), so a cached 3xx/page would pin a stale
// destination — exactly the "/eo/login keeps going to /admin" class of bug.
app.use((req, res, next) => {
  if (/^\/(admin|eo|login|register|talent|events|event)(\/|$)/.test(req.path)) {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.set('Pragma', 'no-cache');
  }
  next();
});

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
      acc.isKol = await talentIsKol(st, acc.id);
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
      acc.isKol = await talentIsKol(st, acc.id);
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
  if (lang !== 'id' && lang !== 'en') lang = (req.cookies && req.cookies.lang) || 'en';
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
    const st = db();
    const eventName = nxt ? await eventNameFromNext(st, nxt) : null;
    const cities = st ? await publicCityList(st) : [];
    res.send(V.talentRegister('kol', { unified: true, lang: req.lang, next: nxt, eventName, cities }));
  } catch (e) { nextFn(e); }
});
app.post('/register', talentRegisterPost('kol', { unified: true }));
async function talentLoginGet(req, res) {
  const nxt = safeNext(req.query.next);
  const tk = auth.currentTalent(req);
  if (tk && (tk.type === 'kol' || tk.type === 'main_power')) return res.redirect(nxt || '/talent');
  const st = db();
  let eventName = null;
  try { if (nxt) eventName = await eventNameFromNext(st, nxt); } catch (_) { /* best-effort */ }
  let cities = [];
  try { if (st) cities = await publicCityList(st); } catch (_) { /* best-effort */ }
  res.send(V.talentLogin('kol', { unified: true, lang: req.lang, next: nxt, eventName, cities }));
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
  // Redirect back to the page the toggle was clicked on, but strip any ?lang=
  // from it — otherwise that stale query param would override the cookie we
  // just set (readLang prioritises ?lang over the cookie), leaving the page in
  // the old language and making the toggle look broken on any URL that carries
  // ?lang (e.g. the public catalog/detail links append ?lang=<L>).
  try { const u = new URL(req.get('referer')); u.searchParams.delete('lang'); dest = u.pathname + u.search; } catch (_) { /* no/invalid referer */ }
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
// Marker stored on an application's `note` when the TALENT declines a spot they were
// accepted for (status → rejected). Lets us tell a self-decline apart from an
// EO/admin rejection (e.g. Point 3's "not selected" pop-up skips self-declines).
const DECLINED_BY_TALENT = 'Declined by talent';
// Note set on a talent's OTHER apps in an event that are auto-rejected because they
// were accepted for a different position there — also skipped by the reject pop-up.
const AUTO_DECLINED_NOTE = 'Otomatis: kamu diterima di posisi lain pada event ini.';

// Has this talent confirmed the KOL category yet? True once they have at least one
// application to a KOL-category position (position.key === 'kol'). This gates the
// "Post Proofs" bottom-nav item + the /kirim-bukti page — Post Proofs is a KOL-only
// feature, so a fresh account (or one that only applied to non-KOL roles like Judge)
// shouldn't see it until a KOL application confirms the category. Attached to
// req.account.isKol by the talent guards so every dashboard page decides the same way.
async function talentIsKol(st, talentId) {
  const [myApps, allPositions] = await Promise.all([st.listApplicationsForTalent(talentId), st.listPositions()]);
  if (!myApps || !myApps.length) return false;
  const appIds = new Set(myApps.map((a) => a.id));
  const kolPosIds = new Set((allPositions || []).filter((p) => p.key === 'kol').map((p) => String(p.id)));
  if (!kolPosIds.size) return false;
  const choices = await st.listApplicationChoices();
  return choices.some((c) => appIds.has(c.application_id) && kolPosIds.has(String(c.position_id)));
}

// Build a talent's application history (one entry per application): resolve each
// application's chosen/accepted position + ranked picks against the event. Shared
// by the Talent Profile (summary) and the /talent/applications page.
async function buildAppliedEvents(st, myApps, eventById) {
  const choices = await st.listApplicationChoices();
  const choicesByApp = new Map();
  choices.forEach((c) => { const arr = choicesByApp.get(c.application_id) || []; arr.push(c); choicesByApp.set(c.application_id, arr); });
  const posLabelById = new Map();
  for (const evId of [...new Set(myApps.map((a) => a.event_id))]) {
    (await st.listEventPositions(evId)).forEach((p) => posLabelById.set(String(p.position_id), p));
  }
  return myApps
    .map((a) => {
      const ev = eventById.get(a.event_id);
      if (!ev) return null;
      const chs = (choicesByApp.get(a.id) || []).slice().sort((x, y) => x.priority - y.priority);
      const accepted = chs.find((c) => c.accepted) || null;
      const primary = accepted || chs[0] || null;
      const position = primary ? posLabelById.get(String(primary.position_id)) : null;
      const picks = chs.map((c) => ({ priority: c.priority, accepted: !!c.accepted, pos: posLabelById.get(String(c.position_id)) || null }));
      const acceptedPos = accepted ? posLabelById.get(String(accepted.position_id)) : null;
      const otherPos = accepted ? chs.filter((c) => !c.accepted).map((c) => posLabelById.get(String(c.position_id))).filter(Boolean) : [];
      const ref = (chs.length && (ev.slug || ev.id)) || null;
      // rejectNotify: a genuine "not selected" rejection (skip self-declines + the
      // auto-decline of other picks when accepted elsewhere) → drives the pop-up.
      const rejectNotify = a.status === 'rejected' && a.note !== DECLINED_BY_TALENT && a.note !== AUTO_DECLINED_NOTE;
      return { appId: a.id, name: ev.name, ref, location: ev.location || null, starts_at: ev.starts_at, ends_at: ev.ends_at, status: a.status, station: a.station || null, position, role: a.role, note: a.note || null, picks, acceptedPos, otherPos, rejectSeenAt: a.reject_seen_at || null, rejectNotify, groupUrl: ev.group_url || null };
    })
    .filter(Boolean);
}

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
    // resolve each application's chosen position + ranked picks against the event.
    const appliedEvents = await buildAppliedEvents(st, myApps, eventById);
    // Real, countable profile stats (no fabricated ratings).
    const stats = {
      events: appliedEvents.length,
      approved: appliedEvents.filter((e) => ['approved', 'assigned', 'completed'].includes(e.status)).length,
      proofs: proofs.length,
      certs: certs.length,
    };
    res.send(V.kolProfilePage({ account: req.account, certs, events: appliedEvents, stats, lang: req.lang }));
  } catch (e) { next(e); }
});

// Dedicated "Applications" page (creator talents): the full application history
// timeline moved out of the Profile page, with a status filter. Man Power keeps
// its self-apply list on /talent, so bounce it back there.
app.get('/talent/applications', requireAnyTalentBrowse(), async (req, res, next) => {
  try {
    const st = db();
    if (!st) return needConfig(req, res);
    if (req.talent.type === 'main_power') return res.redirect('/talent?lang=' + req.lang);
    const [myApps, events] = await Promise.all([st.listApplicationsForTalent(req.talent.id), st.listEvents()]);
    const eventById = new Map(events.map((e) => [e.id, e]));
    const appliedEvents = await buildAppliedEvents(st, myApps, eventById);
    res.send(V.talentApplicationsPage({ account: req.account, events: appliedEvents, lang: req.lang }));
  } catch (e) { next(e); }
});

// Talent confirms (Agree) the spot an EO accepted them for → status becomes
// "assigned" (shows in the EO/Super Admin selected list). Only an application that
// is currently "approved" and belongs to this talent can be confirmed.
app.post('/talent/applications/:appId/agree', requireAnyTalentBrowse(), async (req, res, next) => {
  try {
    const st = db();
    if (!st) return needConfig(req, res);
    const app = (await st.listApplicationsForTalent(req.talent.id)).find((a) => a.id === req.params.appId);
    if (app && app.status === 'approved') {
      await st.updateApplication(app.id, { status: 'assigned' });
      // Point 4: if the EO has already set the group link, email this newly-assigned
      // talent right away (the shared helper only touches unnotified assigned rows).
      try {
        const ev = (await st.listEvents()).find((e) => e.id === app.event_id);
        if (ev && ev.group_url) await notifyGroupForAssigned(st, ev);
      } catch (err) { console.warn('[mail] group-invite on agree failed: ' + (err && err.message)); }
    }
    res.redirect('/talent?lang=' + req.lang + '&confirmed=1');
  } catch (e) { next(e); }
});

// Talent declines the spot → status "rejected" (marked as a self-decline) and the
// reserved slot is released (accepted choice cleared) so the position reopens.
app.post('/talent/applications/:appId/decline', requireAnyTalentBrowse(), async (req, res, next) => {
  try {
    const st = db();
    if (!st) return needConfig(req, res);
    const app = (await st.listApplicationsForTalent(req.talent.id)).find((a) => a.id === req.params.appId);
    if (app && app.status === 'approved') {
      await st.clearApplicationAccepted(app.id); // free the reserved slot → position reopens
      await st.updateApplication(app.id, { status: 'rejected', note: DECLINED_BY_TALENT });
    }
    res.redirect('/talent?lang=' + req.lang + '&declined=1');
  } catch (e) { next(e); }
});

// Mark a rejection pop-up as seen so it shows only once (Point 3). Fired when the
// talent dismisses / clicks through the "not selected this time" pop-up on Profile.
app.post('/talent/applications/:appId/reject-seen', requireAnyTalentBrowse(), async (req, res, next) => {
  try {
    const st = db();
    if (!st) return needConfig(req, res);
    const app = (await st.listApplicationsForTalent(req.talent.id)).find((a) => a.id === req.params.appId);
    if (app && app.status === 'rejected' && !app.reject_seen_at) {
      await st.updateApplication(app.id, { reject_seen_at: new Date().toISOString() });
    }
    res.redirect(safeNext(req.body.next) || ('/talent?lang=' + req.lang));
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
    const buf = await cert.renderCertificatePDF(await buildCertRenderData(st, c, base));
    // ?view=1 opens inline (in-tab preview); default downloads as an attachment.
    const inline = req.query.view === '1' || req.query.view === 'inline';
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="Sertifikat-${c.cert_no}.pdf"`);
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

// Build the payload for cert.renderCertificatePDF. Enriches the stored snapshot
// with the event's English date + location (looked up live so old certs render
// consistently too); falls back to the stored date if the event is gone.
async function buildCertRenderData(st, c, base) {
  let event_date = c.event_date || null;
  let location = null;
  try {
    const ev = (await st.listEvents()).find((e) => e.id === c.event_id);
    if (ev) { event_date = eventDateStrEn(ev); location = ev.location || null; }
  } catch (e) { /* keep stored snapshot */ }
  return { ...c, event_date, location, issued_at: fmtDayID(c.issued_at), verifyUrl: base + '/cert/' + c.cert_no };
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
        id: e.id, name: e.name, location: e.location, category: e.category, starts_at: e.starts_at, ends_at: e.ends_at, mockup_path: e.mockup_path, status: eventStatusOf(e), cats: eventCats(e),
        applied: appByEvent.has(e.id) ? {
          category: appByEvent.get(e.id).talent_type, status: appByEvent.get(e.id).status,
          station: appByEvent.get(e.id).station, station_loc: appByEvent.get(e.id).station_loc,
        } : null,
      }))
      .filter((e) => e.status !== 'ended' && e.cats.length > 0)
      .sort((a, b) => (rank[a.status] - rank[b.status]) || String(a.starts_at || '').localeCompare(String(b.starts_at || '')));
    await attachMockups(st, events);
    const cities = eventCityList([...(eoEvents || []), ...(events || [])]);
    res.send(V.kolEventsPage({ account: req.account, events, eoEvents, lang: req.lang, cities }));
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
    notifyApplicationReceived(req.account); // new application (Applied) → email a receipt
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
      acc.isKol = await talentIsKol(st, acc.id);
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
      acc.isKol = await talentIsKol(st, acc.id);
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
          if (acc) { acc.isKol = await talentIsKol(st, acc.id); req.talent = t; req.account = acc; }
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
  // Search window honors the WIB open/close TIME (falls back to start/end of day).
  const nowStr = jakartaNowStr();
  if (ev.reg_open && nowStr < String(ev.reg_open).slice(0, 10) + 'T' + (ev.reg_open_time || '00:00')) return false;
  if (ev.reg_deadline && nowStr > String(ev.reg_deadline).slice(0, 10) + 'T' + (ev.reg_deadline_time || '23:59')) return false;
  // The EO-set close deadline is the exact close. The old "always close H-1 before
  // the event" rule is only a backstop for events that set NO close deadline —
  // it never overrides an explicit deadline.
  if (!ev.reg_deadline && ev.starts_at) {
    const h1 = addDaysYMD(String(ev.starts_at).slice(0, 10), -1);
    if (today >= h1) return false;
  }
  return true;
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
  return { view, positions: view.positions, openPositions, posById, myApp, myChoices, myByPosition, regOpen: eventRegOpen(ev) };
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
// Cities of currently-open events, for the unified header's search dropdown on
// public pages. Cached briefly so it doesn't re-scan every event on each load.
let _cityCache = { at: 0, list: [] };
async function publicCityList(st) {
  const now = Date.now();
  if (_cityCache.list.length && now - _cityCache.at < 60000) return _cityCache.list;
  try { _cityCache = { at: now, list: eventCityList(await openPositionEvents(st, null)) }; } catch (_) { /* keep last known */ }
  return _cityCache.list;
}

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
    const cities = await publicCityList(st);
    res.send(V.talentEventApply({ account: req.account || null, event: ev, ctx, lang: req.lang, saved: req.query.saved === '1', cities }));
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
      notifyApplicationReceived(req.account); // new application (Applied) → email a receipt; adding more choices reuses this app, so it fires once
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

app.get('/kirim-bukti', requireTalentReady('kol'), async (req, res, next) => {
  try {
    const st = db();
    if (!st) return needConfig(req, res);
    // Post Proofs is KOL-only: block direct-URL access until the KOL category is
    // confirmed (a KOL-position application), matching the hidden bottom-nav item.
    if (!req.account.isKol) return res.redirect('/talent?lang=' + req.lang);
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
    if (!req.account.isKol) return res.redirect('/talent?lang=' + req.lang);
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
    notifyApplicationReceived(req.account); // new application (Applied) → email a receipt
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
  // Only skip the form when ALREADY signed in as Super Admin. An EO session must
  // not bounce this page — the /admin and /eo areas stay independent, and each
  // login page is always reachable regardless of any other-role session.
  const t = auth.anySession(req, ['super_admin']);
  if (t) return res.redirect('/admin');
  res.send(V.staffLogin({ lang: req.lang, variant: 'admin' }));
});

app.get('/login/eo', (req, res) => {
  // Only skip the form when ALREADY signed in as an EO. A Super Admin session must
  // still see the EO login here (so an admin can sign in as an EO) instead of
  // being redirected to /admin.
  const t = auth.anySession(req, ['eo']);
  if (t) return res.redirect('/eo');
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
// Unauthenticated EO routes bounce to the EO sign-in (not the Super Admin one).
const requireEo = auth.requireStaff(['eo'], '/login/eo');

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

// Data for the Statistics page (EO + Super Admin). `scopedEvents` is the set the
// caller is allowed to see (an EO's own events, or every event for a Super
// Admin). Returns the event dropdown list, the per-event breakdown for the
// selected event (per-position bars + status counts + average profile strength),
// and an aggregate summary across all scoped events.
async function statsPageData(st, scopedEvents, selectedIdRaw, typeRaw) {
  const [apps, choices, talents, master] = await Promise.all([
    st.listApplications(), st.listApplicationChoices(), st.listTalents(), st.listPositions(),
  ]);
  // Point 5: optional event-type (category) filter — narrows the whole stats view
  // (dropdown, aggregate) to one event type (e.g. Lari / HYROX).
  const typeOptions = [...new Set((scopedEvents || []).map((e) => e.category).filter(Boolean))].sort();
  const selectedType = (typeRaw && typeOptions.includes(typeRaw)) ? typeRaw : '';
  const viewEvents = selectedType ? scopedEvents.filter((e) => e.category === selectedType) : scopedEvents;
  const evById = new Map(viewEvents.map((e) => [e.id, e]));
  const myIds = new Set(viewEvents.map((e) => e.id));
  const talentById = new Map(talents.map((tt) => [tt.id, tt]));
  const posMaster = new Map(master.map((p) => [p.id, p]));
  const choicesByApp = new Map();
  (choices || []).forEach((c) => { const a = choicesByApp.get(c.application_id) || []; a.push(c); choicesByApp.set(c.application_id, a); });
  const accepted = new Set(['approved', 'assigned', 'completed']);
  const pctOf = (tid) => V.profileStrength(talentById.get(tid) || {}).pct;
  const avgOf = (tids) => (tids.length ? Math.round(tids.reduce((s, id) => s + pctOf(id), 0) / tids.length) : 0);

  const selectedId = myIds.has(selectedIdRaw) ? selectedIdRaw : '';
  let eventStats = null;
  if (selectedId) {
    const ev = evById.get(selectedId);
    const positions = await st.listEventPositions(ev.id);
    const view = eoEventView(ev, positions, apps, choices);
    const evApps = apps.filter((a) => a.event_id === ev.id);
    const statusCounts = {};
    evApps.forEach((a) => { const s = a.status || 'applied'; statusCounts[s] = (statusCounts[s] || 0) + 1; });
    const tids = [...new Set(evApps.map((a) => a.talent_id))];
    eventStats = {
      id: ev.id, name: ev.name, applyCount: view.applyCount,
      approvedCount: evApps.filter((a) => accepted.has(a.status)).length,
      positions: view.positions, statusCounts, talentCount: tids.length, avgStrength: avgOf(tids),
    };
  }

  const scopedApps = apps.filter((a) => myIds.has(a.event_id));
  const catAgg = { kol: { total: 0, approved: 0 }, creative: { total: 0, approved: 0 }, manpower: { total: 0, approved: 0 } };
  const catOf = (key) => (key === 'kol' ? 'kol' : (key === 'fotografer' || key === 'videografer' ? 'creative' : 'manpower'));
  scopedApps.forEach((a) => {
    const ch = (choicesByApp.get(a.id) || []).slice().sort((x, y) => x.priority - y.priority);
    if (!ch.length) return;
    const p1 = posMaster.get(ch[0].position_id) || {};
    const cat = catOf(p1.key || (talentById.get(a.talent_id) || {}).talent_type || '');
    catAgg[cat].total += 1;
    if (accepted.has(a.status)) catAgg[cat].approved += 1;
  });
  const allTids = [...new Set(scopedApps.map((a) => a.talent_id))];
  const aggregate = {
    totalEvents: viewEvents.length,
    totalApplies: scopedApps.length,
    totalApproved: scopedApps.filter((a) => accepted.has(a.status)).length,
    avgStrength: avgOf(allTids),
    catRows: [
      { key: 'kol', total: catAgg.kol.total, approved: catAgg.kol.approved },
      { key: 'creative', total: catAgg.creative.total, approved: catAgg.creative.approved },
      { key: 'manpower', total: catAgg.manpower.total, approved: catAgg.manpower.approved },
    ],
  };
  return { events: viewEvents.map((e) => ({ id: e.id, name: e.name })), selectedId, eventStats, aggregate, typeOptions, selectedType };
}

app.get('/eo', requireEo, async (req, res, next) => {
  try {
    const st = db();
    if (!st) return needConfig(req, res);
    const [stats, profile, allEvents] = await Promise.all([eoStats(st, req.staff.id), st.getEoProfile(req.staff.id), st.listEvents()]);
    // Statistics section is now embedded in the dashboard; ?event=<id> drives it.
    const mine = allEvents.filter((e) => e.created_by === req.staff.id)
      .sort((a, b) => String(b.starts_at || b.created_at || '').localeCompare(String(a.starts_at || a.created_at || '')));
    const statsData = await statsPageData(st, mine, String(req.query.event || ''), String(req.query.type || ''));
    res.send(V.eoDashboard({ staff: eoCtx(req), stats, statsData, profileComplete: eoProfileComplete(profile), lang: req.lang }));
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

// EO: the Applicants manager (sidebar "Talents"). Gathers every applicant to
// this EO's own events, with their ranked position choices, live status,
// contact + profile, and per-position quota (for the accept buttons). Opening
// this page also moves this EO's fresh applications to "under review", mirroring
// the old per-event applicant list. ?event=<id> pre-selects that event's filter.
app.get('/eo/talents', requireEo, async (req, res, next) => {
  try {
    const st = db();
    if (!st) return needConfig(req, res);
    const [allEvents, apps, choicesAll, talents, master] = await Promise.all([
      st.listEvents(), st.listApplications(), st.listApplicationChoices(), st.listTalents(), st.listPositions(),
    ]);
    const mine = allEvents.filter((e) => e.created_by === req.staff.id)
      .sort((a, b) => String(b.starts_at || b.created_at || '').localeCompare(String(a.starts_at || a.created_at || '')));
    const myIds = new Set(mine.map((e) => e.id));
    const eventName = new Map(mine.map((e) => [e.id, e.name]));
    const talentById = new Map(talents.map((tt) => [tt.id, tt]));
    const posMaster = new Map(master.map((p) => [p.id, p]));
    const choicesByApp = new Map();
    (choicesAll || []).forEach((c) => { const arr = choicesByApp.get(c.application_id) || []; arr.push(c); choicesByApp.set(c.application_id, arr); });

    // Move applied/pending -> under_review for this EO's applications that carry
    // choices (idempotent; same transition the per-event list used to do), and
    // notify each talent once.
    const nowUR = [];
    for (const a of apps) {
      if (myIds.has(a.event_id) && (a.status === 'applied' || a.status === 'pending') && (choicesByApp.get(a.id) || []).length) {
        await st.updateApplication(a.id, { status: 'under_review' }); a.status = 'under_review'; nowUR.push(a);
      }
    }
    for (const a of nowUR) {
      const tt = talentById.get(a.talent_id) || {}; const to = tt.login; if (!to || !/@/.test(to)) continue;
      const top = (choicesByApp.get(a.id) || []).slice().sort((x, y) => x.priority - y.priority)[0];
      const pos = top && posMaster.get(top.position_id);
      const positionName = pos ? (pos.custom_label || pos.label_en || pos.label_id || 'Position') : 'Position';
      mailer.sendUnderReviewEmail({ to, name: tt.name || '', eventName: eventName.get(a.event_id) || 'Event 20FIT', positionName, eventDate: eventDateStrEn(mine.find((e) => e.id === a.event_id) || {}) })
        .catch((err) => console.warn('[mail] under-review send failed for ' + to + ': ' + (err && err.message)));
    }

    // accepted count per (event|position) so full positions disable their accept button.
    const acceptedCount = new Map();
    const appEvent = new Map(apps.map((a) => [a.id, a.event_id]));
    (choicesAll || []).forEach((c) => { if (!c.accepted) return; const eid = appEvent.get(c.application_id); if (!myIds.has(eid)) return; const k = eid + '|' + c.position_id; acceptedCount.set(k, (acceptedCount.get(k) || 0) + 1); });
    const evPositions = new Map();
    await Promise.all([...myIds].map(async (eid) => evPositions.set(eid, await st.listEventPositions(eid))));

    const applicants = [];
    const posKeySeen = new Map();
    for (const a of apps) {
      if (!myIds.has(a.event_id)) continue;
      const ch = (choicesByApp.get(a.id) || []).slice().sort((x, y) => x.priority - y.priority);
      if (!ch.length) continue;
      const tt = talentById.get(a.talent_id) || {};
      const evPosById = new Map((evPositions.get(a.event_id) || []).map((p) => [p.position_id, p]));
      const choices = ch.map((c) => {
        const mp = posMaster.get(c.position_id) || {};
        const ep = evPosById.get(c.position_id) || {};
        const quota = ep.quota || 0;
        const full = quota > 0 && !c.accepted && (acceptedCount.get(a.event_id + '|' + c.position_id) || 0) >= quota;
        const key = mp.key || '';
        if (key && !posKeySeen.has(key)) posKeySeen.set(key, { key, label_id: mp.label_id, label_en: mp.label_en });
        return { priority: c.priority, position_id: c.position_id, key, label_id: mp.label_id, label_en: mp.label_en, custom_label: ep.custom_label || null, accepted: !!c.accepted, full };
      });
      applicants.push({
        id: a.id, eventId: a.event_id, eventName: eventName.get(a.event_id) || '—',
        name: tt.name || '—', type: a.talent_type || tt.talent_type || null,
        phone: tt.phone || null, city: tt.city || null, instagram: tt.instagram || null, login: tt.login || null,
        hyroxStatus: tt.hyrox_cert_status || 'none', profile: tt,
        status: a.status || 'applied', createdAt: a.created_at, choices,
      });
    }
    applicants.sort((x, y) => String(y.createdAt || '').localeCompare(String(x.createdAt || '')));
    const selectedEvent = myIds.has(String(req.query.event || '')) ? String(req.query.event) : '';
    res.send(V.eoApplicantsPage({ staff: eoCtx(req), events: mine.map((e) => ({ id: e.id, name: e.name })), applicants, positionsUnion: [...posKeySeen.values()], selectedEvent, lang: req.lang }));
  } catch (e) { next(e); }
});

// EO: Statistics page — per-event breakdown across this EO's own events.
// Statistics is now embedded in the EO dashboard; keep this path working for old
// links/bookmarks by redirecting (carrying any selected event through).
app.get('/eo/stats', requireEo, (req, res) => {
  const ev = String(req.query.event || '');
  res.redirect('/eo' + (ev ? '?event=' + encodeURIComponent(ev) : ''));
});

// --- EO: event management ---------------------------------------------------
const EO_STATUSES = ['draft', 'published']; // EO-settable; 'closed' comes from the close button

// Load an EO's own event by id, or null if not theirs.
async function eoOwnedEvent(st, staffId, eventId) {
  return (await st.listEvents()).find((e) => e.id === eventId && e.created_by === staffId) || null;
}
const POS_DETAIL_KEYS = ['work_hours', 'venue_detail', 'dresscode', 'meeting_point', 'kol_content', 'kol_deadline', 'kol_min_followers', 'kol_hashtags', 'photo_output', 'photo_deadline', 'photo_equipment'];
// Sentinel quota for form-created positions now that the quota field is gone:
// high enough that a position never reads as "full" (registration is unlimited).
const UNLIMITED_QUOTA = 100000;
function eoSelMap(positions) {
  const m = {};
  (positions || []).forEach((p) => {
    const o = { quota: p.quota, description: p.description || '', description_en: p.description_en || '', custom_label: p.custom_label || '', custom_label_en: p.custom_label_en || '', jobdesk: p.jobdesk || '', jobdesk_en: p.jobdesk_en || '', requirement: p.requirement || '', requirement_en: p.requirement_en || '', fee: p.fee || '' };
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
    name: s('name', 140), description: s('description', 4000) || null, description_en: s('description_en', 4000) || null, category: s('category', 80) || null,
    location: s('location', 200) || null, starts_at: s('starts_at', 10) || null, ends_at: s('ends_at', 10) || null,
    start_time: s('start_time', 5) || null, end_time: s('end_time', 5) || null,
    reg_open: s('reg_open', 10) || null, reg_deadline: s('reg_deadline', 10) || null,
    reg_open_time: s('reg_open_time', 5) || null, reg_deadline_time: s('reg_deadline_time', 5) || null,
    status: EO_STATUSES.includes(st) ? st : 'draft',
  };
  const validIds = new Set((positionsMaster || []).map((p) => p.id));
  const keyById = new Map((positionsMaster || []).map((p) => [String(p.id), p.key]));
  const chosen = [].concat(req.body.pos || []);
  const seen = new Set(); const positions = [];
  chosen.forEach((id) => {
    id = String(id);
    if (!validIds.has(id) || seen.has(id)) return;
    // Quota (how many talents this position needs) is required in the form and
    // validated in validateEventForm. We still fall back to the UNLIMITED_QUOTA
    // sentinel here for a blank value so parsing never crashes; validation rejects
    // it before save. Legacy positions saved before quota was required keep the
    // sentinel and render as "no quota limit" on the card.
    const existingQ = parseInt(req.body['quota_' + id], 10);
    const q = Number.isFinite(existingQ) && existingQ > 0 ? existingQ : UNLIMITED_QUOTA;
    // Per-field getter (trim + cap length; empty -> null).
    const g = (f, max) => String(req.body[f + '_' + id] || '').trim().slice(0, max) || null;
    const key = keyById.get(id);
    const pos = {
      position_id: id, quota: q, key,
      // Short role description shown on the talent card face; auto-filled from a
      // per-role template but freely editable by the EO. _en holds the optional
      // English version the EO can type; display falls back across languages.
      description: g('description', 600), description_en: g('description_en', 600),
      // Custom name for the "Lainnya" (other) slot only; ignored for fixed roles.
      custom_label: key === 'other' ? g('custom_label', 80) : null,
      custom_label_en: key === 'other' ? g('custom_label_en', 80) : null,
      jobdesk: g('jobdesk', 1000), jobdesk_en: g('jobdesk_en', 1000),
      requirement: g('requirement', 1000), requirement_en: g('requirement_en', 1000), fee: g('fee', 200),
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
  // Search period (WIB): close must not be before open, nor after the event starts.
  const d = f.data;
  const openDT = d.reg_open ? d.reg_open + 'T' + (d.reg_open_time || '00:00') : null;
  const closeDT = d.reg_deadline ? d.reg_deadline + 'T' + (d.reg_deadline_time || '23:59') : null;
  if (openDT && closeDT && closeDT < openDT) e.push(req.t('eo.ev.err.regCloseBeforeOpen'));
  if (d.reg_deadline && d.starts_at && d.reg_deadline > d.starts_at) e.push(req.t('eo.ev.err.regCloseAfterStart'));
  if (!f.positions.length) e.push(req.t('eo.ev.err.positions'));
  // The "Lainnya" (custom) role needs a name to identify it.
  if (f.positions.some((p) => p.key === 'other' && !p.custom_label)) e.push(req.t('eo.ev.err.customNameRequired'));
  // Every selected position needs a real headcount so its card can show how many
  // talents are wanted. An empty quota parses to the UNLIMITED_QUOTA sentinel, so
  // any position at/above it means the EO left the field blank.
  if (f.positions.some((p) => !(p.quota > 0 && p.quota < UNLIMITED_QUOTA))) e.push(req.t('eo.ev.err.quota'));
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
    const [positionsMaster, eventTypes] = await Promise.all([st.listPositions(), st.listEventTypes()]);
    res.send(V.eoEventForm({ staff: eoCtx(req), event: null, positionsMaster, eventTypes, selected: {}, lang: req.lang }));
  } catch (e) { next(e); }
});

app.post('/eo/events', requireEo, upload.single('poster'), async (req, res, next) => {
  try {
    const st = db();
    if (!st) return needConfig(req, res);
    if (!eoProfileComplete(await st.getEoProfile(req.staff.id))) return res.redirect('/eo/profile');
    const [positionsMaster, eventTypes] = await Promise.all([st.listPositions(), st.listEventTypes()]);
    const f = parseEventForm(req, positionsMaster);
    const errors = validateEventForm(f, req);
    if (errors.length) return res.status(400).send(V.eoEventForm({ staff: eoCtx(req), event: f.echo, positionsMaster, eventTypes, selected: eoSelMap(f.positions), errors, lang: req.lang }));
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
    const [positionsMaster, evPos, eventTypes] = await Promise.all([st.listPositions(), st.listEventPositions(ev.id), st.listEventTypes()]);
    await attachMockups(st, ev);
    res.send(V.eoEventForm({ staff: eoCtx(req), event: ev, positionsMaster, eventTypes, selected: eoSelMap(evPos), lang: req.lang }));
  } catch (e) { next(e); }
});

app.post('/eo/events/:id/edit', requireEo, upload.single('poster'), async (req, res, next) => {
  try {
    const st = db();
    if (!st) return needConfig(req, res);
    const ev = await eoOwnedEvent(st, req.staff.id, req.params.id);
    if (!ev) return res.redirect('/eo/events');
    const [positionsMaster, evPos, apps, choices, eventTypes] = await Promise.all([st.listPositions(), st.listEventPositions(ev.id), st.listApplications(), st.listApplicationChoices(), st.listEventTypes()]);
    const f = parseEventForm(req, positionsMaster);
    const errors = validateEventForm(f, req);
    // Guards: a position with applicants can't be removed; quota can't drop below accepted.
    const view = eoEventView(ev, evPos, apps, choices);
    const newByPos = eoSelMap(f.positions);
    view.positions.forEach((p) => {
      if (p.applicants > 0 && !p.closed_at && !(p.position_id in newByPos)) errors.push(req.t('eo.ev.err.cantRemovePos'));
      if (p.position_id in newByPos && newByPos[p.position_id].quota < p.filled) errors.push(req.t('eo.ev.err.quotaBelowAccepted'));
    });
    if (errors.length) return res.status(400).send(V.eoEventForm({ staff: eoCtx(req), event: Object.assign({}, ev, f.echo), positionsMaster, eventTypes, selected: newByPos, errors, lang: req.lang }));
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

// Point 4: EO sets/edits the event's talent-group link (WhatsApp/Telegram) from the
// Event Detail dashboard. Saving a non-empty link emails every Assigned talent who
// hasn't been notified yet (first save → all of them). Editing the link later does
// NOT re-notify anyone (no re-spam) — use "Resend to All" for that. Clearing it
// hides the link (talents see "coming soon" again).
app.post('/eo/events/:id/group', requireEo, async (req, res, next) => {
  try {
    const st = db();
    if (!st) return needConfig(req, res);
    const ev = await eoOwnedEvent(st, req.staff.id, req.params.id);
    if (!ev) return res.redirect('/eo/events');
    const backTo = '/eo/events/' + ev.id + '?lang=' + req.lang;
    let url = String(req.body.group_url || '').trim();
    if (url && !/^https?:\/\//i.test(url)) url = 'https://' + url; // tolerate a pasted bare host
    if (url && !/^https?:\/\/[^\s.]+\.[^\s]+$/i.test(url)) return res.redirect(backTo + '&gerr=1');
    await st.updateEvent(ev.id, { group_url: url || null });
    if (!url) return res.redirect(backTo + '&gcleared=1');
    ev.group_url = url;
    const notified = await notifyGroupForAssigned(st, ev);
    return res.redirect(backTo + '&gok=' + notified);
  } catch (e) { next(e); }
});

// Point 4: "Resend to All" — re-email the group link to every Assigned talent for
// this event, regardless of whether they were notified before.
app.post('/eo/events/:id/group/resend', requireEo, async (req, res, next) => {
  try {
    const st = db();
    if (!st) return needConfig(req, res);
    const ev = await eoOwnedEvent(st, req.staff.id, req.params.id);
    if (!ev) return res.redirect('/eo/events');
    const backTo = '/eo/events/' + ev.id + '?lang=' + req.lang;
    if (!ev.group_url) return res.redirect(backTo + '&gerr=1');
    const notified = await notifyGroupForAssigned(st, ev, { force: true });
    return res.redirect(backTo + '&gresent=' + notified);
  } catch (e) { next(e); }
});

app.get('/eo/events/:id', requireEo, async (req, res, next) => {
  try {
    const st = db();
    if (!st) return needConfig(req, res);
    const ev = await eoOwnedEvent(st, req.staff.id, req.params.id);
    if (!ev) return res.redirect('/eo/events');
    const [positions, apps, choices, talents] = await Promise.all([
      st.listEventPositions(ev.id), st.listApplications(), st.listApplicationChoices(), st.listTalents(),
    ]);
    const view = eoEventView(ev, positions, apps, choices);
    // Tahap 6: applicants for this event, each with their prioritised choices + contact.
    const talentById = new Map(talents.map((tt) => [tt.id, tt]));
    const choicesByApp = new Map();
    choices.forEach((c) => { const a = choicesByApp.get(c.application_id) || []; a.push(c); choicesByApp.set(c.application_id, a); });
    // #7: as soon as the owning EO opens the applicant list, move this event's
    // still-new applications to "under_review" so the talent's tracker lights up
    // the Review stage. Idempotent — only touches applied/pending rows.
    const nowUnderReview = [];
    for (const a of apps) {
      if (a.event_id === ev.id && (a.status === 'applied' || a.status === 'pending') && (choicesByApp.get(a.id) || []).length) {
        await st.updateApplication(a.id, { status: 'under_review' }); a.status = 'under_review';
        nowUnderReview.push(a);
      }
    }
    // Notify each talent (English, always) that their application is under review.
    // Fire-and-forget so a slow/failed mail send never blocks the applicants page.
    if (nowUnderReview.length) {
      const posById = new Map(positions.map((p) => [p.position_id, p]));
      for (const a of nowUnderReview) {
        const tt = talentById.get(a.talent_id) || {};
        const to = tt.login;
        if (!to || !/@/.test(to)) continue;
        const top = (choicesByApp.get(a.id) || []).slice().sort((x, y) => x.priority - y.priority)[0];
        const pos = top && posById.get(top.position_id);
        const positionName = pos ? (pos.custom_label || pos.label_en || pos.label_id || 'Position') : 'Position';
        mailer.sendUnderReviewEmail({ to, name: tt.name || '', eventName: ev.name || 'Event 20FIT', positionName, eventDate: eventDateStrEn(ev) })
          .catch((err) => console.warn('[mail] under-review send failed for ' + to + ': ' + (err && err.message)));
      }
    }
    const applicants = apps
      .filter((a) => a.event_id === ev.id && (choicesByApp.get(a.id) || []).length)
      .map((a) => {
        const tt = talentById.get(a.talent_id) || {};
        const ch = (choicesByApp.get(a.id) || []).slice().sort((x, y) => x.priority - y.priority)
          .map((c) => ({ priority: c.priority, position_id: c.position_id, accepted: !!c.accepted }));
        return {
          id: a.id, talentId: a.talent_id, name: tt.name || '—', type: a.talent_type || tt.talent_type || null,
          phone: tt.phone || null, city: tt.city || null, instagram: tt.instagram || null, login: tt.login || null,
          hyroxStatus: tt.hyrox_cert_status || 'none', profile: tt,
          status: a.status || 'applied', createdAt: a.created_at, choices: ch,
        };
      })
      .sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
    await attachMockups(st, ev);
    const flash = { ok: String(req.query.ok || ''), err: String(req.query.err || ''),
      gok: req.query.gok, gcleared: req.query.gcleared, gerr: req.query.gerr, gresent: req.query.gresent };
    res.send(V.eoEventDetail({ staff: eoCtx(req), event: ev, view, applicants, flash, lang: req.lang }));
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

// Accept an applicant into one of their chosen positions (respects quota BR-9;
// the DB enforces one accepted position per application).
// #4: serialize accept operations per event so the quota read-then-write cannot
// race two simultaneous accepts into over-filling a position. Single-process
// guard (matches this app's single-instance deployment); for multi-node this
// should be paired with a DB-level quota constraint.
const _eventAcceptLocks = new Map();
function withEventLock(eventId, fn) {
  const prev = _eventAcceptLocks.get(eventId) || Promise.resolve();
  const run = prev.then(fn, fn); // run regardless of the previous op's outcome
  _eventAcceptLocks.set(eventId, run.then(() => {}, () => {}));
  return run;
}
// #5 (Option A): one accepted position per talent per event. When a talent is
// accepted into a position, decline their other still-open applications for the
// same event (their other position picks lapse). Returns how many were declined.
async function autoDeclineOtherApps(st, apps, eventId, talentId, keepAppId, reviewerId) {
  const others = (apps || []).filter((a) => a.event_id === eventId && a.talent_id === talentId && a.id !== keepAppId && !['approved', 'rejected'].includes(a.status));
  for (const o of others) {
    await st.clearApplicationAccepted(o.id);
    await st.updateApplication(o.id, { status: 'rejected', reviewed_by: reviewerId, reviewed_at: new Date().toISOString(), note: AUTO_DECLINED_NOTE });
  }
  return others.length;
}
app.post('/eo/events/:id/applicants/:appId/accept', requireEo, async (req, res, next) => {
  try {
    const st = db();
    if (!st) return needConfig(req, res);
    const found = await eoOwnedApplication(st, req.staff.id, req.params.id, req.params.appId);
    if (!found) return res.redirect('/eo/events');
    const backTo = '/eo/events/' + found.ev.id + '?lang=' + req.lang;
    const next = safeNext(req.body.next); // e.g. /eo/talents when acting from the Applicants page
    const positionId = String(req.body.position_id || '');
    const outcome = await withEventLock(found.ev.id, async () => {
      const [positions, apps, choices] = await Promise.all([st.listEventPositions(found.ev.id), st.listApplications(), st.listApplicationChoices()]);
      const myChoices = choices.filter((c) => c.application_id === found.app.id);
      if (!myChoices.some((c) => c.position_id === positionId)) return 'skip'; // not one of their choices
      const pos = positions.find((p) => p.position_id === positionId);
      const quota = pos ? pos.quota : 0;
      // Quota check: accepted choices for this position across the event, excluding this application.
      const appIds = new Set(apps.filter((a) => a.event_id === found.ev.id).map((a) => a.id));
      const acceptedElsewhere = choices.filter((c) => c.position_id === positionId && c.accepted && c.application_id !== found.app.id && appIds.has(c.application_id)).length;
      if (quota > 0 && acceptedElsewhere >= quota) return 'full';
      const wasApproved = found.app.status === 'approved';
      await st.acceptApplicationChoice(found.app.id, positionId);
      await st.updateApplication(found.app.id, { status: 'approved', reviewed_by: req.staff.id, reviewed_at: new Date().toISOString() });
      await autoDeclineOtherApps(st, apps, found.ev.id, found.app.talent_id, found.app.id, req.staff.id);
      // Email the talent their acceptance only on the first approval (mirrors the
      // admin path's no-spam rule; re-accepting a different position won't resend).
      if (!wasApproved) notifyPositionAcceptance(st, found.app, found.ev, positionId).catch((e) => console.error('[mail] EO acceptance email failed:', e && e.message));
      return 'ok';
    });
    if (outcome === 'full') return res.redirect(next || (backTo + '&err=full'));
    if (outcome === 'skip') return res.redirect(next || backTo);
    res.redirect(next || (backTo + '&ok=accepted'));
  } catch (e) { next(e); }
});

// Reject an applicant (clears any acceptance).
app.post('/eo/events/:id/applicants/:appId/reject', requireEo, async (req, res, next) => {
  try {
    const st = db();
    if (!st) return needConfig(req, res);
    const found = await eoOwnedApplication(st, req.staff.id, req.params.id, req.params.appId);
    if (!found) return res.redirect('/eo/events');
    const wasRejected = found.app.status === 'rejected';
    await st.clearApplicationAccepted(found.app.id);
    await st.updateApplication(found.app.id, { status: 'rejected', reviewed_by: req.staff.id, reviewed_at: new Date().toISOString() });
    if (!wasRejected) notifyPositionRejection(st, found.app, found.ev).catch((e) => console.error('[mail] EO rejection email failed:', e && e.message));
    res.redirect(safeNext(req.body.next) || ('/eo/events/' + found.ev.id + '?lang=' + req.lang + '&ok=rejected'));
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
    await st.updateApplication(found.app.id, { status: 'applied', reviewed_by: null, reviewed_at: null });
    res.redirect(safeNext(req.body.next) || ('/eo/events/' + found.ev.id + '?lang=' + req.lang));
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
    // Event Statistics is embedded in the dashboard; a super admin sees every event.
    const evSorted = events.slice().sort((a, b) => String(b.starts_at || b.created_at || '').localeCompare(String(a.starts_at || a.created_at || '')));
    const statsData = await statsPageData(st, evSorted, String(req.query.event || ''), String(req.query.type || ''));
    res.send(V.adminDashboard({ staff: staffCtx(req), proofs, events, talents: talentsAll, assignments, settings, statsData, lang: req.lang }));
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

// Super Admin: Statistics is now embedded in the dashboard; redirect old links.
app.get('/admin/stats', auth.requireStaff(['super_admin']), (req, res) => {
  const ev = String(req.query.event || '');
  res.redirect('/admin' + (ev ? '?event=' + encodeURIComponent(ev) : ''));
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
    const [events, assignments, talents, eos, settings, proofs, apps, choicesAll, positions] = await Promise.all([
      st.listEvents(), st.listAssignments(), st.listTalents(), st.listStaff('eo'), st.getSettings(), st.listProofs(),
      st.listApplications(), st.listApplicationChoices(), st.listPositions(),
    ]);
    await attachMockups(st, events);
    // Attach opened positions per event so the NEEDS column reflects the shared position model.
    await Promise.all(events.map(async (e) => { e.positions = await st.listEventPositions(e.id); }));
    // Cross-event aggregate: total + approved applications per talent category (by P1 position).
    const posKeyById = new Map(positions.map((p) => [p.id, p.key]));
    const choicesByApp = new Map();
    (choicesAll || []).forEach((c) => { const arr = choicesByApp.get(c.application_id) || []; arr.push(c); choicesByApp.set(c.application_id, arr); });
    const catOfApp = (a) => {
      const chs = (choicesByApp.get(a.id) || []).slice().sort((x, y) => x.priority - y.priority);
      const primary = (chs[0] && posKeyById.get(chs[0].position_id)) || a.talent_type;
      if (primary === 'kol') return 'kol';
      if (primary === 'fotografer' || primary === 'videografer') return 'creative';
      return 'manpower';
    };
    const agg = { manpower: { total: 0, approved: 0 }, kol: { total: 0, approved: 0 }, creative: { total: 0, approved: 0 } };
    apps.forEach((a) => { const c = catOfApp(a); agg[c].total++; if (a.status === 'approved') agg[c].approved++; });
    const applicantStats = ['manpower', 'kol', 'creative'].map((k) => ({ key: k, total: agg[k].total, approved: agg[k].approved }));
    res.send(V.adminManage({ staff: staffCtx(req), events, assignments, talents, eos, proofs, lang: req.lang, settings, applicantStats }));
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
    await withEventLock(app0.event_id, async () => {
      const apps = await st.listApplications();
      const app = apps.find((a) => a.id === req.params.id);
      if (!app) return;
      const [positions, choices] = await Promise.all([st.listEventPositions(app.event_id), st.listApplicationChoices()]);
      if (!choices.some((c) => c.application_id === app.id && c.position_id === positionId)) return; // not one of their picks
      const pos = positions.find((p) => p.position_id === positionId);
      const quota = pos ? pos.quota : 0;
      const appIds = new Set(apps.filter((a) => a.event_id === app.event_id).map((a) => a.id));
      const acceptedElsewhere = choices.filter((c) => c.position_id === positionId && c.accepted && c.application_id !== app.id && appIds.has(c.application_id)).length;
      if (quota > 0 && acceptedElsewhere >= quota) return; // position full
      const wasApproved = app.status === 'approved';
      await st.acceptApplicationChoice(app.id, positionId);
      await st.updateApplication(app.id, { status: 'approved', reviewed_by: req.staff.id, reviewed_at: new Date().toISOString() });
      await autoDeclineOtherApps(st, apps, app.event_id, app.talent_id, app.id, req.staff.id);
      const ev = (await st.listEvents()).find((e) => e.id === app.event_id);
      if (!wasApproved && ev) notifyPositionAcceptance(st, app, ev, positionId).catch((e) => console.error('[mail] acceptance email failed:', e && e.message));
    });
    res.redirect('/admin/applications');
  } catch (e) { next(e); }
});

app.post('/admin/applications/:id/reject-position', auth.requireStaff(['super_admin']), async (req, res, next) => {
  try {
    const st = db();
    if (!st) return needConfig(req, res);
    const app = (await st.listApplications()).find((a) => a.id === req.params.id);
    if (!app) return res.redirect('/admin/applications');
    const wasRejected = app.status === 'rejected';
    await st.clearApplicationAccepted(app.id);
    await st.updateApplication(app.id, { status: 'rejected', reviewed_by: req.staff.id, reviewed_at: new Date().toISOString() });
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

// Fire-and-forget "Application Received" email the moment a talent submits a NEW
// application (status Applied). Always English + generic (no event/position).
// Logs the outcome clearly — sent / not-delivered / failed — so a send that fails
// is never silent, and it never blocks or fails the apply response.
function notifyApplicationReceived(account) {
  const to = account && account.login;
  if (!to || !/@/.test(to)) { console.warn('[mail] application-received skipped: talent has no email on file'); return; }
  mailer.sendApplicationReceivedEmail({ to, name: account.name || '' })
    .then((r) => {
      if (!r || r.delivered === false) console.warn('[mail] application-received NOT delivered to ' + to + ' — email service not configured (RESEND_API_KEY / MAIL_MOCK) or the send was rejected');
      else console.log('[mail] application-received sent to ' + to);
    })
    .catch((err) => console.error('[mail] application-received send FAILED for ' + to + ': ' + (err && err.message)));
}

// Email a talent whose EO/admin accepted them into a position, asking them to
// confirm their spot (Agree on their profile → Assigned). Always English, per spec.
// Best-effort — never blocks the accept response.
async function notifyPositionAcceptance(st, app, ev, positionId) {
  const account = await st.getAccountById(app.talent_id);
  const to = account && account.login;
  if (!to || !/@/.test(to)) return; // no usable email on file
  let posLabel = 'Position';
  try {
    const positions = await st.listEventPositions(ev.id);
    const pos = positions.find((p) => p.position_id === positionId);
    if (pos) posLabel = pos.custom_label_en || pos.custom_label || pos.label_en || pos.label_id || 'Position';
  } catch (_) { /* position label is best-effort */ }
  await mailer.sendSpotConfirmEmail({
    to, name: account.name,
    eventName: ev.name || 'Event 20FIT',
    positionName: posLabel,
    eventDate: eventDateStrEn(ev),
  });
}

// Point 4: email the event's WhatsApp/Telegram group link to its Assigned talents.
// Idempotent per application via talent_applications.group_notified_at — each
// assigned talent is emailed exactly once (unless opts.force, i.e. "Resend to All").
// Best-effort and always English: a send that throws is not stamped, so it retries.
// Returns how many talents were emailed. No-op when the event has no group link.
async function notifyGroupForAssigned(st, ev, opts = {}) {
  if (!ev || !ev.group_url) return 0;
  const force = !!opts.force;
  const apps = await st.listApplications();
  const targets = apps.filter((a) => a.event_id === ev.id && a.status === 'assigned' && (force || !a.group_notified_at));
  if (!targets.length) return 0;
  let positions = [];
  try { positions = await st.listEventPositions(ev.id); } catch (_) { /* label best-effort */ }
  const choices = await st.listApplicationChoices().catch(() => []);
  const acceptedByApp = new Map();
  choices.forEach((c) => { if (c.accepted) acceptedByApp.set(c.application_id, c.position_id); });
  const posById = new Map(positions.map((p) => [p.position_id, p]));
  let sent = 0;
  for (const a of targets) {
    const account = await st.getAccountById(a.talent_id);
    const to = account && account.login;
    if (!to || !/@/.test(to)) continue; // no usable email on file
    const pid = acceptedByApp.get(a.id);
    const pos = pid ? posById.get(pid) : null;
    const positionName = pos ? (pos.custom_label_en || pos.custom_label || pos.label_en || pos.label_id || '') : '';
    try {
      await mailer.sendGroupInviteEmail({ to, name: account.name, eventName: ev.name || 'Event 20FIT', positionName, groupUrl: ev.group_url });
      await st.updateApplication(a.id, { group_notified_at: new Date().toISOString() });
      sent++;
    } catch (err) {
      console.warn('[mail] group-invite send failed for ' + to + ': ' + (err && err.message));
    }
  }
  return sent;
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

// --- H-1 event reminders --------------------------------------------------
// All date math is done in Asia/Jakarta (WIB) so "tomorrow" matches the local
// calendar day, not the server's UTC day.
function jakartaDateStr(d) { return (d || new Date()).toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' }); }
function addDaysYMD(ymd, n) { const d = new Date(ymd + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
function jakartaHour(d) { return parseInt((d || new Date()).toLocaleString('en-GB', { timeZone: 'Asia/Jakarta', hour: '2-digit', hour12: false }), 10); }
// Current WIB wall-clock as "YYYY-MM-DDTHH:MM" for lexical comparison with reg open/close.
function jakartaNowStr(d) { const n = d || new Date(); return jakartaDateStr(n) + 'T' + n.toLocaleString('en-GB', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit', hour12: false }); }

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

// Hourly scheduler: run the H-1 job once per day during daytime WIB (so nobody
// is pinged at 3am). reminder_sent_at guarantees a single reminder per talent
// even though the check runs every hour. Disable with REMINDERS_DISABLED=1.
let _remTimer = null;
function startReminderScheduler() {
  if (_remTimer || process.env.REMINDERS_DISABLED === '1') return;
  const tick = () => {
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

// ---- HYROX certificate verification (Super Admin only) ----------------------
// Talents upload a HYROX 360 certificate on their Dokumen page; the super admin
// reviews it here. Verification is global (once verified it counts for every
// event). EOs never reach this pool — cert review is a platform-wide function,
// not a per-event one, so it lives entirely inside the Super Admin area.
app.get('/admin/hyrox', auth.requireStaff(['super_admin']), async (req, res, next) => {
  try {
    const st = db();
    if (!st) return needConfig(req, res);
    const rk = (s) => (s === 'pending' ? 0 : s === 'rejected' ? 1 : 2); // pending first
    let certs = (await st.listHyroxCerts()).slice();
    certs = certs.sort((a, b) => rk(a.hyrox_cert_status) - rk(b.hyrox_cert_status) || String(a.name || '').localeCompare(String(b.name || '')));
    res.send(V.adminHyroxCerts({ staff: staffCtx(req), certs, lang: req.lang }));
  } catch (e) { next(e); }
});

// Stream a talent's uploaded HYROX certificate to the reviewing super admin.
app.get('/admin/hyrox/:talentId/file', auth.requireStaff(['super_admin']), async (req, res, next) => {
  try {
    const st = db();
    if (!st) return needConfig(req, res);
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
app.post('/admin/hyrox/:talentId/review', auth.requireStaff(['super_admin']), async (req, res, next) => {
  try {
    const st = db();
    if (!st) return needConfig(req, res);
    const action = String(req.body.action || '');
    if (action !== 'verify' && action !== 'reject') return res.redirect('/admin/hyrox');
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

// Super admin: download a certificate PDF.
app.get('/admin/certificates/:id', auth.requireStaff(['super_admin']), async (req, res, next) => {
  try {
    const st = db();
    if (!st) return needConfig(req, res);
    const c = await st.getCertificate(req.params.id);
    if (!c) return res.redirect('/admin/applications');
    const base = (process.env.APP_BASE_URL || (req.protocol + '://' + req.get('host'))).replace(/\/+$/, '');
    const buf = await cert.renderCertificatePDF(await buildCertRenderData(st, c, base));
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

// Super admin uses the SAME position-based event form as EO (shared eoEventForm).
app.get('/admin/events/new', auth.requireStaff(['super_admin']), async (req, res, next) => {
  try {
    const st = db();
    if (!st) return needConfig(req, res);
    const [positionsMaster, eventTypes] = await Promise.all([st.listPositions(), st.listEventTypes()]);
    res.send(V.eoEventForm({ staff: staffCtx(req), event: null, positionsMaster, eventTypes, selected: {}, lang: req.lang, admin: true }));
  } catch (e) { next(e); }
});

app.post('/admin/events', auth.requireStaff(['super_admin']), upload.single('poster'), async (req, res, next) => {
  try {
    const st = db();
    if (!st) return needConfig(req, res);
    const [positionsMaster, eventTypes] = await Promise.all([st.listPositions(), st.listEventTypes()]);
    const f = parseEventForm(req, positionsMaster);
    const errors = validateEventForm(f, req);
    if (errors.length) return res.status(400).send(V.eoEventForm({ staff: staffCtx(req), event: f.echo, positionsMaster, eventTypes, selected: eoSelMap(f.positions), errors, lang: req.lang, admin: true }));
    const ev = await st.createEvent(Object.assign({}, f.data, { created_by: req.staff.id }));
    if (ev && ev.id) {
      await st.setEventPositions(ev.id, f.positions);
      const poster = await saveMockup(st, ev.id, req.file); if (poster) await st.updateEvent(ev.id, { mockup_path: poster });
    }
    res.redirect('/admin/manage');
  } catch (e) { next(e); }
});

// Super admin edits ANY event (no ownership restriction) with the shared form.
app.get('/admin/events/:id/edit', auth.requireStaff(['super_admin']), async (req, res, next) => {
  try {
    const st = db();
    if (!st) return needConfig(req, res);
    const event = (await st.listEvents()).find((e) => e.id === req.params.id);
    if (!event) return res.redirect('/admin/manage');
    const [positionsMaster, evPos, eventTypes] = await Promise.all([st.listPositions(), st.listEventPositions(event.id), st.listEventTypes()]);
    await attachMockups(st, event);
    res.send(V.eoEventForm({ staff: staffCtx(req), event, positionsMaster, eventTypes, selected: eoSelMap(evPos), lang: req.lang, admin: true }));
  } catch (e) { next(e); }
});

// Read-only event detail with per-position registration statistics (Super Admin).
app.get('/admin/events/:id', auth.requireStaff(['super_admin']), async (req, res, next) => {
  try {
    const st = db();
    if (!st) return needConfig(req, res);
    const event = (await st.listEvents()).find((e) => e.id === req.params.id);
    if (!event) return res.redirect('/admin/manage');
    const [evPos, apps, choices] = await Promise.all([st.listEventPositions(event.id), st.listApplications(), st.listApplicationChoices()]);
    await attachMockups(st, event);
    const view = eoEventView(event, evPos, apps, choices);
    res.send(V.adminEventDetail({ staff: staffCtx(req), event, view, lang: req.lang }));
  } catch (e) { next(e); }
});

app.post('/admin/events/:id/edit', auth.requireStaff(['super_admin']), upload.single('poster'), async (req, res, next) => {
  try {
    const st = db();
    if (!st) return needConfig(req, res);
    const event = (await st.listEvents()).find((e) => e.id === req.params.id);
    if (!event) return res.redirect('/admin/manage');
    const [positionsMaster, evPos, apps, choices, eventTypes] = await Promise.all([st.listPositions(), st.listEventPositions(event.id), st.listApplications(), st.listApplicationChoices(), st.listEventTypes()]);
    const f = parseEventForm(req, positionsMaster);
    const errors = validateEventForm(f, req);
    // Same guards as EO: a position with applicants can't be removed; quota can't drop below accepted.
    const view = eoEventView(event, evPos, apps, choices);
    const newByPos = eoSelMap(f.positions);
    view.positions.forEach((p) => {
      if (p.applicants > 0 && !p.closed_at && !(p.position_id in newByPos)) errors.push(req.t('eo.ev.err.cantRemovePos'));
      if (p.position_id in newByPos && newByPos[p.position_id].quota < p.filled) errors.push(req.t('eo.ev.err.quotaBelowAccepted'));
    });
    if (errors.length) return res.status(400).send(V.eoEventForm({ staff: staffCtx(req), event: Object.assign({}, event, f.echo), positionsMaster, eventTypes, selected: newByPos, errors, lang: req.lang, admin: true }));
    const patch = Object.assign({}, f.data);
    const poster = await saveMockup(st, event.id, req.file); if (poster) patch.mockup_path = poster;
    await st.updateEvent(event.id, patch);
    await st.setEventPositions(event.id, f.positions);
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
    res.send(V.performancePage(board, subs.length, req.lang));
  } catch (e) { next(e); }
});

// In-memory dev mode serves placeholder thumbnails (Supabase mode uses signed URLs).
const PX = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
app.get('/__mockimg/*', (req, res) => { res.type('png').send(PX); });

// -------------------------------------------------------------- fallbacks ----

app.use((err, req, res, next) => {
  const t = req.t || ((k, v) => i18n.t('en', k, v));
  let msg = err.message || t('err500.generic');
  if (err.code === 'LIMIT_FILE_SIZE') msg = t('err500.fileSize');
  if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE') msg = t('err500.fileCount', { n: MAX_IMAGES });
  console.error('[error]', err.code || '', err.message);
  res.status(500).send(V.page500(msg, req && req.lang));
});

app.listen(PORT, HOST, () => {
  console.log('20FIT KOL server on http://' + HOST + ':' + PORT + ' (store: ' + MODE + ')');
  startReminderScheduler();
});
