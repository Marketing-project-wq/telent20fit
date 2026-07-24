'use strict';

/**
 * 20FIT Talent — KOL app.
 *
 *   Public:
 *     GET  /                     -> redirect to /kol
 *     GET  /kol                  -> submission form
 *     POST /kol/submit           -> create a submission (name, campaign, 1-5 images, 1+ links)
 *     GET  /prototype            -> the archived design prototype (bundled HTML)
 *     GET  /health               -> health check
 *
 *   Admin (HTTP Basic auth, ADMIN_USER / ADMIN_PASSWORD):
 *     GET  /admin                -> dashboard (submission counts + campaign management)
 *     POST /admin/campaigns      -> add campaign
 *     POST /admin/campaigns/:id/toggle -> activate / deactivate campaign
 *     GET  /performance          -> KOL leaderboard (admin-only)
 *
 * Data lives in Supabase. The public form uses the anon key (locked down by RLS
 * so it can only insert). Admin routes use the service-role key (server-side).
 */

const express = require('express');
const multer = require('multer');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const V = require('./views');

const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0';
const SUPABASE_URL = process.env.SUPABASE_URL;
const ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const BUCKET = 'kol-uploads';
const MAX_IMAGES = 5;
const MAX_IMAGE_BYTES = 6 * 1024 * 1024;

const anon = SUPABASE_URL && ANON_KEY
  ? createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } })
  : null;
const admin = SUPABASE_URL && SERVICE_KEY
  ? createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })
  : null;

const app = express();
app.disable('x-powered-by');
app.use(express.urlencoded({ extended: true }));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMAGE_BYTES, files: MAX_IMAGES },
});

// The archived prototype (served at /prototype), loaded once if present.
let prototypeHtml = null;
try {
  const entries = fs.readdirSync(__dirname);
  const file = entries.find((f) => f.toLowerCase().endsWith('.html'));
  if (file) prototypeHtml = fs.readFileSync(path.join(__dirname, file));
} catch (_) { /* ignore */ }

// ---------------------------------------------------------------- public ----

app.get('/health', (req, res) => res.type('text').send('ok'));

app.get('/', (req, res) => res.send(V.chooseCategory()));

app.get('/prototype', (req, res) => {
  if (!prototypeHtml) return res.status(404).type('text').send('No prototype file found.');
  res.type('html').send(prototypeHtml);
});

app.get('/kol', async (req, res, next) => {
  try {
    if (!anon) return res.status(503).send(V.configError('SUPABASE_URL / SUPABASE_ANON_KEY'));
    const { data, error } = await anon
      .from('kol_campaigns').select('id,name').eq('is_active', true).order('name');
    if (error) throw new Error(error.message);
    res.send(V.kolForm(data || []));
  } catch (e) { next(e); }
});

