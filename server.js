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
app.get('/register', (req, res) => res.send(V.talentPicker('register', req.lang)));
app.get('/login', (req, res) => res.send(V.talentPicker('login', req.lang)));

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

app.post('/kol/register', async (req, res, next) => {
  try {
    const st = db();
    if (!st) return needConfig(req, res);
    const name = String(req.body.name || '').trim();
    const login = String(req.body.login || '').trim().toLowerCase();
    const password = String(req.body.password || '');

    const errors = [];
    if (!name) errors.push(req.t('err.nameRequired'));
    if (!login) errors.push(req.t('err.loginRequired'));
    if (password.length < 6) errors.push(req.t('err.passwordMin6'));
    if (errors.length) return res.status(400).send(V.talentRegister('kol', { errors, values: { name, login }, lang: req.lang }));

    let account;
    try {
      account = await st.createAccount({ talent_type: 'kol', name, login, password_hash: auth.hashPassword(password) });
    } catch (e) {
      if (e.code === 'DUP') {
        return res.status(400).send(V.talentRegister('kol', {
          errors: [req.t('err.dupAccount')], values: { name, login }, lang: req.lang,
        }));
      }
      throw e;
    }
    auth.setSession(res, account);
    res.redirect('/kol');
  } catch (e) { next(e); }
});

app.get('/kol/login', (req, res) => {
  const t = auth.currentTalent(req);
  if (t && t.type === 'kol') return res.redirect('/kol');
  res.send(V.talentLogin('kol', { lang: req.lang }));
});

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

app.post('/kol/logout', (req, res) => { auth.clearSession(res); res.redirect('/kol/login'); });

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

app.get('/kol', auth.requireTalent('kol'), async (req, res, next) => {
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
    res.send(V.kolProofPage({ talent: req.talent, events, proofs, assignments, lang: req.lang, settings }));
  } catch (e) { next(e); }
});

app.post('/kol/proofs', auth.requireTalent('kol'), upload.single('screenshot'), async (req, res, next) => {
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
    res.redirect('/kol');
  } catch (e) { next(e); }
});

// ------------------------------------------------------------ Main Power ----
// Main Power talents self-apply to events that open MP slots. An application
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

app.post('/main-power/register', async (req, res, next) => {
  try {
    const st = db();
    if (!st) return needConfig(req, res);
    const name = String(req.body.name || '').trim();
    const login = String(req.body.login || '').trim().toLowerCase();
    const password = String(req.body.password || '');

    const errors = [];
    if (!name) errors.push(req.t('err.nameRequired'));
    if (!login) errors.push(req.t('err.loginRequired'));
    if (password.length < 6) errors.push(req.t('err.passwordMin6'));
    if (errors.length) return res.status(400).send(V.talentRegister('main_power', { errors, values: { name, login }, lang: req.lang }));

    let account;
    try {
      account = await st.createAccount({ talent_type: 'main_power', name, login, password_hash: auth.hashPassword(password) });
    } catch (e) {
      if (e.code === 'DUP') return res.status(400).send(V.talentRegister('main_power', { errors: [req.t('err.dupAccount')], values: { name, login }, lang: req.lang }));
      throw e;
    }
    auth.setSession(res, account);
    res.redirect('/main-power');
  } catch (e) { next(e); }
});

app.get('/main-power/login', (req, res) => {
  const t = auth.currentTalent(req);
  if (t && t.type === 'main_power') return res.redirect('/main-power');
  res.send(V.talentLogin('main_power', { lang: req.lang }));
});

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

app.post('/main-power/logout', (req, res) => { auth.clearSession(res); res.redirect('/main-power/login'); });

app.get('/main-power', auth.requireTalent('main_power'), async (req, res, next) => {
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
    res.send(V.mainPowerDashboard({ talent: req.talent, openEvents, myApps: myAppsEnriched, lang: req.lang, applied: req.query.applied === '1' }));
  } catch (e) { next(e); }
});

