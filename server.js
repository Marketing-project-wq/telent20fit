'use strict';

/**
 * 20FIT Talent — KOL app.
 *
 *   Public:
 *     GET  /                 -> landing (talent categories)
 *     GET  /prototype        -> archived design prototype
 *     GET  /health           -> health check
 *
 *   KOL talent (self-service accounts, session cookie):
 *     GET/POST /kol/register -> create account
 *     GET/POST /kol/login    -> sign in
 *     POST     /kol/logout   -> sign out
 *     GET      /kol          -> submission form (requires login)
 *     POST     /kol/submit   -> create a submission (campaign, 1-5 images, 1+ links)
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
  const p = type.replace(/_/g, '-');
  return [auth.requireTalent(type), async (req, res, next) => {
    try {
      const st = db();
      if (!st) return needConfig(req, res);
      const acc = await st.getAccountById(req.talent.id);
      if (!acc) { auth.clearSession(res, type); return res.redirect('/login'); }
      if (!acc.profile_completed_at) return res.redirect('/' + p + '/data-diri?lang=' + req.lang);
      req.account = acc;
      next();
    } catch (e) { next(e); }
  }];
}

// GET /{type}/data-diri — profile form (+ available-events teaser). Skips to the
// dashboard if already complete, unless ?edit=1 (re-open to update).
function dataDiriGet(type) {
  const p = type.replace(/_/g, '-');
  return [auth.requireTalent(type), async (req, res, next) => {
    try {
      const st = db();
      if (!st) return needConfig(req, res);
      const acc = await st.getAccountById(req.talent.id);
      if (!acc) { auth.clearSession(res, type); return res.redirect('/login'); }
      if (acc.profile_completed_at && req.query.edit !== '1') return res.redirect('/' + p + '?lang=' + req.lang);
      const events = teaserEvents(await st.listEvents());
      res.send(V.talentDataDiri(type, { account: acc, events, values: acc, lang: req.lang }));
    } catch (e) { next(e); }
  }];
}

// POST /{type}/data-diri — validate + save profile, activating the account.
function dataDiriPost(type) {
  const p = type.replace(/_/g, '-');
  return [auth.requireTalent(type), async (req, res, next) => {
    try {
      const st = db();
      if (!st) return needConfig(req, res);
      const acc = await st.getAccountById(req.talent.id);
      if (!acc) { auth.clearSession(res, type); return res.redirect('/login'); }
      const values = {
        city: String(req.body.city || '').trim().slice(0, 80),
        ktp: String(req.body.ktp || '').replace(/\D/g, '').slice(0, 16),
        birthdate: String(req.body.birthdate || '').trim(),
        gender: String(req.body.gender || '').trim(),
        instagram: String(req.body.instagram || '').trim().replace(/^@+/, '').slice(0, 60),
        instagram_followers: String(req.body.instagram_followers || '').trim(),
        experience: String(req.body.experience || '').trim().slice(0, 1000),
      };
      const errors = [];
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
      if (!/^\d{16}$/.test(values.ktp)) errors.push(req.t('dd.err.ktp'));
      if (type === 'kol' && !values.instagram) errors.push(req.t('dd.err.instagram'));
      let followers = null;
      if (values.instagram_followers) {
        const n = parseInt(values.instagram_followers.replace(/[.,\s]/g, ''), 10);
        if (Number.isNaN(n) || n < 0 || n > 1e9) errors.push(req.t('dd.err.followers'));
        else followers = n;
      }
      if (errors.length) {
        const events = teaserEvents(await st.listEvents());
        return res.status(400).send(V.talentDataDiri(type, { account: acc, events, values, errors, lang: req.lang }));
      }
      await st.updateAccountProfile(acc.id, {
        city: values.city,
        ktp: values.ktp,
        birthdate: values.birthdate,
        gender: values.gender,
        instagram: values.instagram || null,
        instagram_followers: followers,
        experience: values.experience || null,
        profile_completed_at: acc.profile_completed_at || new Date().toISOString(),
      });
      res.redirect('/' + p + '?lang=' + req.lang);
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

app.get('/', (req, res) => res.send(V.landingPage(req.lang)));

// Public sign-up / sign-in: a single account form, no talent-type picker.
// New accounts default to KOL; login resolves the account by email across all
// talent types and lands each on the dashboard for their type. Admin & EO still
// sign in via /admin/login and /eo/login (linked from the login page + footer).
app.get('/register', (req, res) => {
  const tk = auth.currentTalent(req);
  if (tk && (tk.type === 'kol' || tk.type === 'main_power')) return res.redirect('/' + tk.type.replace(/_/g, '-'));
  res.send(V.talentRegister('kol', { unified: true, lang: req.lang }));
});
app.post('/register', talentRegisterPost('kol', { unified: true }));
app.get('/login', (req, res) => {
  const tk = auth.currentTalent(req);
  if (tk && (tk.type === 'kol' || tk.type === 'main_power')) return res.redirect('/' + tk.type.replace(/_/g, '-'));
  res.send(V.talentLogin('kol', { unified: true, lang: req.lang }));
});
app.post('/login', async (req, res, next) => {
  try {
    const st = db();
    if (!st) return needConfig(req, res);
    const login = String(req.body.login || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    const account = await st.findAccountByLogin(login);
    if (!account || !auth.verifyPassword(password, account.password_hash)) {
      return res.status(401).send(V.talentLogin('kol', { unified: true, errors: [req.t('err.badTalentCreds')], values: { login }, lang: req.lang }));
    }
    auth.setSession(res, account);
    res.redirect('/' + (account.talent_type || 'kol').replace(/_/g, '-'));
  } catch (e) { next(e); }
});

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

app.get('/kol/register', (req, res) => {
  const t = auth.currentTalent(req);
  if (t && t.type === 'kol') return res.redirect('/kol');
  res.send(V.talentRegister('kol', { lang: req.lang }));
});

// Registration collects Full Name, Email, WhatsApp, Password + confirmation.
// The account is created inactive; the talent completes Data Diri next. Shared
// by both talent types (KOL + Man Power).
function talentRegisterPost(type, opts = {}) {
  const unified = !!opts.unified;
  const p = type.replace(/_/g, '-');
  return async (req, res, next) => {
    try {
      const st = db();
      if (!st) return needConfig(req, res);
      const name = String(req.body.name || '').trim();
      const login = String(req.body.login || '').trim().toLowerCase();
      const phone = String(req.body.phone || '').trim();
      const password = String(req.body.password || '');
      const password2 = String(req.body.password2 || '');
      const values = { name, login, phone };

      const errors = [];
      if (!name) errors.push(req.t('err.nameRequired'));
      if (!login) errors.push(req.t('err.emailRequired'));
      else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(login)) errors.push(req.t('err.emailInvalid'));
      if (!phone) errors.push(req.t('dd.err.phone'));
      else if (!/^[0-9+()\-\s]{8,20}$/.test(phone)) errors.push(req.t('dd.err.phoneBad'));
      if (password.length < 6) errors.push(req.t('err.passwordMin6'));
      else if (password !== password2) errors.push(req.t('err.passwordMismatch'));
      if (errors.length) return res.status(400).send(V.talentRegister(type, { unified, errors, values, lang: req.lang }));

      // Email must be unique across all talent types (login resolves by email).
      if (await st.findAccountByLogin(login)) {
        return res.status(400).send(V.talentRegister(type, { unified, errors: [req.t('err.dupAccount')], values, lang: req.lang }));
      }

      let account;
      try {
        account = await st.createAccount({ talent_type: type, name, login, phone, password_hash: auth.hashPassword(password) });
      } catch (e) {
        if (e.code === 'DUP') return res.status(400).send(V.talentRegister(type, { unified, errors: [req.t('err.dupAccount')], values, lang: req.lang }));
        throw e;
      }
      auth.setSession(res, account);
      res.redirect('/' + p + '/data-diri?lang=' + req.lang);
    } catch (e) { next(e); }
  };
}

app.post('/kol/register', talentRegisterPost('kol'));

app.get('/kol/login', (req, res) => res.redirect('/login?lang=' + req.lang));

app.post('/kol/login', async (req, res, next) => {
  try {
    const st = db();
    if (!st) return needConfig(req, res);
    const login = String(req.body.login || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    const account = await st.findAccount('kol', login);
    if (!account || !auth.verifyPassword(password, account.password_hash)) {
      return res.status(401).send(V.talentLogin('kol', { errors: [req.t('err.badTalentCreds')], values: { login }, lang: req.lang }));
    }
    auth.setSession(res, account);
    res.redirect('/kol');
  } catch (e) { next(e); }
});

app.post('/kol/logout', (req, res) => { auth.clearSession(res, auth.TALENT_TYPES); res.redirect('/login'); });

app.get('/kol/data-diri', dataDiriGet('kol'));
app.post('/kol/data-diri', dataDiriPost('kol'));

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
app.get('/kol', requireTalentReady('kol'), async (req, res, next) => {
  try {
    const st = db();
    if (!st) return needConfig(req, res);
    // Lazily issue any certificates the talent has earned (attended + finished).
    const [myApps, events] = await Promise.all([st.listApplicationsForTalent(req.talent.id), st.listEvents()]);
    const eventById = new Map(events.map((e) => [e.id, e]));
    await issueCertsForApps(st, myApps, eventById, new Map([[req.talent.id, req.account.name]]));
    const certs = await st.listCertificatesForTalent(req.talent.id);
    res.send(V.kolProfilePage({ account: req.account, certs, lang: req.lang }));
  } catch (e) { next(e); }
});

// Talent downloads their own certificate PDF.
app.get('/kol/sertifikat/:id', requireTalentReady('kol'), async (req, res, next) => {
  try {
    const st = db();
    if (!st) return needConfig(req, res);
    const c = await st.getCertificate(req.params.id);
    if (!c || c.talent_id !== req.talent.id || c.revoked_at) return res.redirect('/kol?lang=' + req.lang);
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
  const withPath = list.map((e, i) => ({ i, p: e && e.mockup_path })).filter((x) => x.p);
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
app.get('/kol/event', requireTalentReady('kol'), async (req, res, next) => {
  try {
    const st = db();
    if (!st) return needConfig(req, res);
    const [allEvents, myApps] = await Promise.all([st.listEvents(), st.listApplicationsForTalent(req.talent.id)]);
    const appByEvent = new Map(myApps.map((a) => [a.event_id, a]));
    const rank = { ongoing: 0, upcoming: 1 };
    const events = allEvents.filter((e) => e.is_active)
      .map((e) => ({
        id: e.id, name: e.name, location: e.location, starts_at: e.starts_at, ends_at: e.ends_at, mockup_path: e.mockup_path, status: eventStatusOf(e), cats: eventCats(e),
        applied: appByEvent.has(e.id) ? {
          category: appByEvent.get(e.id).talent_type, status: appByEvent.get(e.id).status,
          station: appByEvent.get(e.id).station, station_loc: appByEvent.get(e.id).station_loc,
        } : null,
      }))
      .filter((e) => e.status !== 'ended')
      .sort((a, b) => (rank[a.status] - rank[b.status]) || String(a.starts_at || '').localeCompare(String(b.starts_at || '')));
    await attachMockups(st, events);
    const eoEvents = await openPositionEvents(st, req.talent.id);
    res.send(V.kolEventsPage({ account: req.account, events, eoEvents, lang: req.lang }));
  } catch (e) { next(e); }
});

// Event detail: pick a category to register for (or see your registration).
app.get('/kol/event/:id', requireTalentReady('kol'), async (req, res, next) => {
  try {
    const st = db();
    if (!st) return needConfig(req, res);
    const [allEvents, myApps] = await Promise.all([st.listEvents(), st.listApplicationsForTalent(req.talent.id)]);
    const ev = allEvents.find((e) => e.id === req.params.id);
    if (!ev || !ev.is_active) return res.redirect('/kol/event?lang=' + req.lang);
    const myApplication = myApps.find((a) => a.event_id === ev.id) || null;
    const event = await attachMockups(st, { ...ev, status: eventStatusOf(ev) });
    res.send(V.kolEventDetail({ account: req.account, event, cats: eventCats(ev), myApplication, lang: req.lang }));
  } catch (e) { next(e); }
});

// Dynamic registration form for one category.
app.get('/kol/event/:id/apply', requireTalentReady('kol'), async (req, res, next) => {
  try {
    const st = db();
    if (!st) return needConfig(req, res);
    const [allEvents, myApps] = await Promise.all([st.listEvents(), st.listApplicationsForTalent(req.talent.id)]);
    const ev = allEvents.find((e) => e.id === req.params.id);
    const cat = String(req.query.cat || '');
    const opensCat = ev && ev.is_active && V.CAT_LABEL[cat] && (ev.needs || []).some((n) => n.talent_type === cat);
    if (!opensCat) return res.redirect('/kol/event/' + req.params.id + '?lang=' + req.lang);
    if (myApps.some((a) => a.event_id === ev.id)) return res.redirect('/kol/event/' + ev.id + '?lang=' + req.lang);
    res.send(V.kolApplyForm({ account: req.account, event: ev, cat, lang: req.lang }));
  } catch (e) { next(e); }
});

app.post('/kol/event/:id/apply', requireTalentReady('kol'), async (req, res, next) => {
  try {
    const st = db();
    if (!st) return needConfig(req, res);
    const allEvents = await st.listEvents();
    const ev = allEvents.find((e) => e.id === req.params.id);
    const cat = String(req.body.cat || '');
    const opensCat = ev && ev.is_active && V.CAT_LABEL[cat] && (ev.needs || []).some((n) => n.talent_type === cat);
    if (!opensCat) return res.redirect('/kol/event?lang=' + req.lang);

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
      if (e.code === 'DUP') return res.redirect('/kol/event/' + ev.id + '?lang=' + req.lang);
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
      if (!t) return res.redirect('/login');
      const st = db();
      if (!st) return needConfig(req, res);
      const acc = await st.getAccountById(t.id);
      if (!acc) { auth.clearSession(res, auth.TALENT_TYPES); return res.redirect('/login'); }
      if (!acc.profile_completed_at) return res.redirect('/' + t.type.replace(/_/g, '-') + '/data-diri?lang=' + req.lang);
      req.talent = t; req.account = acc;
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
  return true;
}

// Build the apply context for one event + talent (positions, open slots, my application).
async function positionApplyCtx(st, ev, talentId) {
  const [positions, apps, choices] = await Promise.all([st.listEventPositions(ev.id), st.listApplications(), st.listApplicationChoices()]);
  const view = eoEventView(ev, positions, apps, choices);
  const openPositions = view.positions.filter((p) => !p.closed_at && !p.full);
  const myApp = await st.getApplicationForEvent(talentId, ev.id);
  const myChoices = myApp ? await st.listChoicesForApplication(myApp.id) : [];
  const posById = new Map(view.positions.map((p) => [p.position_id, p]));
  return { view, positions: view.positions, openPositions, posById, myApp, myChoices, regOpen: eventRegOpen(ev) };
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

// Events open to talents: published, position-based, within reg window, with a free slot.
app.get('/events', requireAnyTalentReady(), async (req, res, next) => {
  try {
    const st = db();
    if (!st) return needConfig(req, res);
    const open = await openPositionEvents(st, req.talent.id);
    res.send(V.talentOpenEvents({ account: req.account, events: open, lang: req.lang }));
  } catch (e) { next(e); }
});

app.get('/event/:id', requireAnyTalentReady(), async (req, res, next) => {
  try {
    const st = db();
    if (!st) return needConfig(req, res);
    const ev = (await st.listEvents()).find((e) => e.id === req.params.id);
    if (!ev) return res.redirect('/events');
    const ctx = await positionApplyCtx(st, ev, req.talent.id);
    if (!ctx.positions.length) return res.redirect('/events'); // not a position-based event
    await attachMockups(st, ev);
    res.send(V.talentEventApply({ account: req.account, event: ev, ctx, lang: req.lang }));
  } catch (e) { next(e); }
});

// Parse + validate the 1..3 prioritised choices against BR-2/3/5/7.
function parseApplyChoices(req, ctx) {
  const openIds = new Set(ctx.openPositions.map((p) => p.position_id));
  const inEvent = new Set(ctx.positions.map((p) => p.position_id));
  const slots = [String(req.body.pos1 || ''), String(req.body.pos2 || ''), String(req.body.pos3 || '')];
  const errors = [];
  if (!slots[0]) errors.push(req.t('ta.err.p1required')); // BR-2 min 1 / BR-5 P1 first
  if (!slots[1] && slots[2]) errors.push(req.t('ta.err.gap')); // BR-5 no gap
  const chosen = [];
  slots.forEach((pid, i) => {
    if (!pid) return;
    if (i > 0 && !slots[i - 1]) return; // gap already flagged
    if (chosen.some((c) => c.position_id === pid)) { errors.push(req.t('ta.err.dup')); return; } // BR-3
    if (!inEvent.has(pid)) { errors.push(req.t('ta.err.notOpen')); return; }
    // BR-7: position must be open (unless it's one the talent already holds)
    const heldPriority = (ctx.myChoices.find((c) => c.position_id === pid) || {}).priority;
    if (!openIds.has(pid) && heldPriority === undefined) { errors.push(req.t('ta.err.notOpen')); return; }
    chosen.push({ position_id: pid, priority: chosen.length + 1 });
  });
  return { chosen, errors };
}

app.post('/event/:id/apply', requireAnyTalentReady(), async (req, res, next) => {
  try {
    const st = db();
    if (!st) return needConfig(req, res);
    const ev = (await st.listEvents()).find((e) => e.id === req.params.id);
    if (!ev) return res.redirect('/events');
    const ctx = await positionApplyCtx(st, ev, req.talent.id);
    if (!ctx.positions.length) return res.redirect('/events');
    // BR-8: can only apply/edit while pending and registration is open.
    const editable = !ctx.myApp || (['applied', 'pending', 'under_review'].includes(ctx.myApp.status));
    if (!ctx.regOpen || !editable) {
      const ctx2 = Object.assign({}, ctx, { errors: [req.t('ta.err.closed')] });
      return res.status(400).send(V.talentEventApply({ account: req.account, event: ev, ctx: ctx2, lang: req.lang }));
    }
    const { chosen, errors } = parseApplyChoices(req, ctx);
    if (errors.length) {
      return res.status(400).send(V.talentEventApply({ account: req.account, event: ev, ctx: Object.assign({}, ctx, { errors }), lang: req.lang }));
    }
    if (ctx.myApp) {
      await st.replaceApplicationChoices(ctx.myApp.id, chosen);
    } else {
      const app = await st.createApplication({ event_id: ev.id, talent_id: req.talent.id, talent_type: req.talent.type, role: null, answers: null });
      await st.updateApplication(app.id, { status: 'applied' });
      await st.addApplicationChoices(app.id, chosen);
    }
    res.redirect('/event/' + ev.id + '?lang=' + req.lang + '&saved=1');
  } catch (e) { next(e); }
});

app.post('/event/:id/cancel', requireAnyTalentReady(), async (req, res, next) => {
  try {
    const st = db();
    if (!st) return needConfig(req, res);
    const ev = (await st.listEvents()).find((e) => e.id === req.params.id);
    if (!ev) return res.redirect('/events');
    const myApp = await st.getApplicationForEvent(req.talent.id, ev.id);
    // BR-8: cancel only while pending + registration open.
    if (myApp && ['applied', 'pending', 'under_review'].includes(myApp.status) && eventRegOpen(ev)) {
      await st.deleteApplication(myApp.id);
    }
    res.redirect('/event/' + ev.id + '?lang=' + req.lang);
  } catch (e) { next(e); }
});

app.get('/kol/kirim-bukti', requireTalentReady('kol'), async (req, res, next) => {
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

app.post('/kol/proofs', requireTalentReady('kol'), upload.single('screenshot'), async (req, res, next) => {
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
    res.redirect('/kol/kirim-bukti');
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

app.get('/main-power/register', (req, res) => {
  const t = auth.currentTalent(req);
  if (t && t.type === 'main_power') return res.redirect('/main-power');
  res.send(V.talentRegister('main_power', { lang: req.lang }));
});

app.post('/main-power/register', talentRegisterPost('main_power'));

app.get('/main-power/login', (req, res) => res.redirect('/login?lang=' + req.lang));

app.post('/main-power/login', async (req, res, next) => {
  try {
    const st = db();
    if (!st) return needConfig(req, res);
    const login = String(req.body.login || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    const account = await st.findAccount('main_power', login);
    if (!account || !auth.verifyPassword(password, account.password_hash)) {
      return res.status(401).send(V.talentLogin('main_power', { errors: [req.t('err.badTalentCreds')], values: { login }, lang: req.lang }));
    }
    auth.setSession(res, account);
    res.redirect('/main-power');
  } catch (e) { next(e); }
});

app.post('/main-power/logout', (req, res) => { auth.clearSession(res, auth.TALENT_TYPES); res.redirect('/login'); });

app.get('/main-power/data-diri', dataDiriGet('main_power'));
app.post('/main-power/data-diri', dataDiriPost('main_power'));

app.get('/main-power', requireTalentReady('main_power'), async (req, res, next) => {
  try {
    const st = db();
    if (!st) return needConfig(req, res);
    const [events, allApps, myApps] = await Promise.all([
      st.listEvents(), st.listApplications(), st.listApplicationsForTalent(req.talent.id),
    ]);
    const eventName = new Map(events.map((e) => [e.id, e.name]));
    const appliedEventIds = new Set(myApps.map((a) => a.event_id));
    const openEvents = mpOpenEvents(events, allApps).filter((e) => !appliedEventIds.has(e.id));
    const myAppsEnriched = myApps.map((a) => ({ ...a, event_name: eventName.get(a.event_id) || null }));
    const eoEvents = await openPositionEvents(st, req.talent.id);
    res.send(V.mainPowerDashboard({ talent: req.talent, openEvents, eoEvents, myApps: myAppsEnriched, lang: req.lang, applied: req.query.applied === '1' }));
  } catch (e) { next(e); }
});

app.get('/main-power/apply/:eventId', requireTalentReady('main_power'), async (req, res, next) => {
  try {
    const st = db();
    if (!st) return needConfig(req, res);
    const [events, myApps] = await Promise.all([st.listEvents(), st.listApplicationsForTalent(req.talent.id)]);
    const ev = events.find((e) => e.id === req.params.eventId);
    const isOpen = ev && ev.is_active && (ev.needs || []).some((n) => n.talent_type === 'main_power');
    if (!isOpen || myApps.some((a) => a.event_id === req.params.eventId)) return res.redirect('/main-power?lang=' + req.lang);
    res.send(V.mainPowerApply({ talent: req.talent, event: ev, customSow: ev.mp_sow, lang: req.lang }));
  } catch (e) { next(e); }
});

app.post('/main-power/apply/:eventId', requireTalentReady('main_power'), async (req, res, next) => {
  try {
    const st = db();
    if (!st) return needConfig(req, res);
    const events = await st.listEvents();
    const ev = events.find((e) => e.id === req.params.eventId);
    const isOpen = ev && ev.is_active && (ev.needs || []).some((n) => n.talent_type === 'main_power');
    if (!isOpen) return res.redirect('/main-power?lang=' + req.lang);

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
    try {
      await st.createApplication({ event_id: ev.id, talent_id: req.talent.id, talent_type: 'main_power', role, answers });
    } catch (e) {
      if (e.code === 'DUP') return res.redirect('/main-power?lang=' + req.lang); // already applied
      throw e;
    }
    res.send(V.mainPowerApplyDone({ event: ev, lang: req.lang }));
  } catch (e) { next(e); }
});

// -------------------------------------------------------- password reset ----
// Self-service "forgot password": request a reset link (per talent type), then
// set a new password via a one-time, 1-hour token delivered by email. The
// request response is always the same (no account enumeration).

function forgotGet(type) {
  return (req, res) => res.send(V.forgotPassword(type, { lang: req.lang }));
}
function forgotPost(type) {
  return async (req, res, next) => {
    try {
      const st = db();
      if (!st) return needConfig(req, res);
      const login = String(req.body.login || '').trim().toLowerCase();
      if (login) {
        const account = await st.findAccount(type, login);
        if (account) {
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
      res.send(V.forgotPasswordSent({ type, lang: req.lang }));
    } catch (e) { next(e); }
  };
}
app.get('/kol/forgot-password', forgotGet('kol'));
app.post('/kol/forgot-password', forgotPost('kol'));
app.get('/main-power/forgot-password', forgotGet('main_power'));
app.post('/main-power/forgot-password', forgotPost('main_power'));

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

app.get('/eo/login', (req, res) => {
  const t = auth.anySession(req, ['super_admin', 'eo']);
  if (t) return res.redirect(staffHome(t.type));
  res.send(V.staffLogin({ lang: req.lang, variant: 'eo' }));
});

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
app.post('/eo/login', staffLoginHandler('eo'));

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
    const city = c('city', 100);
    const description = c('description', 1000);
    const password = String(req.body.password || '');
    const password2 = String(req.body.password2 || '');
    const values = { org_type, org_name, pic_name, login, phone, city, description };
    const errors = [];
    if (!EO_ORG_TYPES.includes(org_type)) errors.push(req.t('eo.reg.err.type'));
    if (!org_name) errors.push(req.t('eo.reg.err.orgName'));
    if (!pic_name) errors.push(req.t('eo.reg.err.pic'));
    if (!login) errors.push(req.t('err.emailRequired'));
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(login)) errors.push(req.t('err.emailInvalid'));
    if (!phone) errors.push(req.t('eo.reg.err.phone'));
    if (!city) errors.push(req.t('eo.reg.err.city'));
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
    await st.upsertEoProfile(staff.id, { org_type, org_name, pic_name, email: login, phone, city, description, completed_at: new Date().toISOString() });
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
app.post('/eo/logout', (req, res) => { auth.clearSession(res, 'eo'); res.redirect('/eo/login'); });

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
    if (!patch.city) errors.push(req.t('eo.reg.err.city'));
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
function eoSelMap(positions) { const m = {}; (positions || []).forEach((p) => { m[p.position_id] = p.quota; }); return m; }

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
  const chosen = [].concat(req.body.pos || []);
  const seen = new Set(); const positions = [];
  chosen.forEach((id) => {
    id = String(id);
    if (!validIds.has(id) || seen.has(id)) return;
    const q = Math.max(0, parseInt(req.body['quota_' + id], 10) || 0);
    if (q > 0) { seen.add(id); positions.push({ position_id: id, quota: q }); }
  });
  return { data, positions, echo: Object.assign({}, data, { positions }) };
}
function validateEventForm(f, req) {
  const e = [];
  if (!f.data.name) e.push(req.t('eo.ev.err.name'));
  if (!f.data.category) e.push(req.t('eo.ev.err.category'));
  if (!f.data.location) e.push(req.t('eo.ev.err.location'));
  if (!f.data.starts_at) e.push(req.t('eo.ev.err.date'));
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
      if (p.position_id in newByPos && newByPos[p.position_id] < p.filled) errors.push(req.t('eo.ev.err.quotaBelowAccepted'));
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
    const [positions, apps, choices, talents] = await Promise.all([
      st.listEventPositions(ev.id), st.listApplications(), st.listApplicationChoices(), st.listTalents(),
    ]);
    const view = eoEventView(ev, positions, apps, choices);
    // Tahap 6: applicants for this event, each with their prioritised choices + contact.
    const talentById = new Map(talents.map((tt) => [tt.id, tt]));
    const choicesByApp = new Map();
    choices.forEach((c) => { const a = choicesByApp.get(c.application_id) || []; a.push(c); choicesByApp.set(c.application_id, a); });
    const applicants = apps
      .filter((a) => a.event_id === ev.id && (choicesByApp.get(a.id) || []).length)
      .map((a) => {
        const tt = talentById.get(a.talent_id) || {};
        const ch = (choicesByApp.get(a.id) || []).slice().sort((x, y) => x.priority - y.priority)
          .map((c) => ({ priority: c.priority, position_id: c.position_id, accepted: !!c.accepted }));
        return {
          id: a.id, talentId: a.talent_id, name: tt.name || '—', type: a.talent_type || tt.talent_type || null,
          phone: tt.phone || null, city: tt.city || null, instagram: tt.instagram || null, login: tt.login || null,
          status: a.status || 'applied', createdAt: a.created_at, choices: ch,
        };
      })
      .sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
    await attachMockups(st, ev);
    res.send(V.eoEventDetail({ staff: eoCtx(req), event: ev, view, applicants, lang: req.lang }));
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

// Aplikasi MP (super admin only): review Man Power event applications.
app.get('/admin/applications', auth.requireStaff(['super_admin']), async (req, res, next) => {
  try {
    const st = db();
    if (!st) return needConfig(req, res);
    const [apps, events, talents, certs] = await Promise.all([st.listApplications(), st.listEvents(), st.listTalents(), st.listCertificates()]);
    const eventName = new Map(events.map((e) => [e.id, e.name]));
    const eventById = new Map(events.map((e) => [e.id, e]));
    const talentById = new Map(talents.map((tt) => [tt.id, tt]));
    const certByKey = new Map(certs.map((c) => [c.talent_id + '|' + c.event_id, c]));
    const applications = apps.map((a) => {
      const tt = talentById.get(a.talent_id) || {};
      const ev = eventById.get(a.event_id) || {};
      return {
        ...a, event_name: eventName.get(a.event_id) || null, talent_name: tt.name || null, talent_login: tt.login || null, profile: tt,
        event_completed: !!ev.completed_at, certificate: certByKey.get(a.talent_id + '|' + a.event_id) || null,
      };
    });
    // Attendance links: one per event that has approved Man Power, for on-site PICs.
    const mpCount = new Map();
    for (const a of applications) {
      if (a.status === 'approved' && a.talent_type === 'main_power') mpCount.set(a.event_id, (mpCount.get(a.event_id) || 0) + 1);
    }
    const attendanceLinks = [...mpCount.entries()].map(([eid, n]) => ({
      name: eventName.get(eid) || '—', count: n,
      path: '/absensi/' + encodeURIComponent(eid) + '?k=' + auth.attendanceToken(eid),
    })).sort((a, b) => a.name.localeCompare(b.name));
    res.send(V.adminApplications({ staff: staffCtx(req), applications, attendanceLinks, lang: req.lang, flash: String(req.query.mail || '') }));
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
    }
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
  const target = addDaysYMD(jakartaDateStr(), 1); // events starting tomorrow (WIB)
  const events = await st.listEvents();
  const dueEvents = new Map(events
    .filter((e) => e.is_active && !e.completed_at && String(e.starts_at || '').slice(0, 10) === target)
    .map((e) => [e.id, e]));
  if (!dueEvents.size) return { due: 0, sent: 0 };
  const apps = await st.listApplications();
  const due = apps.filter((a) => a.status === 'approved' && !a.reminder_sent_at && dueEvents.has(a.event_id));
  let sent = 0;
  for (const a of due) {
    try {
      const account = await st.getAccountById(a.talent_id);
      const to = account && account.login;
      if (!to || !/@/.test(to)) continue;
      const ev = dueEvents.get(a.event_id);
      const r = await mailer.sendReminderEmail({
        to, name: account.name, lang: 'en',
        eventName: ev.name || 'Event 20FIT', eventDate: eventDateStrEn(ev),
        location: ev.location || null, category: V.CAT_LABEL[a.talent_type] || a.talent_type,
        station: a.station, stationLoc: a.station_loc,
      });
      // Only mark as reminded once the email is genuinely delivered — so if the
      // mail service isn't configured yet, we retry on the next run instead of
      // silently burning the reminder.
      if (r && r.delivered) { await st.updateApplication(a.id, { reminder_sent_at: new Date().toISOString() }); sent++; }
    } catch (e) { console.error('[mail] reminder failed for app ' + a.id + ':', e && e.message); }
  }
  if (sent) console.log('[reminders] sent ' + sent + ' H-1 reminder(s) for events on ' + target);
  return { due: due.length, sent };
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
    runDueReminders(db()).catch((e) => console.error('[reminders] tick failed:', e && e.message));
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
  const [apps, talents] = await Promise.all([st.listApplications(), st.listTalents()]);
  const nameById = new Map(talents.map((tt) => [tt.id, tt.name]));
  return apps
    .filter((a) => a.event_id === eventId && a.status === 'approved' && a.talent_type === 'main_power')
    .map((a) => { const dates = attDates(a); return { id: a.id, name: nameById.get(a.talent_id) || '—', station: a.station, station_loc: a.station_loc, count: dates.length, checked: day ? dates.includes(day) : false }; })
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
    if (ev && eventDays(ev).includes(day) && app0 && app0.event_id === eventId && app0.status === 'approved' && app0.talent_type === 'main_power') {
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

// Staff: download a certificate PDF.
app.get('/admin/certificates/:id', auth.requireStaff(['super_admin', 'eo']), async (req, res, next) => {
  try {
    const st = db();
    if (!st) return needConfig(req, res);
    const c = await st.getCertificate(req.params.id);
    if (!c) return res.redirect('/admin/applications');
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
if (MODE === 'memory') {
  const PX = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
  app.get('/__mockimg/*', (req, res) => { res.type('png').send(PX); });
}

// -------------------------------------------------------------- fallbacks ----

app.use((err, req, res, next) => {
  let msg = err.message || 'Terjadi kesalahan.';
  if (err.code === 'LIMIT_FILE_SIZE') msg = 'Ukuran gambar terlalu besar (maks 6 MB per file).';
  if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE') msg = 'Maksimal ' + MAX_IMAGES + ' gambar.';
  console.error('[error]', err.code || '', err.message);
  res.status(500).send(V.page500(msg));
});

app.listen(PORT, HOST, () => {
  console.log('20FIT KOL server on http://' + HOST + ':' + PORT + ' (store: ' + MODE + ')');
  startReminderScheduler();
});