app.post('/kol/submit', upload.array('images', MAX_IMAGES), async (req, res, next) => {
  try {
    if (!anon) return res.status(503).send(V.configError('SUPABASE_URL / SUPABASE_ANON_KEY'));

    const kolName = String(req.body.kol_name || '').trim();
    const campaignId = String(req.body.campaign_id || '').trim();
    let links = req.body.post_links;
    if (!Array.isArray(links)) links = links ? [links] : [];
    links = links.map((s) => String(s || '').trim()).filter(Boolean);
    const files = req.files || [];

    const errors = [];
    if (!kolName) errors.push('Nama KOL wajib diisi.');
    if (!campaignId) errors.push('Campaign wajib dipilih.');
    if (files.length < 1) errors.push('Upload minimal 1 gambar.');
    if (files.length > MAX_IMAGES) errors.push('Maksimal ' + MAX_IMAGES + ' gambar.');
    if (links.length < 1) errors.push('Minimal 1 link postingan.');
    links.forEach((l) => { if (!/^https?:\/\/.+/i.test(l)) errors.push('Link tidak valid: ' + l); });
    files.forEach((f) => { if (!/^image\//i.test(f.mimetype || '')) errors.push('File bukan gambar: ' + (f.originalname || '')); });

    let campaignName = '';
    if (campaignId) {
      const { data: c } = await anon
        .from('kol_campaigns').select('id,name').eq('id', campaignId).eq('is_active', true).maybeSingle();
      if (!c) errors.push('Campaign tidak ditemukan / tidak aktif.');
      else campaignName = c.name;
    }

    if (errors.length) {
      const { data } = await anon
        .from('kol_campaigns').select('id,name').eq('is_active', true).order('name');
      return res.status(400).send(V.kolForm(data || [], {
        errors, values: { kol_name: kolName, campaign_id: campaignId, links },
      }));
    }

    // Upload images to storage under a per-submission folder, then insert the row.
    const subId = crypto.randomUUID();
    const paths = [];
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      const ext = (path.extname(f.originalname || '').toLowerCase().match(/^\.[a-z0-9]{1,5}$/) || ['.jpg'])[0];
      const key = `${subId}/${i}${ext}`;
      const { error: upErr } = await anon.storage.from(BUCKET)
        .upload(key, f.buffer, { contentType: f.mimetype, upsert: false });
      if (upErr) throw new Error('Gagal upload gambar: ' + upErr.message);
      paths.push(key);
    }

    // Note: no .select() -> return=minimal, so the insert-only RLS policy suffices.
    const { error: insErr } = await anon.from('kol_submissions').insert({
      id: subId, kol_name: kolName, campaign_id: campaignId, image_urls: paths, post_links: links,
    });
    if (insErr) throw new Error('Gagal menyimpan submission: ' + insErr.message);

    res.send(V.kolSuccess(kolName, campaignName));
  } catch (e) { next(e); }
});

// ----------------------------------------------------------------- admin ----

function timingSafeEqual(a, b) {
  const ab = Buffer.from(String(a || ''));
  const bb = Buffer.from(String(b || ''));
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

function requireAdmin(req, res, next) {
  if (!ADMIN_PASSWORD) return res.status(503).send(V.configError('ADMIN_PASSWORD'));
  const header = req.headers.authorization || '';
  const [scheme, encoded] = header.split(' ');
  if (scheme === 'Basic' && encoded) {
    const [user, pass] = Buffer.from(encoded, 'base64').toString().split(':');
    if (timingSafeEqual(user, ADMIN_USER) && timingSafeEqual(pass, ADMIN_PASSWORD)) return next();
  }
  res.set('WWW-Authenticate', 'Basic realm="20FIT KOL Admin"').status(401).type('text').send('Autentikasi admin diperlukan.');
}

/** Fetch all submissions + campaigns via the service-role client. */
async function loadAdminData() {
  const [subsRes, campsRes] = await Promise.all([
    admin.from('kol_submissions')
      .select('id,kol_name,campaign_id,image_urls,post_links,created_at')
      .order('created_at', { ascending: false }),
    admin.from('kol_campaigns').select('*').order('created_at'),
  ]);
  if (subsRes.error) throw new Error(subsRes.error.message);
  if (campsRes.error) throw new Error(campsRes.error.message);
  return { subs: subsRes.data || [], camps: campsRes.data || [] };
}

app.get('/admin', requireAdmin, async (req, res, next) => {
  try {
    if (!admin) return res.send(V.adminNoService());
    const { subs, camps } = await loadAdminData();

    const countByCampaign = new Map();
    subs.forEach((s) => countByCampaign.set(s.campaign_id, (countByCampaign.get(s.campaign_id) || 0) + 1));
    const campNameById = new Map(camps.map((c) => [c.id, c.name]));
    const campsWithCount = camps.map((c) => ({ ...c, count: countByCampaign.get(c.id) || 0 }));

    // Recent submissions with signed image URLs (private bucket).
    const recentRaw = subs.slice(0, 50);
    const recent = await Promise.all(recentRaw.map(async (s) => {
      const paths = Array.isArray(s.image_urls) ? s.image_urls : [];
      let images = [];
      if (paths.length) {
        const { data } = await admin.storage.from(BUCKET).createSignedUrls(paths, 3600);
        images = (data || []).map((d) => d.signedUrl).filter(Boolean);
      }
      return {
        kol_name: s.kol_name,
        campaign_name: campNameById.get(s.campaign_id) || null,
        created_at: s.created_at,
        images,
        links: Array.isArray(s.post_links) ? s.post_links : [],
      };
    }));

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
    if (!admin) return res.send(V.adminNoService());
    const name = String(req.body.name || '').trim();
    if (name) await admin.from('kol_campaigns').insert({ name });
    res.redirect('/admin');
  } catch (e) { next(e); }
});

app.post('/admin/campaigns/:id/toggle', requireAdmin, async (req, res, next) => {
  try {
    if (!admin) return res.send(V.adminNoService());
    const { data: c } = await admin.from('kol_campaigns').select('is_active').eq('id', req.params.id).maybeSingle();
    if (c) await admin.from('kol_campaigns').update({ is_active: !c.is_active }).eq('id', req.params.id);
    res.redirect('/admin');
  } catch (e) { next(e); }
});

app.get('/performance', requireAdmin, async (req, res, next) => {
  try {
    if (!admin) return res.send(V.adminNoService());
    const { data: subs, error } = await admin.from('kol_submissions')
      .select('kol_name,post_links,image_urls,created_at');
    if (error) throw new Error(error.message);

    const map = new Map();
    (subs || []).forEach((s) => {
      const e = map.get(s.kol_name) || { kol_name: s.kol_name, submissions: 0, posts: 0, images: 0, last: null };
      e.submissions += 1;
      e.posts += Array.isArray(s.post_links) ? s.post_links.length : 0;
      e.images += Array.isArray(s.image_urls) ? s.image_urls.length : 0;
      if (!e.last || s.created_at > e.last) e.last = s.created_at;
      map.set(s.kol_name, e);
    });
    const board = [...map.values()].sort((a, b) => b.submissions - a.submissions || b.posts - a.posts);
    res.send(V.performancePage(board, (subs || []).length));
  } catch (e) { next(e); }
});

// -------------------------------------------------------------- fallbacks ----

// Multer / unexpected errors -> friendly page.
app.use((err, req, res, next) => {
  let msg = err.message || 'Terjadi kesalahan.';
  if (err.code === 'LIMIT_FILE_SIZE') msg = 'Ukuran gambar terlalu besar (maks 6 MB per file).';
  if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE') msg = 'Maksimal ' + MAX_IMAGES + ' gambar.';
  console.error('[error]', err.code || '', err.message);
  res.status(500).send(V.page500(msg));
});

app.listen(PORT, HOST, () => {
  console.log('20FIT KOL server running at http://' + HOST + ':' + PORT);
  console.log('Supabase: ' + (anon ? 'anon OK' : 'anon MISSING') + ', ' + (admin ? 'service OK' : 'service MISSING'));
});
