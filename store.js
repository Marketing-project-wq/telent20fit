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
    async downloadImage(pathKey) {
      const { data, error } = await sb.storage.from(BUCKET).download(pathKey);
      if (error || !data) return null;
      return Buffer.from(await data.arrayBuffer());
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
    async createStaff(acc) {
      const { data, error } = await sb.from('staff_accounts').insert(acc).select('id,role,name,login').maybeSingle();
      if (error) {
        if (/duplicate|unique/i.test(error.message)) { const e = new Error('DUP'); e.code = 'DUP'; throw e; }
        throw new Error(error.message);
      }
      return data;
    },
    async findStaff(login) {
      const { data } = await sb.from('staff_accounts').select('id,role,name,login,password_hash').eq('login', login).maybeSingle();
      return data || null;
    },
    async getStaffById(id) {
      const { data } = await sb.from('staff_accounts').select('id,role,name,login').eq('id', id).maybeSingle();
      return data || null;
    },
    async listStaff(role) {
      let q = sb.from('staff_accounts').select('id,role,name,login,created_at').order('created_at');
      if (role) q = q.eq('role', role);
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      return data || [];
    },
    // ---- events / assignments / proofs ----
    async listTalents(talentType) {
      let q = sb.from('talent_accounts').select('id,talent_type,name,login').order('name');
      if (talentType) q = q.eq('talent_type', talentType);
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      return data || [];
    },
    async createEvent({ name, description, starts_at, ends_at, created_by, needs }) {
      const { data, error } = await sb.from('talent_events')
        .insert({ name, description: description || null, starts_at: starts_at || null, ends_at: ends_at || null, created_by: created_by || null })
        .select('id,name,is_active,created_at').maybeSingle();
      if (error) throw new Error(error.message);
      const list = (needs || []).filter((n) => n && n.talent_type)
        .map((n) => ({ event_id: data.id, talent_type: n.talent_type, headcount: n.headcount || 1 }));
      if (list.length) { const r = await sb.from('talent_event_needs').insert(list); if (r.error) throw new Error(r.error.message); }
      return data;
    },
    async listEvents() {
      const [ev, nd] = await Promise.all([
        sb.from('talent_events').select('*').order('created_at', { ascending: false }),
        sb.from('talent_event_needs').select('*'),
      ]);
      if (ev.error) throw new Error(ev.error.message);
      const byEvent = new Map();
      (nd.data || []).forEach((n) => { const a = byEvent.get(n.event_id) || []; a.push(n); byEvent.set(n.event_id, a); });
      return (ev.data || []).map((e) => ({ ...e, needs: byEvent.get(e.id) || [] }));
    },
    async listActiveEvents() {
      const { data, error } = await sb.from('talent_events').select('id,name').eq('is_active', true).order('name');
      if (error) throw new Error(error.message);
      return data || [];
    },
    async toggleEvent(id) {
      const { data } = await sb.from('talent_events').select('is_active').eq('id', id).maybeSingle();
      if (data) await sb.from('talent_events').update({ is_active: !data.is_active }).eq('id', id);
    },
    async createAssignment({ event_id, talent_id, talent_type, assigned_by }) {
      const { error } = await sb.from('talent_event_assignments')
        .insert({ event_id, talent_id, talent_type, assigned_by: assigned_by || null });
      if (error && !/duplicate|unique/i.test(error.message)) throw new Error(error.message);
    },
    async listAssignments() {
      const { data, error } = await sb.from('talent_event_assignments').select('*').order('assigned_at', { ascending: false });
      if (error) throw new Error(error.message);
      return data || [];
    },
    async createProof(row) {
      const { data, error } = await sb.from('talent_post_proofs').insert(row).select('id').maybeSingle();
      if (error) throw new Error(error.message);
      return data;
    },
    async updateProof(id, patch) {
      const { error } = await sb.from('talent_post_proofs').update(patch).eq('id', id);
      if (error) throw new Error(error.message);
    },
    async listProofs() {
      const { data, error } = await sb.from('talent_post_proofs').select('*').order('created_at', { ascending: false });
      if (error) throw new Error(error.message);
      return data || [];
    },
    async listProofsForTalent(talentId) {
      const { data, error } = await sb.from('talent_post_proofs').select('*').eq('talent_id', talentId).order('created_at', { ascending: false });
      if (error) throw new Error(error.message);
      return data || [];
    },
    async getProof(id) {
      const { data } = await sb.from('talent_post_proofs').select('*').eq('id', id).maybeSingle();
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
  const staff = [{
    id: 'staff-super', role: 'super_admin', name: 'Super Admin', login: 'admin1@gmail.com',
    password_hash: require('./auth').hashPassword('Admin_12345'), created_at: now(),
  }];
  const events = [
    { id: 'ev-jakarta', name: 'Jakarta Run Series 2026', description: null, starts_at: null, ends_at: null, is_active: true, created_by: null, created_at: now() },
    { id: 'ev-bali', name: 'Bali Trail Marathon 2026', description: null, starts_at: null, ends_at: null, is_active: true, created_by: null, created_at: now() },
  ];
  const eventNeeds = [
    { event_id: 'ev-jakarta', talent_type: 'kol', headcount: 2 },
    { event_id: 'ev-bali', talent_type: 'kol', headcount: 1 },
  ];
  const assignments = [];
  const proofs = [];
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
    async downloadImage(pathKey) { const r = images.get(pathKey); return r ? r.buffer : null; },
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
    async createStaff(acc) {
      if (staff.find((s) => s.login === acc.login)) { const e = new Error('DUP'); e.code = 'DUP'; throw e; }
      const rec = { id: 'staff-' + (++seq), ...acc, created_at: now() };
      staff.push(rec);
      return { id: rec.id, role: rec.role, name: rec.name, login: rec.login };
    },
    async findStaff(login) { return staff.find((s) => s.login === login) || null; },
    async getStaffById(id) { const s = staff.find((s) => s.id === id); return s ? { id: s.id, role: s.role, name: s.name, login: s.login } : null; },
    async listStaff(role) { return staff.filter((s) => !role || s.role === role).map((s) => ({ id: s.id, role: s.role, name: s.name, login: s.login, created_at: s.created_at })); },
    async listTalents(talentType) { return accounts.filter((a) => !talentType || a.talent_type === talentType).map((a) => ({ id: a.id, talent_type: a.talent_type, name: a.name, login: a.login })); },
    async createEvent({ name, description, starts_at, ends_at, created_by, needs }) {
      const ev = { id: 'ev-' + (++seq), name, description: description || null, starts_at: starts_at || null, ends_at: ends_at || null, is_active: true, created_by: created_by || null, created_at: now() };
      events.unshift(ev);
      (needs || []).filter((n) => n && n.talent_type).forEach((n) => eventNeeds.push({ event_id: ev.id, talent_type: n.talent_type, headcount: n.headcount || 1 }));
      return { id: ev.id, name: ev.name, is_active: ev.is_active, created_at: ev.created_at };
    },
    async listEvents() { return events.map((e) => ({ ...e, needs: eventNeeds.filter((n) => n.event_id === e.id) })); },
    async listActiveEvents() { return events.filter((e) => e.is_active).map((e) => ({ id: e.id, name: e.name })); },
    async toggleEvent(id) { const e = events.find((e) => e.id === id); if (e) e.is_active = !e.is_active; },
    async createAssignment({ event_id, talent_id, talent_type, assigned_by }) {
      if (!assignments.find((a) => a.event_id === event_id && a.talent_id === talent_id)) {
        assignments.push({ id: 'as-' + (++seq), event_id, talent_id, talent_type, status: 'assigned', assigned_by: assigned_by || null, assigned_at: now() });
      }
    },
    async listAssignments() { return assignments.slice().reverse(); },
    async createProof(row) { const p = { id: 'pf-' + (++seq), ...row, status: row.status || 'pending', created_at: now() }; proofs.push(p); return { id: p.id }; },
    async updateProof(id, patch) { const p = proofs.find((p) => p.id === id); if (p) Object.assign(p, patch); },
    async listProofs() { return proofs.slice().reverse(); },
    async listProofsForTalent(talentId) { return proofs.filter((p) => p.talent_id === talentId).slice().reverse(); },
    async getProof(id) { return proofs.find((p) => p.id === id) || null; },
  };
}

let impl;
function store() {
  if (impl === undefined) impl = (MODE === 'memory') ? memoryStore() : supabaseStore();
  return impl;
}

module.exports = { store, MODE };