app.get('/main-power/apply/:eventId', auth.requireTalent('main_power'), async (req, res, next) => {
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

app.post('/main-power/apply/:eventId', auth.requireTalent('main_power'), async (req, res, next) => {
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

app.get('/admin/login', (req, res) => {
  const t = auth.currentTalent(req);
  if (t && (t.type === 'super_admin' || t.type === 'eo')) return res.redirect('/admin');
  res.send(V.staffLogin({ lang: req.lang, variant: 'admin' }));
});

app.get('/eo/login', (req, res) => {
  const t = auth.currentTalent(req);
  if (t && (t.type === 'super_admin' || t.type === 'eo')) return res.redirect('/admin');
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
      auth.setSession(res, staff);
      res.redirect('/admin');
    } catch (e) { next(e); }
  };
}
app.post('/admin/login', staffLoginHandler('admin'));
app.post('/eo/login', staffLoginHandler('eo'));

app.post('/admin/logout', (req, res) => {
  const t = auth.currentTalent(req);
  const dest = (t && t.type === 'eo') ? '/eo/login' : '/admin/login';
  auth.clearSession(res);
  res.redirect(dest);
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
app.get('/admin', auth.requireStaff(['super_admin', 'eo']), async (req, res, next) => {
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
app.get('/admin/kol/:id', auth.requireStaff(['super_admin', 'eo']), async (req, res, next) => {
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
app.get('/admin/analytics', auth.requireStaff(['super_admin', 'eo']), async (req, res, next) => {
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
app.get('/admin/overview', auth.requireStaff(['super_admin', 'eo']), async (req, res, next) => {
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
app.get('/admin/overview/insight', auth.requireStaff(['super_admin', 'eo']), async (req, res) => {
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
app.get('/admin/proofs', auth.requireStaff(['super_admin', 'eo']), async (req, res, next) => {
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
    res.send(V.adminManage({ staff: staffCtx(req), events, assignments, talents, eos, proofs, lang: req.lang, settings }));
  } catch (e) { next(e); }
});

// Aplikasi MP (super admin only): review Main Power event applications.
app.get('/admin/applications', auth.requireStaff(['super_admin']), async (req, res, next) => {
  try {
    const st = db();
    if (!st) return needConfig(req, res);
    const [apps, events, talents] = await Promise.all([st.listApplications(), st.listEvents(), st.listTalents()]);
    const eventName = new Map(events.map((e) => [e.id, e.name]));
    const talentById = new Map(talents.map((tt) => [tt.id, tt]));
    const applications = apps.map((a) => {
      const tt = talentById.get(a.talent_id) || {};
      return { ...a, event_name: eventName.get(a.event_id) || null, talent_name: tt.name || null, talent_login: tt.login || null };
    });
    res.send(V.adminApplications({ staff: staffCtx(req), applications, lang: req.lang }));
  } catch (e) { next(e); }
});

// Super admin: approve (optionally assign station) or reject an application.
app.post('/admin/applications/:id/review', auth.requireStaff(['super_admin']), async (req, res, next) => {
  try {
    const st = db();
    if (!st) return needConfig(req, res);
    const action = String(req.body.action || '');
    if (action !== 'approve' && action !== 'reject') return res.redirect('/admin/applications');
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
    res.redirect('/admin/applications');
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
        await st.createStaff({ role: 'eo', name, login, password_hash: auth.hashPassword(password) });
      } catch (e) { if (e.code !== 'DUP') throw e; }
    }
    res.redirect('/admin/manage');
  } catch (e) { next(e); }
});

// Super admin: create event with per-talent-type needs.
app.post('/admin/events', auth.requireStaff(['super_admin']), async (req, res, next) => {
  try {
    const st = db();
    if (!st) return needConfig(req, res);
    const name = String(req.body.name || '').trim();
    const starts_at = String(req.body.starts_at || '').trim() || null;
    const ends_at = String(req.body.ends_at || '').trim() || null;
    const needs = [];
    if (req.body.need_kol) needs.push({ talent_type: 'kol' });
    if (req.body.need_main_power) needs.push({ talent_type: 'main_power', headcount: Math.max(1, parseInt(req.body.mp_headcount, 10) || 1) });
    if (req.body.need_fotografer) needs.push({ talent_type: 'fotografer' });
    const mp_sow = String(req.body.mp_sow || '').trim().slice(0, 2000) || null;
    if (name) await st.createEvent({ name, starts_at, ends_at, created_by: req.staff.id, needs, mp_sow });
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
    res.send(V.adminEventEdit({ staff: staffCtx(req), event, lang: req.lang }));
  } catch (e) { next(e); }
});

app.post('/admin/events/:id/edit', auth.requireStaff(['super_admin']), async (req, res, next) => {
  try {
    const st = db();
    if (!st) return needConfig(req, res);
    const name = String(req.body.name || '').trim();
    const starts_at = String(req.body.starts_at || '').trim() || null;
    const ends_at = String(req.body.ends_at || '').trim() || null;
    const hc = (key) => Math.max(1, parseInt(req.body[key], 10) || 1);
    const needs = [];
    if (req.body.need_kol) needs.push({ talent_type: 'kol', headcount: hc('kol_headcount') });
    if (req.body.need_main_power) needs.push({ talent_type: 'main_power', headcount: hc('mp_headcount') });
    if (req.body.need_fotografer) needs.push({ talent_type: 'fotografer', headcount: hc('fg_headcount') });
    const mp_sow = String(req.body.mp_sow || '').trim().slice(0, 2000) || null;
    const patch = { starts_at, ends_at, mp_sow, needs };
    if (name) patch.name = name;
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

app.get('/performance', auth.requireStaff(['super_admin', 'eo']), async (req, res, next) => {
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
});
