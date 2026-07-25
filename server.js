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

const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0';
const MAX_IMAGES = 5;
const MAX_IMAGE_BYTES = 6 * 1024 * 1024;

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMAGE_BYTES, files: MAX_IMAGES },
});

const db = () => store();
const needConfig = (res) => res.status(503).send(V.configError('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY'));

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

app.get('/', (req, res) => res.send(V.landingPage(readLang(req, res))));
app.get('/register', (req, res) => res.send(V.talentPicker('register', readLang(req, res))));
app.get('/login', (req, res) => res.send(V.talentPicker('login', readLang(req, res))));

app.get('/prototype', (req, res) => {
  if (!prototypeHtml) return res.status(404).type('text').send('No prototype file found.');
  res.type('html').send(prototypeHtml);
});

// --------------------------------------------------------------- KOL auth ----

app.get('/kol/register', (req, res) => {
  const t = auth.currentTalent(req);
  if (t && t.type === 'kol') return res.redirect('/kol');
  res.send(V.talentRegister('kol'));
});

app.post('/kol/register', async (req, res, next) => {
  try {
    const st = db();
    if (!st) return needConfig(res);
    const name = String(req.body.name || '').trim();
    const login = String(req.body.login || '').trim().toLowerCase();
    const password = String(req.body.password || '');

    const errors = [];
    if (!name) errors.push('Nama wajib diisi.');
    if (!login) errors.push('Email / No. HP wajib diisi.');
    if (password.length < 6) errors.push('Password minimal 6 karakter.');
    if (errors.length) return res.status(400).send(V.talentRegister('kol', { errors, values: { name, login } }));

    let account;
    try {
      account = await st.createAccount({ talent_type: 'kol', name, login, password_hash: auth.hashPassword(password) });
    } catch (e) {
      if (e.code === 'DUP') {
        return res.status(400).send(V.talentRegister('kol', {
          errors: ['Email / No. HP itu sudah terdaftar. Silakan masuk.'], values: { name, login },
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
  res.send(V.talentLogin('kol'));
});

app.post('/kol/login', async (req, res, next) => {
  try {
    const st = db();
    if (!st) return needConfig(res);
    const login = String(req.body.login || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    const account = await st.findAccount('kol', login);
    if (!account || !auth.verifyPassword(password, account.password_hash)) {
      return res.status(401).send(V.talentLogin('kol', { errors: ['Email/No. HP atau password salah.'], values: { login } }));
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
    talent_name: ctx.talentNameById ? (ctx.talentNameById.get(p.talent_id) || null) : null,
    thumb: p.screenshot_path ? urlByPath.get(p.screenshot_path) : null,
  }));
}

// Extract stats from a proof screenshot via the LLM, in the background.
async function runExtraction(st, proofId, buffer, mimeType) {
  try {
    await st.updateProof(proofId, { status: 'processing' });
    const { model, extracted, ocr_text } = await llm.extractFromImage(buffer, mimeType);
    await st.updateProof(proofId, {
      status: 'extracted', platform: extracted.platform || null,
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
    if (!st) return needConfig(res);
    const [events, myProofs] = await Promise.all([st.listActiveEvents(), st.listProofsForTalent(req.talent.id)]);
    const proofs = await enrichProofs(st, myProofs, { events });
    res.send(V.kolProofPage({ talent: req.talent, events, proofs }));
  } catch (e) { next(e); }
});

app.post('/kol/proofs', auth.requireTalent('kol'), upload.single('screenshot'), async (req, res, next) => {
  try {
    const st = db();
    if (!st) return needConfig(res);
    const eventId = String(req.body.event_id || '').trim();
    const postLink = String(req.body.post_link || '').trim();
    const file = req.file;

    const errors = [];
    if (!eventId) errors.push('Event wajib dipilih.');
    if (!file) errors.push('Screenshot wajib diupload.');
    else if (!/^image\//i.test(file.mimetype || '')) errors.push('File harus berupa gambar.');
    if (postLink && !/^https?:\/\/.+/i.test(postLink)) errors.push('Link postingan tidak valid.');

    if (errors.length) {
      const [events, myProofs] = await Promise.all([st.listActiveEvents(), st.listProofsForTalent(req.talent.id)]);
      const proofs = await enrichProofs(st, myProofs, { events });
      return res.status(400).send(V.kolProofPage({ talent: req.talent, events, proofs, errors }));
    }

    const proofId = crypto.randomUUID();
    const ext = (path.extname(file.originalname || '').toLowerCase().match(/^\.[a-z0-9]{1,5}$/) || ['.jpg'])[0];
    const key = `proofs/${proofId}${ext}`;
    await st.uploadImage(key, file.buffer, file.mimetype);
    await st.createProof({
      id: proofId, talent_id: req.talent.id, talent_type: 'kol',
      event_id: eventId, screenshot_path: key, post_link: postLink || null, status: 'pending',
    });

    runExtraction(st, proofId, file.buffer, file.mimetype); // fire-and-forget
    res.redirect('/kol');
  } catch (e) { next(e); }
});

// ----------------------------------------------------------------- admin ----

app.get('/admin/login', (req, res) => {
  const t = auth.currentTalent(req);
  if (t && (t.type === 'super_admin' || t.type === 'eo')) return res.redirect('/admin');
  res.send(V.staffLogin());
});

app.post('/admin/login', async (req, res, next) => {
  try {
    const st = db();
    if (!st) return needConfig(res);
    const login = String(req.body.login || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    const staff = await st.findStaff(login);
    if (!staff || !auth.verifyPassword(password, staff.password_hash)) {
      return res.status(401).send(V.staffLogin({ errors: ['Email atau password salah.'], values: { login } }));
    }
    auth.setSession(res, staff);
    res.redirect('/admin');
  } catch (e) { next(e); }
});

app.post('/admin/logout', (req, res) => { auth.clearSession(res); res.redirect('/admin/login'); });

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

app.get('/admin', auth.requireStaff(['super_admin', 'eo']), async (req, res, next) => {
  try {
    const st = db();
    if (!st) return needConfig(res);
    const isSuper = req.staff.type === 'super_admin';
    const [rawProofs, events, assignments, talentsAll, eos] = await Promise.all([
      st.listProofs(),
      st.listEvents(),
      isSuper ? st.listAssignments() : Promise.resolve([]),
      st.listTalents(),
      isSuper ? st.listStaff('eo') : Promise.resolve([]),
    ]);
    const talentNameById = new Map(talentsAll.map((t) => [t.id, t.name]));
    const proofs = await enrichProofs(st, rawProofs.slice(0, 100), { events, talentNameById });

    res.send(V.adminPage({
      staff: { role: req.staff.type, name: req.staff.name },
      events, assignments, proofs, eos,
      talents: isSuper ? talentsAll : [],
    }));
  } catch (e) { next(e); }
});

// Super admin only: create an Event Organizer account.
app.post('/admin/eos', auth.requireStaff(['super_admin']), async (req, res, next) => {
  try {
    const st = db();
    if (!st) return needConfig(res);
    const name = String(req.body.name || '').trim();
    const login = String(req.body.login || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    if (name && login && password.length >= 6) {
      try {
        await st.createStaff({ role: 'eo', name, login, password_hash: auth.hashPassword(password) });
      } catch (e) { if (e.code !== 'DUP') throw e; }
    }
    res.redirect('/admin');
  } catch (e) { next(e); }
});

// Super admin: create event with per-talent-type needs.
app.post('/admin/events', auth.requireStaff(['super_admin']), async (req, res, next) => {
  try {
    const st = db();
    if (!st) return needConfig(res);
    const name = String(req.body.name || '').trim();
    const needs = [];
    if (req.body.need_kol) needs.push({ talent_type: 'kol' });
    if (req.body.need_main_power) needs.push({ talent_type: 'main_power' });
    if (req.body.need_fotografer) needs.push({ talent_type: 'fotografer' });
    if (name) await st.createEvent({ name, created_by: req.staff.id, needs });
    res.redirect('/admin');
  } catch (e) { next(e); }
});

app.post('/admin/events/:id/toggle', auth.requireStaff(['super_admin']), async (req, res, next) => {
  try {
    const st = db();
    if (!st) return needConfig(res);
    await st.toggleEvent(req.params.id);
    res.redirect('/admin');
  } catch (e) { next(e); }
});

// Super admin: assign a talent to an event.
app.post('/admin/assignments', auth.requireStaff(['super_admin']), async (req, res, next) => {
  try {
    const st = db();
    if (!st) return needConfig(res);
    const talentId = String(req.body.talent_id || '').trim();
    const eventId = String(req.body.event_id || '').trim();
    if (talentId && eventId) {
      const t = (await st.listTalents()).find((x) => x.id === talentId);
      if (t) await st.createAssignment({ event_id: eventId, talent_id: talentId, talent_type: t.talent_type, assigned_by: req.staff.id });
    }
    res.redirect('/admin');
  } catch (e) { next(e); }
});

// Super admin: verify / reject / re-extract a proof.
async function setProofStatus(st, id, status, staffId) {
  await st.updateProof(id, { status, verified_by: staffId || null, verified_at: new Date().toISOString() });
}
app.post('/admin/proofs/:id/verify', auth.requireStaff(['super_admin']), async (req, res, next) => {
  try { const st = db(); if (!st) return needConfig(res); await setProofStatus(st, req.params.id, 'verified', req.staff.id); res.redirect('/admin'); } catch (e) { next(e); }
});
app.post('/admin/proofs/:id/reject', auth.requireStaff(['super_admin']), async (req, res, next) => {
  try { const st = db(); if (!st) return needConfig(res); await setProofStatus(st, req.params.id, 'rejected', req.staff.id); res.redirect('/admin'); } catch (e) { next(e); }
});
app.post('/admin/proofs/:id/reextract', auth.requireStaff(['super_admin']), async (req, res, next) => {
  try {
    const st = db();
    if (!st) return needConfig(res);
    const p = await st.getProof(req.params.id);
    if (p && p.screenshot_path) {
      const buf = await st.downloadImage(p.screenshot_path);
      if (buf) runExtraction(st, p.id, buf, 'image/jpeg');
    }
    res.redirect('/admin');
  } catch (e) { next(e); }
});

app.get('/performance', auth.requireStaff(['super_admin', 'eo']), async (req, res, next) => {
  try {
    const st = db();
    if (!st) return needConfig(res);
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
