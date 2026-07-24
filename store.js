'use strict';

/**
 * Data layer for the KOL app.
 *
 * Two backends behind one interface:
 *   - 'supabase' (default): real Supabase (Postgres + Storage) via the service role.
 *   - 'memory'  (KOL_STORE_MODE=memory): in-process store for local dev/testing
 *     without network access. Not for production.
 */

const { createClient } = require('@supabase/supabase-js');

const MODE = process.env.KOL_STORE_MODE || 'supabase';
const BUCKET = 'kol-uploads';

function supabaseStore() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  const sb = createClient(url, key, { auth: { persistSession: false } });

  return {
    mode: 'supabase',
    async listActiveCampaigns() {
      const { data, error } = await sb.from('kol_campaigns').select('id,name').eq('is_active', true).order('name');
      if (error) throw new Error(error.message);
      return data || [];
    },
    async getActiveCampaign(id) {
      const { data } = await sb.from('kol_campaigns').select('id,name').eq('id', id).eq('is_active', true).maybeSingle();
      return data || null;
    },
    async listCampaigns() {
      const { data, error } = await sb.from('kol_campaigns').select('*').order('created_at');
      if (error) throw new Error(error.message);
      return data || [];
    },
    async createCampaign(name) {
      const { error } = await sb.from('kol_campaigns').insert({ name });
      if (error) throw new Error(error.message);
    },
    async toggleCampaign(id) {
      const { data } = await sb.from('kol_campaigns').select('is_active').eq('id', id).maybeSingle();
      if (data) await sb.from('kol_campaigns').update({ is_active: !data.is_active }).eq('id', id);
    },
    async uploadImage(path, buffer, contentType) {
      const { error } = await sb.storage.from(BUCKET).upload(path, buffer, { contentType, upsert: false });
      if (error) throw new Error(error.message);
    },
    async signImageUrls(paths) {
      if (!paths || !paths.length) return [];
      const { data } = await sb.storage.from(BUCKET).createSignedUrls(paths, 3600);
      return (data || []).map((d) => d.signedUrl).filter(Boolean);
    },
    async createSubmission(row) {
      const { error } = await sb.from('kol_submissions').insert(row);
      if (error) throw new Error(error.message);
    },
    async listSubmissions() {
      const { data, error } = await sb.from('kol_submissions')
        .select('id,kol_name,campaign_id,image_urls,post_links,created_at,talent_id')
        .order('created_at', { ascending: false });
      if (error) throw new Error(error.message);
      return data || [];
    },
    async createAccount(acc) {
      const { data, error } = await sb.from('talent_accounts').insert(acc)
        .select('id,talent_type,name,login').maybeSingle();
      if (error) {
        if (/duplicate|unique/i.test(error.message)) { const e = new Error('DUP'); e.code = 'DUP'; throw e; }
        throw new Error(error.message);
      }
      return data;
    },
    async findAccount(talentType, login) {
      const { data } = await sb.from('talent_accounts')
        .select('id,talent_type,name,login,password_hash')
        .eq('talent_type', talentType).eq('login', login).maybeSingle();
      return data || null;
    },
    async getAccountById(id) {
      const { data } = await sb.from('talent_accounts').select('id,talent_type,name,login').eq('id', id).maybeSingle();
      return data || null;
    },
  };
}

function memoryStore() {
  const now = () => new Date().toISOString();
  const campaigns = [
    { id: 'camp-jakarta', name: 'Jakarta Run Series 2026', is_active: true, created_at: now() },
    { id: 'camp-bali', name: 'Bali Trail Marathon 2026', is_active: true, created_at: now() },
  ];
  const submissions = [];
  const accounts = [];
  const images = new Map();
  let seq = 0;

  return {
    mode: 'memory',
    async listActiveCampaigns() { return campaigns.filter((c) => c.is_active).map((c) => ({ id: c.id, name: c.name })); },
    async getActiveCampaign(id) { const c = campaigns.find((c) => c.id === id && c.is_active); return c ? { id: c.id, name: c.name } : null; },
    async listCampaigns() { return campaigns.map((c) => ({ ...c })); },
    async createCampaign(name) { campaigns.push({ id: 'camp-' + (++seq), name, is_active: true, created_at: now() }); },
    async toggleCampaign(id) { const c = campaigns.find((c) => c.id === id); if (c) c.is_active = !c.is_active; },
    async uploadImage(path, buffer, contentType) { images.set(path, { buffer, contentType }); },
    async signImageUrls(paths) { return (paths || []).map((p) => '/__mockimg/' + encodeURIComponent(p)); },
    async createSubmission(row) { submissions.push({ ...row, created_at: now() }); },
    async listSubmissions() { return submissions.slice().reverse(); },
    async createAccount(acc) {
      if (accounts.find((a) => a.talent_type === acc.talent_type && a.login === acc.login)) {
        const e = new Error('DUP'); e.code = 'DUP'; throw e;
      }
      const rec = { id: 'acc-' + (++seq), ...acc, created_at: now() };
      accounts.push(rec);
      return { id: rec.id, talent_type: rec.talent_type, name: rec.name, login: rec.login };
    },
    async findAccount(talentType, login) { return accounts.find((a) => a.talent_type === talentType && a.login === login) || null; },
    async getAccountById(id) { const a = accounts.find((a) => a.id === id); return a ? { id: a.id, talent_type: a.talent_type, name: a.name, login: a.login } : null; },
  };
}

let impl;
function store() {
  if (impl === undefined) impl = (MODE === 'memory') ? memoryStore() : supabaseStore();
  return impl;
}

module.exports = { store, MODE };
