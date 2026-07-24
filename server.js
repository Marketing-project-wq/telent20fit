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

const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0';
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
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

app.get('/', (req, res) => res.send(V.landingPage()));

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

app.get('/kol', auth.requireTalent('kol'), async (req, res, next) => {
  try {
    const st = db();
    if (!st) return needConfig(res);
    const campaigns = await st.listActiveCampaigns();
    res.send(V.kolForm(campaigns, { talent: req.talent }));
  } catch (e) { next(e); }
});

app.post('/kol/submit', auth.requireTalent('kol'), upload.array('images', MAX_IMAGES), async (req, res, next) => {
  try {
    const st = db();
    if (!st) return needConfig(res);

    const campaignId = String(req.body.campaign_id || '').trim();
    let links = req.body.post_links;
    if (!Array.isArray(links)) links = links ? [links] : [];
    links = links.map((s) => String(s || '').trim()).filter(Boolean);
    const files = req.files || [];

    const errors = [];
    if (!campaignId) errors.push('Campaign wajib dipilih.');
    if (files.length < 1) errors.push('Upload minimal 1 gambar.');
    if (files.length > MAX_IMAGES) errors.push('Maksimal ' + MAX_IMAGES + ' gambar.');
    if (links.length < 1) errors.push('Minimal 1 link postingan.');
    links.forEach((l) => { if (!/^https?:\/\/.+/i.test(l)) errors.push('Link tidak valid: ' + l); });
    files.forEach((f) => { if (!/^image\//i.test(f.mimetype || '')) errors.push('File bukan gambar: ' + (f.originalname || '')); });

    let campaignName = '';
    if (campaignId) {
      const c = await st.getActiveCampaign(campaignId);
      if (!c) errors.push('Campaign tidak ditemukan / tidak aktif.');
      else campaignName = c.name;
    }

    if (errors.length) {
      const campaigns = await st.listActiveCampaigns();
      return res.status(400).send(V.kolForm(campaigns, {
        errors, values: { campaign_id: campaignId, links }, talent: req.talent,
      }));
    }

    const subId = crypto.randomUUID();
    const paths = [];
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      const ext = (path.extname(f.originalname || '').toLowerCase().match(/^\.[a-z0-9]{1,5}$/) || ['.jpg'])[0];
      const key = `${subId}/${i}${ext}`;
      await st.uploadImage(key, f.buffer, f.mimetype);
      paths.push(key);
    }

    await st.createSubmission({
      id: subId, talent_id: req.talent.id, kol_name: req.talent.name,
      campaign_id: campaignId, image_urls: paths, post_links: links,
    });
    res.send(V.kolSuccess(req.talent.name, campaignName));
  } catch (e) { next(e); }
});

// ----------------------------------------------------------------- admin ----

function safeEqual(a, b) {
  const ab = Buffer.from(String(a || ''));
  const bb = Buffer.from(String(b || ''));
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

function requireAdmin(req, res, next) {
  if (!ADMIN_PASSWORD) return res.status(503).send(V.configError('ADMIN_PASSWORD'));
  const [scheme, encoded] = (req.headers.authorization || '').split(' ');
  if (scheme === 'Basic' && encoded) {
    const [user, pass] = Buffer.from(encoded, 'base64').toString().split(':');
    if (safeEqual(user, ADMIN_USER) && safeEqual(pass, ADMIN_PASSWORD)) return next();
  }
  res.set('WWW-Authenticate', 'Basic realm="20FIT KOL Admin"').status(401).type('text').send('Autentikasi admin diperlukan.');
}

app.get('/admin', requireAdmin, async (req, res, next) => {
  try {
    const st = db();
    if (!st) return needConfig(res);
    const [subs, camps] = await Promise.all([st.listSubmissions(), st.listCampaigns()]);

    const countByCampaign = new Map();
    subs.forEach((s) => countByCampaign.set(s.campaign_id, (countByCampaign.get(s.campaign_id) || 0) + 1));
    const campNameById = new Map(camps.map((c) => [c.id, c.name]));
    const campsWithCount = camps.map((c) => ({ ...c, count: countByCampaign.get(c.id) || 0 }));

    const recent = await Promise.all(subs.slice(0, 50).map(async (s) => ({
      kol_name: s.kol_name,
      campaign_name: campNameById.get(s.campaign_id) || null,
      created_at: s.created_at,
      images: await st.signImageUrls(Array.isArray(s.image_urls) ? s.image_urls : []),
      links: Array.isArray(s.post_links) ? s.post_links : [],
    })));

    res.send(V.adminPage({
      totalSubs: subs.length,
      uniqueKol: new Set(subs.map((s) => s.kol_name)).size,
      camps: campsWithCount,
      recent,
    }));
  } catch (e) { next(e); }
});

app.post('/admin/campaigns', requireAdmin, async (req, res, next) => {
  try {
    const st = db();
    if (!st) return needConfig(res);
    const name = String(req.body.name || '').trim();
    if (name) await st.createCampaign(name);
    res.redirect('/admin');
  } catch (e) { next(e); }
});

app.post('/admin/campaigns/:id/toggle', requireAdmin, async (req, res, next) => {
  try {
    const st = db();
    if (!st) return needConfig(res);
    await st.toggleCampaign(req.params.id);
    res.redirect('/admin');
  } catch (e) { next(e); }
});

app.get('/performance', requireAdmin, async (req, res, next) => {
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
