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

// Optional per-position detail fields (all nullable text). General fields apply
// to every category; the kol_* / photo_* fields only carry data for KOL /
// photographer positions. Shared by the read + write paths in both stores.
const POS_DETAIL_COLS = ['description', 'description_en', 'custom_label', 'custom_label_en', 'jobdesk_en', 'requirement_en', 'work_hours', 'venue_detail', 'dresscode', 'meeting_point', 'kol_content', 'kol_deadline', 'kol_min_followers', 'kol_hashtags', 'photo_output', 'photo_deadline', 'photo_equipment'];
const pickPosDetails = (src) => { const o = {}; for (const c of POS_DETAIL_COLS) o[c] = (src && src[c]) || null; return o; };

// Flatten a role_templates row (with its joined talent_positions) to the shape
// the routes/views consume. Division falls back to the master position's.
const mapRoleTemplate = (r) => ({
  id: r.id, event_type_id: r.event_type_id, position_id: r.position_id,
  division: r.division || (r.talent_positions && r.talent_positions.division) || null,
  default_quota: r.default_quota, sort_order: r.sort_order,
  description: r.description || null, is_active: r.is_active,
  key: r.talent_positions && r.talent_positions.key,
  label_id: r.talent_positions && r.talent_positions.label_id,
  label_en: r.talent_positions && r.talent_positions.label_en,
});

// Memory-store mirrors of the two helpers above.
const memRoleTpl = (t, positions) => { const m = (positions || []).find((p) => p.id === t.position_id) || {}; return { id: t.id, event_type_id: t.event_type_id, position_id: t.position_id, division: t.division || m.division || null, default_quota: t.default_quota, sort_order: t.sort_order, description: t.description || null, is_active: t.is_active, key: m.key, label_id: m.label_id, label_en: m.label_en }; };
const memApprovedCount = (applications, choices, eventId, positionId) => (choices || []).filter((c) => c.position_id === positionId && c.accepted && ((applications || []).find((a) => a.id === c.application_id) || {}).event_id === eventId).length;

// Per-metric "reasonable per day" thresholds (green ceiling, yellow ceiling).
const SETTING_KEYS = [
  'vpd_green', 'vpd_yellow', 'lpd_green', 'lpd_yellow', 'cpd_green', 'cpd_yellow',
  'spd_green', 'spd_yellow', 'shpd_green', 'shpd_yellow',
  // KOL eligibility scoring
  'score_target_views', 'score_target_eng', 'score_min_campaigns', 'score_eligible', 'score_consider',
];
const DEFAULT_SETTINGS = {
  vpd_green: 3000, vpd_yellow: 10000, lpd_green: 300, lpd_yellow: 1000,
  cpd_green: 50, cpd_yellow: 200, spd_green: 50, spd_yellow: 200, shpd_green: 30, shpd_yellow: 100,
  score_target_views: 5000, score_target_eng: 500, score_min_campaigns: 3, score_eligible: 70, score_consider: 45,
};

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
    async removeImage(paths) {
      const list = (Array.isArray(paths) ? paths : [paths]).filter(Boolean);
      if (!list.length) return;
      try { await sb.storage.from(BUCKET).remove(list); } catch (_) { /* best-effort */ }
    },
    async signImageUrls(paths) {
      if (!paths || !paths.length) return [];
      const { data } = await sb.storage.from(BUCKET).createSignedUrls(paths, 3600);
      return (data || []).map((d) => d.signedUrl).filter(Boolean);
    },
    // Like signImageUrls but keeps alignment: returns url-or-null per input path.
    async signCovers(paths) {
      if (!paths || !paths.length) return [];
      const { data } = await sb.storage.from(BUCKET).createSignedUrls(paths, 3600);
      return (data || []).map((d) => (d && d.signedUrl && !d.error) ? d.signedUrl : null);
    },
    // Landing hero backgrounds: two fixed slots (1,2), upserted; served via signed URLs.
    async putLandingBg(slot, buffer, contentType) {
      const key = 'landing/bg-' + slot + '.jpg';
      const { error } = await sb.storage.from(BUCKET).upload(key, buffer, { contentType: contentType || 'image/jpeg', upsert: true });
      if (error) throw new Error(error.message);
      return key;
    },
    async landingBgUrls() {
      const { data, error } = await sb.storage.from(BUCKET).createSignedUrls(['landing/bg-1.jpg', 'landing/bg-2.jpg'], 7200);
      if (error) return null; // signing failed (transient) — signal caller so it doesn't cache the miss
      return (data || []).map((d) => (d && d.signedUrl && !d.error) ? d.signedUrl : null);
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
    // Unified login: find a talent account by email across all talent types.
    async findAccountByLogin(login) {
      const { data } = await sb.from('talent_accounts')
        .select('id,talent_type,name,login,password_hash')
        .eq('login', login).order('created_at', { ascending: true }).limit(1);
      return (data && data[0]) || null;
    },
    async getAccountById(id) {
      const { data } = await sb.from('talent_accounts')
        .select('id,talent_type,name,full_name,login,phone,city,province,birthdate,gender,instagram,instagram_followers,experience,ktp,profile_completed_at,cv_path,portfolio_url,hyrox_cert_path,hyrox_cert_status,hyrox_cert_verified_by,hyrox_cert_verified_at,hyrox_cert_note,created_at')
        .eq('id', id).maybeSingle();
      return data || null;
    },
    async getCertConfig() {
      const { data } = await sb.from('cert_config').select('signatory_name,signatory_title,verify_base').eq('id', 1).maybeSingle();
      return data || { signatory_name: 'Novi Eastiyanto', signatory_title: 'COO', verify_base: 'talent.20fit.id/cert' };
    },
    async updateAccountProfile(id, patch) {
      const { error } = await sb.from('talent_accounts').update(patch).eq('id', id);
      if (error) throw new Error(error.message);
    },
    // Talents who uploaded a HYROX certificate (for the staff verification queue).
    async listHyroxCerts() {
      const { data, error } = await sb.from('talent_accounts')
        .select('id,talent_type,name,login,city,instagram,hyrox_cert_path,hyrox_cert_status,hyrox_cert_verified_at,hyrox_cert_note')
        .not('hyrox_cert_path', 'is', null);
      if (error) throw new Error(error.message);
      return data || [];
    },
    async setTalentPassword(talentId, passwordHash) {
      const { error } = await sb.from('talent_accounts').update({ password_hash: passwordHash }).eq('id', talentId);
      if (error) throw new Error(error.message);
    },
    async createPasswordReset({ talent_id, token_hash, expires_at }) {
      const { error } = await sb.from('talent_password_resets').insert({ talent_id, token_hash, expires_at });
      if (error) throw new Error(error.message);
    },
    async getPasswordReset(tokenHash) {
      const { data } = await sb.from('talent_password_resets').select('id,talent_id,expires_at,used_at').eq('token_hash', tokenHash).maybeSingle();
      return data || null;
    },
    async markPasswordResetUsed(id) {
      const { error } = await sb.from('talent_password_resets').update({ used_at: new Date().toISOString() }).eq('id', id);
      if (error) throw new Error(error.message);
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
      const { data } = await sb.from('staff_accounts').select('id,role,name,login,password_hash,status,email_verified_at').eq('login', login).maybeSingle();
      return data || null;
    },
    async getStaffById(id) {
      const { data } = await sb.from('staff_accounts').select('id,role,name,login,status,email_verified_at').eq('id', id).maybeSingle();
      return data || null;
    },
    async listStaff(role) {
      let q = sb.from('staff_accounts').select('id,role,name,login,status,email_verified_at,created_at').order('created_at');
      if (role) q = q.eq('role', role);
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      return data || [];
    },
    // ---- EO profiles + staff password resets ----
    async getEoProfile(staffId) {
      const { data } = await sb.from('talent_eo_profiles').select('*').eq('staff_id', staffId).maybeSingle();
      return data || null;
    },
    async upsertEoProfile(staffId, patch) {
      const row = Object.assign({ staff_id: staffId, updated_at: new Date().toISOString() }, patch);
      const { error } = await sb.from('talent_eo_profiles').upsert(row, { onConflict: 'staff_id' });
      if (error) throw new Error(error.message);
    },
    async setStaffPassword(staffId, passwordHash) {
      const { error } = await sb.from('staff_accounts').update({ password_hash: passwordHash }).eq('id', staffId);
      if (error) throw new Error(error.message);
    },
    async createStaffPasswordReset({ staff_id, token_hash, expires_at }) {
      const { error } = await sb.from('staff_password_resets').insert({ staff_id, token_hash, expires_at });
      if (error) throw new Error(error.message);
    },
    async getStaffPasswordReset(tokenHash) {
      const { data } = await sb.from('staff_password_resets').select('id,staff_id,expires_at,used_at').eq('token_hash', tokenHash).maybeSingle();
      return data || null;
    },
    async markStaffPasswordResetUsed(id) {
      const { error } = await sb.from('staff_password_resets').update({ used_at: new Date().toISOString() }).eq('id', id);
      if (error) throw new Error(error.message);
    },
    // ---- staff email verification + account status ----
    async setStaffVerified(staffId) {
      const { error } = await sb.from('staff_accounts').update({ email_verified_at: new Date().toISOString(), status: 'active' }).eq('id', staffId);
      if (error) throw new Error(error.message);
    },
    async setStaffStatus(staffId, status) {
      const { error } = await sb.from('staff_accounts').update({ status }).eq('id', staffId);
      if (error) throw new Error(error.message);
    },
    async createStaffEmailVerification({ staff_id, token_hash, expires_at }) {
      const { error } = await sb.from('staff_email_verifications').insert({ staff_id, token_hash, expires_at });
      if (error) throw new Error(error.message);
    },
    async getStaffEmailVerification(tokenHash) {
      const { data } = await sb.from('staff_email_verifications').select('id,staff_id,expires_at,used_at').eq('token_hash', tokenHash).maybeSingle();
      return data || null;
    },
    async markStaffEmailVerificationUsed(id) {
      const { error } = await sb.from('staff_email_verifications').update({ used_at: new Date().toISOString() }).eq('id', id);
      if (error) throw new Error(error.message);
    },
    // ---- events / assignments / proofs ----
    async listTalents(talentType) {
      let q = sb.from('talent_accounts')
        .select('id,talent_type,name,full_name,login,phone,city,province,birthdate,gender,instagram,instagram_followers,experience,ktp,profile_completed_at,hyrox_cert_status,cv_path,portfolio_url,hyrox_cert_path')
        .order('name');
      if (talentType) q = q.eq('talent_type', talentType);
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      return data || [];
    },
    async createEvent({ name, description, description_en, location, starts_at, ends_at, created_by, needs, mp_sow, category, event_type_id, start_time, end_time, reg_deadline, reg_open, reg_open_time, reg_deadline_time, status }) {
      const { data, error } = await sb.from('talent_events')
        .insert({ name, description: description || null, description_en: description_en || null, location: location || null, starts_at: starts_at || null, ends_at: ends_at || null, created_by: created_by || null, mp_sow: mp_sow || null, category: category || null, event_type_id: event_type_id || null, start_time: start_time || null, end_time: end_time || null, reg_deadline: reg_deadline || null, reg_open: reg_open || null, reg_open_time: reg_open_time || null, reg_deadline_time: reg_deadline_time || null, status: status || 'published' })
        .select('id,name,is_active,created_at').maybeSingle();
      if (error) throw new Error(error.message);
      const list = (needs || []).filter((n) => n && n.talent_type)
        .map((n) => ({ event_id: data.id, talent_type: n.talent_type, headcount: n.headcount || 1 }));
      if (list.length) { const r = await sb.from('talent_event_needs').insert(list); if (r.error) throw new Error(r.error.message); }
      return data;
    },
    async updateEvent(id, patch) {
      patch = patch || {};
      const row = {};
      if (patch.name !== undefined) row.name = patch.name;
      if (patch.description !== undefined) row.description = patch.description || null;
      if (patch.description_en !== undefined) row.description_en = patch.description_en || null;
      if (patch.location !== undefined) row.location = patch.location || null;
      if (patch.starts_at !== undefined) row.starts_at = patch.starts_at || null;
      if (patch.ends_at !== undefined) row.ends_at = patch.ends_at || null;
      if (patch.mp_sow !== undefined) row.mp_sow = patch.mp_sow || null;
      if (patch.mockup_path !== undefined) row.mockup_path = patch.mockup_path || null;
      if (patch.category !== undefined) row.category = patch.category || null;
      if (patch.event_type_id !== undefined) row.event_type_id = patch.event_type_id || null;
      if (patch.start_time !== undefined) row.start_time = patch.start_time || null;
      if (patch.end_time !== undefined) row.end_time = patch.end_time || null;
      if (patch.reg_deadline !== undefined) row.reg_deadline = patch.reg_deadline || null;
      if (patch.reg_open !== undefined) row.reg_open = patch.reg_open || null;
      if (patch.reg_open_time !== undefined) row.reg_open_time = patch.reg_open_time || null;
      if (patch.reg_deadline_time !== undefined) row.reg_deadline_time = patch.reg_deadline_time || null;
      if (patch.status !== undefined) row.status = patch.status;
      if (patch.reg_closed_at !== undefined) row.reg_closed_at = patch.reg_closed_at;
      if (patch.group_url !== undefined) row.group_url = patch.group_url || null;
      if (Object.keys(row).length) { const r = await sb.from('talent_events').update(row).eq('id', id); if (r.error) throw new Error(r.error.message); }
      if (patch.needs) {
        await sb.from('talent_event_needs').delete().eq('event_id', id);
        const list = patch.needs.filter((n) => n && n.talent_type).map((n) => ({ event_id: id, talent_type: n.talent_type, headcount: n.headcount || 1 }));
        if (list.length) { const r = await sb.from('talent_event_needs').insert(list); if (r.error) throw new Error(r.error.message); }
      }
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
    // ---- master positions + per-event opened positions ----
    async listPositions() {
      const { data, error } = await sb.from('talent_positions').select('*').eq('is_active', true).order('sort');
      if (error) throw new Error(error.message);
      return data || [];
    },
    // Create a one-off master position for a custom ("Tambahan") event role, so it
    // can be applied to + counted like any role. Marked is_custom so it stays out
    // of the standard type filters / pickers.
    async createCustomPosition({ name, name_en, division }) {
      const key = 'custom_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      const row = { key, label_id: name, label_en: name_en || name, division: division || null, sort: 900, is_active: true, is_custom: true };
      const { data, error } = await sb.from('talent_positions').insert(row).select('id,key,label_id,label_en,division').maybeSingle();
      if (error) throw new Error(error.message);
      return data;
    },
    async listEventTypes() {
      const { data, error } = await sb.from('event_types').select('id,key,label_id,label_en,default_position_ids,sort').eq('is_active', true).order('sort');
      if (error) throw new Error(error.message);
      return data || [];
    },
    async getEventType(idOrKey) {
      if (!idOrKey) return null;
      const col = /^[0-9a-f-]{36}$/i.test(String(idOrKey)) ? 'id' : 'key';
      const { data } = await sb.from('event_types').select('id,key,label_id,label_en,sort').eq(col, idOrKey).maybeSingle();
      return data || null;
    },
    async listEventPositions(eventId) {
      const { data, error } = await sb.from('talent_event_positions')
        .select('id,quota,closed_at,division,sort_order,updated_at,is_optional,is_custom,jobdesk,requirement,fee,' + POS_DETAIL_COLS.join(',') + ',position_id,talent_positions(key,label_id,label_en,sort,division)').eq('event_id', eventId);
      if (error) throw new Error(error.message);
      return (data || []).map((r) => ({ id: r.id, position_id: r.position_id, quota: r.quota, closed_at: r.closed_at, division: r.division || (r.talent_positions && r.talent_positions.division) || null, sort_order: (r.sort_order != null ? r.sort_order : ((r.talent_positions && r.talent_positions.sort) || 0)), updated_at: r.updated_at || null, is_optional: !!r.is_optional, is_custom: !!r.is_custom, jobdesk: r.jobdesk || null, requirement: r.requirement || null, fee: r.fee || null, ...pickPosDetails(r), key: r.talent_positions && r.talent_positions.key, label_id: r.talent_positions && r.talent_positions.label_id, label_en: r.talent_positions && r.talent_positions.label_en, sort: (r.talent_positions && r.talent_positions.sort) || 0 }))
        .sort((a, b) => (a.sort_order - b.sort_order) || (a.sort - b.sort));
    },
    // Diff/upsert instead of delete+reinsert so row ids (and their quota logs)
    // survive an edit, updated_at is maintained, and quota changes flow through
    // the DB guard/log triggers. Callers guard against removing a role that has
    // applicants and against dropping quota below approved.
    async setEventPositions(eventId, positions) {
      const incoming = (positions || []).filter((p) => p && p.position_id && p.quota > 0);
      const ex = await sb.from('talent_event_positions').select('id,position_id,is_custom').eq('event_id', eventId);
      if (ex.error) throw new Error(ex.error.message);
      const exByPos = new Map((ex.data || []).map((r) => [String(r.position_id), r]));
      const keep = new Set();
      for (const p of incoming) {
        const cols = { quota: p.quota, division: p.division || null, sort_order: p.sort_order || 0, closed_at: null, updated_at: new Date().toISOString(), jobdesk: p.jobdesk || null, requirement: p.requirement || null, fee: p.fee || null, ...pickPosDetails(p) };
        const found = exByPos.get(String(p.position_id));
        if (found) {
          keep.add(String(p.position_id));
          const r = await sb.from('talent_event_positions').update(cols).eq('id', found.id);
          if (r.error) throw new Error(r.error.message);
        } else {
          const r = await sb.from('talent_event_positions').insert(Object.assign({ event_id: eventId, position_id: p.position_id }, cols));
          if (r.error) throw new Error(r.error.message);
        }
      }
      // Custom ("Tambahan") roles are managed on the detail page, not the form —
      // never drop them just because they aren't among the form's checkboxes.
      const toDelete = (ex.data || []).filter((r) => !r.is_custom && !keep.has(String(r.position_id)));
      for (const r of toDelete) { const d = await sb.from('talent_event_positions').delete().eq('id', r.id); if (d.error) throw new Error(d.error.message); }
    },
    // --- Role templates (per event type) --------------------------------------
    async listRoleTemplates(eventTypeId) {
      if (!eventTypeId) return [];
      const { data, error } = await sb.from('role_templates')
        .select('id,event_type_id,position_id,division,default_quota,sort_order,description,is_active,talent_positions(key,label_id,label_en,division,sort)')
        .eq('event_type_id', eventTypeId).order('sort_order');
      if (error) throw new Error(error.message);
      return (data || []).map(mapRoleTemplate);
    },
    async listAllRoleTemplates() {
      const { data, error } = await sb.from('role_templates')
        .select('id,event_type_id,position_id,division,default_quota,sort_order,description,is_active,talent_positions(key,label_id,label_en,division,sort)')
        .order('event_type_id').order('sort_order');
      if (error) throw new Error(error.message);
      return (data || []).map(mapRoleTemplate);
    },
    async createRoleTemplate({ event_type_id, position_id, division, default_quota, sort_order, description }) {
      const { data, error } = await sb.from('role_templates')
        .insert({ event_type_id, position_id, division: division || null, default_quota: default_quota != null ? default_quota : 1, sort_order: sort_order || 0, description: description || null })
        .select('id').maybeSingle();
      if (error) { if (/duplicate|unique/i.test(error.message)) { const e = new Error('DUP'); e.code = 'DUP'; throw e; } throw new Error(error.message); }
      return data;
    },
    async updateRoleTemplate(id, patch) {
      const row = { updated_at: new Date().toISOString() };
      if (patch.division !== undefined) row.division = patch.division || null;
      if (patch.default_quota !== undefined) row.default_quota = patch.default_quota;
      if (patch.sort_order !== undefined) row.sort_order = patch.sort_order;
      if (patch.description !== undefined) row.description = patch.description || null;
      if (patch.is_active !== undefined) row.is_active = !!patch.is_active;
      const { error } = await sb.from('role_templates').update(row).eq('id', id);
      if (error) throw new Error(error.message);
    },
    // Copy an event type's active template roles onto a freshly created event.
    async snapshotTemplateToEvent(eventId, eventTypeId) {
      if (!eventTypeId) return 0;
      const { data, error } = await sb.from('role_templates')
        .select('position_id,division,default_quota,sort_order').eq('event_type_id', eventTypeId).eq('is_active', true).order('sort_order');
      if (error) throw new Error(error.message);
      const rows = (data || []).map((t) => ({ event_id: eventId, position_id: t.position_id, quota: t.default_quota, division: t.division || null, sort_order: t.sort_order || 0 }));
      if (!rows.length) return 0;
      const r = await sb.from('talent_event_positions').upsert(rows, { onConflict: 'event_id,position_id', ignoreDuplicates: true });
      if (r.error) throw new Error(r.error.message);
      return rows.length;
    },
    // --- Per-event role quota (race-safe RPCs) --------------------------------
    async setEventRoleQuota(eventRoleId, newQuota, changedBy) {
      const { data, error } = await sb.rpc('set_event_role_quota', { p_event_role_id: eventRoleId, p_new_quota: newQuota, p_changed_by: changedBy || null });
      if (error) { const e = new Error(error.message || 'RPC_ERROR'); e.code = error.code || 'RPC'; throw e; }
      return data;
    },
    async approveApplicationChoice(applicationId, positionId, reviewerId, actorName) {
      const { data, error } = await sb.rpc('approve_application_choice', { p_application_id: applicationId, p_position_id: positionId, p_reviewer_id: reviewerId || null, p_actor_name: actorName || null });
      if (error) throw new Error(error.message);
      return data; // 'ok' | 'full' | 'skip' | 'not_found'
    },
    async listEventRoleQuotaLogs(eventRoleId) {
      const { data, error } = await sb.from('event_role_quota_logs')
        .select('id,event_role_id,old_quota,new_quota,changed_by,changed_at').eq('event_role_id', eventRoleId).order('changed_at', { ascending: false });
      if (error) throw new Error(error.message);
      return data || [];
    },
    async addEventRole(eventId, { position_id, division, quota, sort_order, is_optional, is_custom, description }) {
      const row = { event_id: eventId, position_id, division: division || null, quota: Number.isFinite(quota) ? quota : 0, sort_order: sort_order || 0, is_optional: !!is_optional, is_custom: !!is_custom, description: description || null, closed_at: null, updated_at: new Date().toISOString() };
      const { data, error } = await sb.from('talent_event_positions').upsert(row, { onConflict: 'event_id,position_id' }).select('id').maybeSingle();
      if (error) throw new Error(error.message);
      return data;
    },
    async closeEventRole(eventRoleId, closed) {
      const patch = closed ? { closed_at: new Date().toISOString(), updated_at: new Date().toISOString() } : { closed_at: null, updated_at: new Date().toISOString() };
      const { error } = await sb.from('talent_event_positions').update(patch).eq('id', eventRoleId);
      if (error) throw new Error(error.message);
    },
    // Delete an event role outright (used for an optional/custom role with no
    // applicants; the caller enforces the no-applicants guard).
    async deleteEventRole(eventRoleId) {
      const { error } = await sb.from('talent_event_positions').delete().eq('id', eventRoleId);
      if (error) throw new Error(error.message);
    },
    async listApplicationChoices() {
      const { data, error } = await sb.from('talent_application_choices').select('id,application_id,position_id,priority,accepted');
      if (error) throw new Error(error.message);
      return data || [];
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
    async completeEvent(id, completed) {
      const patch = completed ? { completed_at: new Date().toISOString() } : { completed_at: null };
      const { error } = await sb.from('talent_events').update(patch).eq('id', id);
      if (error) throw new Error(error.message);
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
    async listAssignmentsForTalent(talentId) {
      const { data, error } = await sb.from('talent_event_assignments').select('*').eq('talent_id', talentId).order('assigned_at', { ascending: false });
      if (error) throw new Error(error.message);
      return data || [];
    },
    // ---- Main Power event applications ----
    async createApplication({ event_id, talent_id, talent_type, role, answers }) {
      const { data, error } = await sb.from('talent_applications')
        .insert({ event_id, talent_id, talent_type: talent_type || 'main_power', role, answers: answers || null })
        .select('id').maybeSingle();
      if (error) {
        if (/duplicate|unique/i.test(error.message)) { const e = new Error('DUP'); e.code = 'DUP'; throw e; }
        throw new Error(error.message);
      }
      return data;
    },
    async listApplications() {
      const { data, error } = await sb.from('talent_applications').select('*').order('created_at', { ascending: false });
      if (error) throw new Error(error.message);
      return data || [];
    },
    async listApplicationsForTalent(talentId) {
      const { data, error } = await sb.from('talent_applications').select('*').eq('talent_id', talentId).order('created_at', { ascending: false });
      if (error) throw new Error(error.message);
      return data || [];
    },
    async getApplication(id) {
      const { data } = await sb.from('talent_applications').select('*').eq('id', id).maybeSingle();
      return data || null;
    },
    async updateApplication(id, patch) {
      const { error } = await sb.from('talent_applications').update(patch).eq('id', id);
      if (error) throw new Error(error.message);
    },
    async getApplicationForEvent(talentId, eventId) {
      const { data } = await sb.from('talent_applications').select('*').eq('talent_id', talentId).eq('event_id', eventId).maybeSingle();
      return data || null;
    },
    async addApplicationChoices(applicationId, choices) {
      const rows = (choices || []).map((c) => ({ application_id: applicationId, position_id: c.position_id, priority: c.priority }));
      if (rows.length) {
        const r = await sb.from('talent_application_choices').insert(rows);
        if (r.error) {
          // A double-click / concurrent submit can race two choices to the same
          // (application_id, priority) or (application_id, position_id); the DB
          // rejects the duplicate. Surface it as a catchable DUP so the caller
          // can treat it as an already-saved no-op instead of a 500.
          if (/duplicate|unique/i.test(r.error.message)) { const e = new Error('DUP'); e.code = 'DUP'; throw e; }
          throw new Error(r.error.message);
        }
      }
    },
    async replaceApplicationChoices(applicationId, choices) {
      await sb.from('talent_application_choices').delete().eq('application_id', applicationId);
      await this.addApplicationChoices(applicationId, choices);
    },
    async listChoicesForApplication(applicationId) {
      const { data } = await sb.from('talent_application_choices').select('id,position_id,priority,accepted').eq('application_id', applicationId).order('priority');
      return data || [];
    },
    // Mark exactly one of an application's choices as accepted (clears the rest
    // first so the "one accepted per application" unique index never trips).
    async acceptApplicationChoice(applicationId, positionId) {
      await sb.from('talent_application_choices').update({ accepted: false }).eq('application_id', applicationId);
      const { error } = await sb.from('talent_application_choices').update({ accepted: true }).eq('application_id', applicationId).eq('position_id', positionId);
      if (error) throw new Error(error.message);
    },
    async clearApplicationAccepted(applicationId) {
      const { error } = await sb.from('talent_application_choices').update({ accepted: false }).eq('application_id', applicationId);
      if (error) throw new Error(error.message);
    },
    // --- Two-layer selection: reviewer proposals (LAPIS 1) --------------------
    // A proposal is a recommendation only — it never changes the application's
    // status and never emails the talent. Recorded per (application, position,
    // reviewer_name) so multiple reviewers can propose the same applicant, one
    // reviewer can propose several positions, and re-proposing just updates the note.
    async listProposals() {
      const { data, error } = await sb.from('talent_application_proposals')
        .select('id,application_id,position_id,reviewer_name,note,created_at').order('created_at');
      if (error) throw new Error(error.message);
      return data || [];
    },
    async listProposalsForApplication(applicationId) {
      const { data, error } = await sb.from('talent_application_proposals')
        .select('id,application_id,position_id,reviewer_name,note,created_at').eq('application_id', applicationId).order('created_at');
      if (error) throw new Error(error.message);
      return data || [];
    },
    async addProposal(applicationId, positionId, reviewerName, note) {
      const { error } = await sb.from('talent_application_proposals')
        .upsert({ application_id: applicationId, position_id: positionId, reviewer_name: reviewerName, note: note || null },
          { onConflict: 'application_id,position_id,reviewer_name' });
      if (error) throw new Error(error.message);
    },
    async removeProposal(applicationId, positionId, reviewerName) {
      const { error } = await sb.from('talent_application_proposals').delete()
        .eq('application_id', applicationId).eq('position_id', positionId).eq('reviewer_name', reviewerName);
      if (error) throw new Error(error.message);
    },
    // "Reviewed but not proposed" optional marks, per (application, reviewer_name).
    async listReviewMarks() {
      const { data, error } = await sb.from('talent_application_reviews')
        .select('id,application_id,reviewer_name,created_at').order('created_at');
      if (error) throw new Error(error.message);
      return data || [];
    },
    async addReviewMark(applicationId, reviewerName) {
      const { error } = await sb.from('talent_application_reviews')
        .upsert({ application_id: applicationId, reviewer_name: reviewerName }, { onConflict: 'application_id,reviewer_name' });
      if (error) throw new Error(error.message);
    },
    async removeReviewMark(applicationId, reviewerName) {
      const { error } = await sb.from('talent_application_reviews').delete()
        .eq('application_id', applicationId).eq('reviewer_name', reviewerName);
      if (error) throw new Error(error.message);
    },
    // Append-only status history (LAPIS 2 final decisions). actor_name captures
    // the meeting operator's typed name (all reviewers share one login).
    async addStatusLog(applicationId, fromStatus, toStatus, changedBy, actorName) {
      const { error } = await sb.from('talent_application_status_log').insert({
        application_id: applicationId, from_status: fromStatus || null, to_status: toStatus,
        changed_by: changedBy || null, actor_name: actorName || null, changed_at: new Date().toISOString(),
      });
      if (error) throw new Error(error.message);
    },
    async listStatusLogForApplication(applicationId) {
      const { data, error } = await sb.from('talent_application_status_log')
        .select('id,application_id,from_status,to_status,changed_by,actor_name,changed_at').eq('application_id', applicationId).order('changed_at');
      if (error) throw new Error(error.message);
      return data || [];
    },
    async listStatusLogs() {
      const { data, error } = await sb.from('talent_application_status_log')
        .select('id,application_id,from_status,to_status,changed_by,actor_name,changed_at').order('changed_at');
      if (error) throw new Error(error.message);
      return data || [];
    },
    async deleteApplication(id) {
      // No FK cascade on talent_application_choices, so remove choices first to
      // avoid leaving orphaned rows behind.
      await sb.from('talent_application_choices').delete().eq('application_id', id);
      const { error } = await sb.from('talent_applications').delete().eq('id', id);
      if (error) throw new Error(error.message);
    },
    async createCertificate(row) {
      const { data, error } = await sb.from('talent_certificates').insert(row).select('id,cert_no').maybeSingle();
      if (error) {
        if (/duplicate|unique/i.test(error.message)) { const e = new Error('DUP'); e.code = 'DUP'; throw e; }
        throw new Error(error.message);
      }
      return data;
    },
    async getCertificate(id) {
      const { data } = await sb.from('talent_certificates').select('*').eq('id', id).maybeSingle();
      return data || null;
    },
    async getCertificateByNo(certNo) {
      const { data } = await sb.from('talent_certificates').select('*').eq('cert_no', certNo).maybeSingle();
      return data || null;
    },
    async listCertificatesForTalent(talentId) {
      const { data, error } = await sb.from('talent_certificates').select('*').eq('talent_id', talentId).is('revoked_at', null).order('issued_at', { ascending: false });
      if (error) throw new Error(error.message);
      return data || [];
    },
    async listCertificates() {
      const { data, error } = await sb.from('talent_certificates').select('*').order('issued_at', { ascending: false });
      if (error) throw new Error(error.message);
      return data || [];
    },
    async revokeCertificate(id, revoked) {
      const { error } = await sb.from('talent_certificates').update({ revoked_at: revoked ? new Date().toISOString() : null }).eq('id', id);
      if (error) throw new Error(error.message);
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
    async deleteProof(id) {
      const { data } = await sb.from('talent_post_proofs').select('screenshot_path').eq('id', id).maybeSingle();
      if (data && data.screenshot_path) { try { await sb.storage.from(BUCKET).remove([data.screenshot_path]); } catch (_) { /* best-effort */ } }
      const { error } = await sb.from('talent_post_proofs').delete().eq('id', id);
      if (error) throw new Error(error.message);
    },
    async deleteEvent(id) {
      await sb.from('talent_event_needs').delete().eq('event_id', id);
      await sb.from('talent_event_assignments').delete().eq('event_id', id);
      await sb.from('talent_applications').delete().eq('event_id', id);
      const { error } = await sb.from('talent_events').delete().eq('id', id);
      if (error) throw new Error(error.message);
    },
    async deleteStaff(id) {
      const { error } = await sb.from('staff_accounts').delete().eq('id', id);
      if (error) throw new Error(error.message);
    },
    async getSettings() {
      const { data } = await sb.from('talent_settings').select(SETTING_KEYS.join(',')).eq('id', 1).maybeSingle();
      return { ...DEFAULT_SETTINGS, ...(data || {}) };
    },
    async updateSettings(patch) {
      const upd = { updated_at: new Date().toISOString() };
      for (const k of SETTING_KEYS) if (Number.isFinite(patch[k])) upd[k] = patch[k];
      const { error } = await sb.from('talent_settings').update(upd).eq('id', 1);
      if (error) throw new Error(error.message);
    },
  };
}

function memoryStore() {
  const now = () => new Date().toISOString();
  // Project a stored account to the public shape (mirrors the Supabase select).
  const accountProfile = (a) => ({
    id: a.id, talent_type: a.talent_type, name: a.name, full_name: a.full_name || null, login: a.login, created_at: a.created_at || null,
    phone: a.phone || null, city: a.city || null, province: a.province || null, birthdate: a.birthdate || null,
    gender: a.gender || null, instagram: a.instagram || null,
    instagram_followers: a.instagram_followers != null ? a.instagram_followers : null,
    experience: a.experience || null, ktp: a.ktp || null, profile_completed_at: a.profile_completed_at || null,
    cv_path: a.cv_path || null, portfolio_url: a.portfolio_url || null,
    hyrox_cert_path: a.hyrox_cert_path || null, hyrox_cert_status: a.hyrox_cert_status || 'none',
    hyrox_cert_verified_by: a.hyrox_cert_verified_by || null, hyrox_cert_verified_at: a.hyrox_cert_verified_at || null,
    hyrox_cert_note: a.hyrox_cert_note || null,
  });
  const campaigns = [
    { id: 'camp-jakarta', name: 'Jakarta Run Series 2026', is_active: true, created_at: now() },
    { id: 'camp-bali', name: 'Bali Trail Marathon 2026', is_active: true, created_at: now() },
  ];
  const submissions = [];
  const landingBgs = {};
  const hashPassword = require('./auth').hashPassword;
  const accounts = [
    { id: 'mp-budi', talent_type: 'main_power', name: 'Budi Santoso', login: 'budi@example.com', password_hash: hashPassword('Main_12345'), created_at: now(), phone: '081234567890', city: 'Jakarta', birthdate: '1996-05-20', gender: 'male', instagram: 'budi.santoso', instagram_followers: 3200, experience: 'Marshal Jakarta Marathon 2024, 2025.', profile_completed_at: now() },
  ];
  const images = new Map();
  const staff = [{
    id: 'staff-super', role: 'super_admin', name: 'Super Admin', login: 'admin1@gmail.com',
    password_hash: hashPassword('Admin_12345'), created_at: now(), status: 'active', email_verified_at: now(),
  }, {
    id: 'staff-eo', role: 'eo', name: 'Demo EO', login: 'eo1@gmail.com',
    password_hash: hashPassword('Eo_12345'), created_at: now(), status: 'active', email_verified_at: now(),
  }];
  const eoProfiles = [];
  const staffResets = [];
  const staffVerifications = [];
  const dOff = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
  const events = [
    { id: 'ev-jakarta', name: 'Jakarta Run Series 2026', description: null, location: 'Gelora Bung Karno, Jakarta', starts_at: dOff(-5), ends_at: dOff(2), is_active: true, status: 'published', created_by: null, created_at: now(), mp_sow: 'Judges menilai peserta di station sesuai peraturan lomba. Briefing H-1 pukul 17.00, hari-H 05.00–14.00. Honorarium Rp750.000 + konsumsi + kaos event + sertifikat.' },
    { id: 'ev-bali', name: 'Bali Trail Marathon 2026', description: null, location: 'Ubud, Bali', starts_at: dOff(14), ends_at: dOff(24), is_active: true, status: 'published', created_by: null, created_at: now(), mp_sow: null },
    { id: 'ev-sby', name: 'Surabaya Half Marathon 2026', description: null, location: 'Taman Bungkul, Surabaya', starts_at: dOff(20), ends_at: dOff(20), is_active: true, status: 'published', created_by: null, created_at: now(), mp_sow: null },
  ];
  const eventNeeds = [
    { event_id: 'ev-jakarta', talent_type: 'kol', headcount: 2 },
    { event_id: 'ev-jakarta', talent_type: 'fotografer', headcount: 2 },
    { event_id: 'ev-jakarta', talent_type: 'main_power', headcount: 12 },
    { event_id: 'ev-bali', talent_type: 'kol', headcount: 1 },
    { event_id: 'ev-bali', talent_type: 'main_power', headcount: 8 },
  ];
  const assignments = [];
  const positions = [
    ['judge_hybrid', 'Judges Hybrid Race', 'Judges Hybrid Race', 11], ['judge_running', 'Judges Running', 'Judges Running', 12],
    ['runner', 'Runner', 'Runner', 20], ['kol', 'KOL', 'KOL', 30],
    ['registration_staff', 'Registration Staff', 'Registration Staff', 40], ['water_station', 'Water Station', 'Water Station', 50],
    ['time_chip_management', 'Time Chip Management', 'Time Chip Management', 60], ['fotografer', 'Fotografer', 'Photographer', 70],
    ['videografer', 'Videografer', 'Videographer', 80], ['marshal', 'Marshal', 'Marshal', 90], ['drop_bag', 'Drop Bag', 'Drop Bag', 100],
    // Granular Running roles (mirror of the SQL seed), grouped by division.
    ['run_marshall_static', 'Marshall Statis', 'Static Marshall', 300, 'Marshall'],
    ['run_mobile_marshall', 'Mobile Marshall', 'Mobile Marshall', 301, 'Marshall'],
    ['run_mobile_marshall_pw', 'Mobile Marshall Potential Winner', 'Mobile Marshall (Pot. Winner)', 302, 'Marshall'],
    ['run_crew_start_finish', 'Crew Start Finish', 'Start/Finish Crew', 310, 'Start/Finish'],
    ['run_crew_floor_runners_line', 'Crew Floor - Runners Line', 'Floor Crew - Runners Line', 311, 'Start/Finish'],
    ['run_crew_water_station', 'Crew Water Station', 'Water Station Crew', 320, 'Water Station'],
    ['run_deploy_water_station', 'Tim Deploy Water Station', 'Water Station Deploy Team', 321, 'Water Station'],
    ['run_crew_refreshment', 'Crew Refreshment', 'Refreshment Crew', 330, 'Refreshment'],
    ['run_deploy_refreshment', 'Tim Deploy Refreshment', 'Refreshment Deploy Team', 331, 'Refreshment'],
    ['run_crew_drop_bag', 'Crew Drop Bag', 'Drop Bag Crew', 340, 'Drop Bag'],
    ['run_information_crew', 'Information Crew', 'Information Crew', 350, 'Information'],
    ['other', 'Lainnya', 'Other', 200],
  ].map(([key, label_id, label_en, sort, division]) => ({ id: 'pos-' + key, key, label_id, label_en, sort, division: division || null, is_active: true, is_custom: false }));
  // Managed event types (HYROX + Lari active); each auto-fills its default positions in the form.
  // 'other' (Lainnya) is the custom slot — never part of a type's default set.
  const ALL_POS_IDS = positions.filter((p) => p.key !== 'other').map((p) => p.id);
  const eventTypes = [
    { id: 'et-lari', key: 'lari', label_id: 'Lari', label_en: 'Running', sort: 10, is_active: true, default_position_ids: ALL_POS_IDS.slice() },
    { id: 'et-hyrox', key: 'hyrox', label_id: 'HYROX', label_en: 'HYROX', sort: 20, is_active: true, default_position_ids: [] },
  ];
  // Running role template (mirror of the SQL seed): [position key, division, default quota, sort].
  const roleTemplates = [
    ['run_marshall_static', 'Marshall', 20, 300], ['run_mobile_marshall', 'Marshall', 10, 301],
    ['run_mobile_marshall_pw', 'Marshall', 4, 302], ['run_crew_start_finish', 'Start/Finish', 10, 310],
    ['run_crew_floor_runners_line', 'Start/Finish', 8, 311], ['run_crew_water_station', 'Water Station', 10, 320],
    ['run_deploy_water_station', 'Water Station', 5, 321], ['run_crew_refreshment', 'Refreshment', 10, 330],
    ['run_deploy_refreshment', 'Refreshment', 15, 331], ['run_crew_drop_bag', 'Drop Bag', 4, 340],
    ['run_information_crew', 'Information', 2, 350],
  ].map(([key, division, default_quota, sort_order]) => ({ id: 'rt-' + key, event_type_id: 'et-lari', position_id: 'pos-' + key, division, default_quota, sort_order, description: null, is_active: true }));
  const quotaLogs = []; // { id, event_role_id, old_quota, new_quota, changed_by, changed_at }
  const eventPositions = [
    { id: 'ep-j-kol', event_id: 'ev-jakarta', position_id: 'pos-kol', quota: 2, closed_at: null, jobdesk: 'Buat 3 konten (reels/story) selama event & tag akun 20FIT. Hadir di lokasi hari-H.', requirement: 'Followers IG 5.000+, engagement bagus, terbiasa bikin konten olahraga.', fee: 'Rp750.000 + merchandise event' },
    { id: 'ep-j-foto', event_id: 'ev-jakarta', position_id: 'pos-fotografer', quota: 2, closed_at: null, jobdesk: 'Dokumentasi foto di area start/finish & sepanjang rute. Deliver min. 150 foto terkurasi H+2.', requirement: 'Punya kamera mirrorless/DSLR sendiri, pengalaman foto event olahraga.', fee: 'Rp600.000/hari' },
    { id: 'ep-b-runner', event_id: 'ev-bali', position_id: 'pos-runner', quota: 8, closed_at: null, jobdesk: 'Sweeper/pacer di rute trail memastikan keselamatan peserta.', requirement: 'Rutin lari trail, mampu 21K.', fee: 'Rp500.000/hari' },
    { id: 'ep-s-kol', event_id: 'ev-sby', position_id: 'pos-kol', quota: 3, closed_at: null, jobdesk: 'Liputan & konten media sosial lomba, tag akun 20FIT.', requirement: 'Followers IG 5.000+, aktif bikin konten.', fee: 'Rp700.000 + merchandise' },
    { id: 'ep-s-foto', event_id: 'ev-sby', position_id: 'pos-fotografer', quota: 2, closed_at: null, jobdesk: 'Dokumentasi foto peserta & suasana event.', requirement: 'Punya kamera mirrorless/DSLR.', fee: 'Rp600.000/hari' },
    { id: 'ep-s-marshal', event_id: 'ev-sby', position_id: 'pos-marshal', quota: 6, closed_at: null, jobdesk: 'Pengarah & pengaman rute lari.', requirement: 'Fisik prima, sigap.', fee: 'Rp500.000/hari' },
  ];
  const applicationChoices = [];
  const proposals = []; // LAPIS 1 reviewer proposals: { application_id, position_id, reviewer_name, note, created_at }
  const reviewMarks = []; // "reviewed, not proposed" marks: { application_id, reviewer_name, created_at }
  const statusLogs = []; // status transitions: { id, application_id, from_status, to_status, changed_by, actor_name, changed_at }
  const applications = [
    { id: 'app-budi', event_id: 'ev-jakarta', talent_id: 'mp-budi', talent_type: 'main_power', role: 'Judges', answers: { q1: 'Ya', q2: 'Ya', q3: 'Jakarta Marathon 2024 (finish line)', q4: 'Ya' }, status: 'pending', station: null, station_loc: null, note: null, reviewed_by: null, reviewed_at: null, created_at: now() },
  ];
  const passwordResets = [];
  const certificates = [];
  const proofs = [];
  const settings = { ...DEFAULT_SETTINGS };
  let seq = 0;

  return {
    mode: 'memory',
    async listActiveCampaigns() { return campaigns.filter((c) => c.is_active).map((c) => ({ id: c.id, name: c.name })); },
    async getActiveCampaign(id) { const c = campaigns.find((c) => c.id === id && c.is_active); return c ? { id: c.id, name: c.name } : null; },
    async listCampaigns() { return campaigns.map((c) => ({ ...c })); },
    async createCampaign(name) { campaigns.push({ id: 'camp-' + (++seq), name, is_active: true, created_at: now() }); },
    async toggleCampaign(id) { const c = campaigns.find((c) => c.id === id); if (c) c.is_active = !c.is_active; },
    async uploadImage(path, buffer, contentType) { images.set(path, { buffer, contentType }); },
    async removeImage(paths) { (Array.isArray(paths) ? paths : [paths]).filter(Boolean).forEach((p) => images.delete(p)); },
    async signImageUrls(paths) { return (paths || []).map((p) => '/__mockimg/' + encodeURIComponent(p)); },
    async putLandingBg(slot, buffer, contentType) { landingBgs[slot] = 'data:' + (contentType || 'image/jpeg') + ';base64,' + buffer.toString('base64'); },
    async landingBgUrls() { return [landingBgs[1] || null, landingBgs[2] || null]; },
    async signCovers(paths) { return (paths || []).map((p) => (p && images.has(p)) ? '/__mockimg/' + encodeURIComponent(p) : null); },
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
    async findAccountByLogin(login) { return accounts.find((a) => a.login === login) || null; },
    async getAccountById(id) { const a = accounts.find((a) => a.id === id); return a ? accountProfile(a) : null; },
    async updateAccountProfile(id, patch) { const a = accounts.find((a) => a.id === id); if (a) Object.assign(a, patch); },
    async setTalentPassword(talentId, passwordHash) { const a = accounts.find((a) => a.id === talentId); if (a) a.password_hash = passwordHash; },
    async createPasswordReset({ talent_id, token_hash, expires_at }) { passwordResets.push({ id: 'pr-' + (++seq), talent_id, token_hash, expires_at, used_at: null, created_at: now() }); },
    async getPasswordReset(tokenHash) { const r = passwordResets.find((r) => r.token_hash === tokenHash); return r ? { id: r.id, talent_id: r.talent_id, expires_at: r.expires_at, used_at: r.used_at } : null; },
    async markPasswordResetUsed(id) { const r = passwordResets.find((r) => r.id === id); if (r) r.used_at = now(); },
    async createStaff(acc) {
      if (staff.find((s) => s.login === acc.login)) { const e = new Error('DUP'); e.code = 'DUP'; throw e; }
      const rec = { id: 'staff-' + (++seq), status: 'active', email_verified_at: null, ...acc, created_at: now() };
      staff.push(rec);
      return { id: rec.id, role: rec.role, name: rec.name, login: rec.login };
    },
    async findStaff(login) { return staff.find((s) => s.login === login) || null; },
    async getStaffById(id) { const s = staff.find((s) => s.id === id); return s ? { id: s.id, role: s.role, name: s.name, login: s.login, status: s.status, email_verified_at: s.email_verified_at } : null; },
    async listStaff(role) { return staff.filter((s) => !role || s.role === role).map((s) => ({ id: s.id, role: s.role, name: s.name, login: s.login, status: s.status, email_verified_at: s.email_verified_at, created_at: s.created_at })); },
    async setStaffVerified(staffId) { const s = staff.find((s) => s.id === staffId); if (s) { s.email_verified_at = now(); s.status = 'active'; } },
    async setStaffStatus(staffId, status) { const s = staff.find((s) => s.id === staffId); if (s) s.status = status; },
    async createStaffEmailVerification({ staff_id, token_hash, expires_at }) { staffVerifications.push({ id: 'sev-' + (++seq), staff_id, token_hash, expires_at, used_at: null, created_at: now() }); },
    async getStaffEmailVerification(tokenHash) { const r = staffVerifications.find((r) => r.token_hash === tokenHash); return r ? { id: r.id, staff_id: r.staff_id, expires_at: r.expires_at, used_at: r.used_at } : null; },
    async markStaffEmailVerificationUsed(id) { const r = staffVerifications.find((r) => r.id === id); if (r) r.used_at = now(); },
    async getEoProfile(staffId) { const p = eoProfiles.find((x) => x.staff_id === staffId); return p ? { ...p } : null; },
    async upsertEoProfile(staffId, patch) { let p = eoProfiles.find((x) => x.staff_id === staffId); if (!p) { p = { id: 'eop-' + (++seq), staff_id: staffId, created_at: now() }; eoProfiles.push(p); } Object.assign(p, patch, { updated_at: now() }); },
    async setStaffPassword(staffId, passwordHash) { const s = staff.find((s) => s.id === staffId); if (s) s.password_hash = passwordHash; },
    async createStaffPasswordReset({ staff_id, token_hash, expires_at }) { staffResets.push({ id: 'spr-' + (++seq), staff_id, token_hash, expires_at, used_at: null, created_at: now() }); },
    async getStaffPasswordReset(tokenHash) { const r = staffResets.find((r) => r.token_hash === tokenHash); return r ? { id: r.id, staff_id: r.staff_id, expires_at: r.expires_at, used_at: r.used_at } : null; },
    async markStaffPasswordResetUsed(id) { const r = staffResets.find((r) => r.id === id); if (r) r.used_at = now(); },
    async listTalents(talentType) { return accounts.filter((a) => !talentType || a.talent_type === talentType).map(accountProfile); },
    async listHyroxCerts() { return accounts.filter((a) => a.hyrox_cert_path).map(accountProfile); },
    async createEvent({ name, description, description_en, location, starts_at, ends_at, created_by, needs, mp_sow, category, event_type_id, start_time, end_time, reg_deadline, reg_open, reg_open_time, reg_deadline_time, status }) {
      const ev = { id: 'ev-' + (++seq), name, description: description || null, description_en: description_en || null, location: location || null, starts_at: starts_at || null, ends_at: ends_at || null, is_active: true, created_by: created_by || null, created_at: now(), mp_sow: mp_sow || null, category: category || null, event_type_id: event_type_id || null, start_time: start_time || null, end_time: end_time || null, reg_deadline: reg_deadline || null, reg_open: reg_open || null, reg_open_time: reg_open_time || null, reg_deadline_time: reg_deadline_time || null, status: status || 'published', reg_closed_at: null, group_url: null };
      events.unshift(ev);
      (needs || []).filter((n) => n && n.talent_type).forEach((n) => eventNeeds.push({ event_id: ev.id, talent_type: n.talent_type, headcount: n.headcount || 1 }));
      return { id: ev.id, name: ev.name, is_active: ev.is_active, created_at: ev.created_at };
    },
    async updateEvent(id, patch) {
      patch = patch || {};
      const ev = events.find((e) => e.id === id);
      if (!ev) return;
      if (patch.name !== undefined) ev.name = patch.name;
      if (patch.description !== undefined) ev.description = patch.description || null;
      if (patch.description_en !== undefined) ev.description_en = patch.description_en || null;
      if (patch.location !== undefined) ev.location = patch.location || null;
      if (patch.starts_at !== undefined) ev.starts_at = patch.starts_at || null;
      if (patch.ends_at !== undefined) ev.ends_at = patch.ends_at || null;
      if (patch.mp_sow !== undefined) ev.mp_sow = patch.mp_sow || null;
      if (patch.mockup_path !== undefined) ev.mockup_path = patch.mockup_path || null;
      if (patch.category !== undefined) ev.category = patch.category || null;
      if (patch.event_type_id !== undefined) ev.event_type_id = patch.event_type_id || null;
      if (patch.start_time !== undefined) ev.start_time = patch.start_time || null;
      if (patch.end_time !== undefined) ev.end_time = patch.end_time || null;
      if (patch.reg_deadline !== undefined) ev.reg_deadline = patch.reg_deadline || null;
      if (patch.reg_open !== undefined) ev.reg_open = patch.reg_open || null;
      if (patch.reg_open_time !== undefined) ev.reg_open_time = patch.reg_open_time || null;
      if (patch.reg_deadline_time !== undefined) ev.reg_deadline_time = patch.reg_deadline_time || null;
      if (patch.status !== undefined) ev.status = patch.status;
      if (patch.reg_closed_at !== undefined) ev.reg_closed_at = patch.reg_closed_at;
      if (patch.group_url !== undefined) ev.group_url = patch.group_url || null;
      if (patch.needs) {
        for (let j = eventNeeds.length - 1; j >= 0; j--) if (eventNeeds[j].event_id === id) eventNeeds.splice(j, 1);
        patch.needs.filter((n) => n && n.talent_type).forEach((n) => eventNeeds.push({ event_id: id, talent_type: n.talent_type, headcount: n.headcount || 1 }));
      }
    },
    async listPositions() { return positions.filter((p) => p.is_active).slice().sort((a, b) => a.sort - b.sort).map((p) => ({ ...p })); },
    async createCustomPosition({ name, name_en, division }) {
      const rec = { id: 'pos-custom-' + (++seq), key: 'custom_' + seq, label_id: name, label_en: name_en || name, division: division || null, sort: 900, is_active: true, is_custom: true };
      positions.push(rec);
      return { id: rec.id, key: rec.key, label_id: rec.label_id, label_en: rec.label_en, division: rec.division };
    },
    async listEventTypes() { return eventTypes.filter((t) => t.is_active).slice().sort((a, b) => a.sort - b.sort).map((t) => ({ ...t, default_position_ids: (t.default_position_ids || []).slice() })); },
    async getEventType(idOrKey) { const t = eventTypes.find((x) => x.id === idOrKey || x.key === idOrKey); return t ? { ...t } : null; },
    async listEventPositions(eventId) {
      return eventPositions.filter((ep) => ep.event_id === eventId).map((ep) => { const m = positions.find((p) => p.id === ep.position_id) || {}; return { id: ep.id, position_id: ep.position_id, quota: ep.quota, closed_at: ep.closed_at || null, division: ep.division || m.division || null, sort_order: (ep.sort_order != null ? ep.sort_order : (m.sort || 0)), updated_at: ep.updated_at || null, is_optional: !!ep.is_optional, is_custom: !!ep.is_custom, jobdesk: ep.jobdesk || null, requirement: ep.requirement || null, fee: ep.fee || null, ...pickPosDetails(ep), key: m.key, label_id: m.label_id, label_en: m.label_en, sort: m.sort || 0 }; }).sort((a, b) => (a.sort_order - b.sort_order) || (a.sort - b.sort));
    },
    async setEventPositions(eventId, poss) {
      const incoming = (poss || []).filter((p) => p && p.position_id && p.quota > 0);
      const keep = new Set();
      incoming.forEach((p) => {
        keep.add(String(p.position_id));
        const found = eventPositions.find((ep) => ep.event_id === eventId && ep.position_id === p.position_id);
        const cols = { quota: p.quota, division: p.division || null, sort_order: p.sort_order || 0, closed_at: null, updated_at: now(), jobdesk: p.jobdesk || null, requirement: p.requirement || null, fee: p.fee || null, ...pickPosDetails(p) };
        if (found) Object.assign(found, cols);
        else eventPositions.push(Object.assign({ id: 'ep-' + (++seq), event_id: eventId, position_id: p.position_id }, cols));
      });
      for (let j = eventPositions.length - 1; j >= 0; j--) { const ep = eventPositions[j]; if (ep.event_id === eventId && !ep.is_custom && !keep.has(String(ep.position_id))) eventPositions.splice(j, 1); }
    },
    // --- Role templates (memory mirror) ---------------------------------------
    async listRoleTemplates(eventTypeId) {
      return roleTemplates.filter((t) => t.event_type_id === eventTypeId).map((t) => memRoleTpl(t, positions)).sort((a, b) => a.sort_order - b.sort_order);
    },
    async listAllRoleTemplates() {
      return roleTemplates.map((t) => memRoleTpl(t, positions)).sort((a, b) => (a.event_type_id < b.event_type_id ? -1 : a.event_type_id > b.event_type_id ? 1 : a.sort_order - b.sort_order));
    },
    async createRoleTemplate({ event_type_id, position_id, division, default_quota, sort_order, description }) {
      if (roleTemplates.find((t) => t.event_type_id === event_type_id && t.position_id === position_id)) { const e = new Error('DUP'); e.code = 'DUP'; throw e; }
      const rec = { id: 'rt-' + (++seq), event_type_id, position_id, division: division || null, default_quota: default_quota != null ? default_quota : 1, sort_order: sort_order || 0, description: description || null, is_active: true };
      roleTemplates.push(rec); return { id: rec.id };
    },
    async updateRoleTemplate(id, patch) {
      const t = roleTemplates.find((x) => x.id === id); if (!t) return;
      if (patch.division !== undefined) t.division = patch.division || null;
      if (patch.default_quota !== undefined) t.default_quota = patch.default_quota;
      if (patch.sort_order !== undefined) t.sort_order = patch.sort_order;
      if (patch.description !== undefined) t.description = patch.description || null;
      if (patch.is_active !== undefined) t.is_active = !!patch.is_active;
    },
    async snapshotTemplateToEvent(eventId, eventTypeId) {
      const tpls = roleTemplates.filter((t) => t.event_type_id === eventTypeId && t.is_active);
      let n = 0;
      tpls.forEach((t) => {
        if (eventPositions.find((ep) => ep.event_id === eventId && ep.position_id === t.position_id)) return;
        eventPositions.push({ id: 'ep-' + (++seq), event_id: eventId, position_id: t.position_id, quota: t.default_quota, division: t.division || null, sort_order: t.sort_order || 0, closed_at: null, updated_at: now() }); n++;
      });
      return n;
    },
    async setEventRoleQuota(eventRoleId, newQuota, changedBy) {
      const ep = eventPositions.find((x) => x.id === eventRoleId);
      if (!ep) { const e = new Error('ROLE_NOT_FOUND'); e.code = 'RPC'; throw e; }
      const approved = memApprovedCount(applications, applicationChoices, ep.event_id, ep.position_id);
      if (newQuota < 0) { const e = new Error('QUOTA_NEGATIVE'); e.code = 'RPC'; throw e; }
      if (newQuota < approved) { const e = new Error('QUOTA_BELOW_APPROVED:' + approved); e.code = 'RPC'; throw e; }
      if (newQuota !== ep.quota) { quotaLogs.push({ id: 'ql-' + (++seq), event_role_id: ep.id, old_quota: ep.quota, new_quota: newQuota, changed_by: changedBy || null, changed_at: now() }); ep.quota = newQuota; ep.updated_at = now(); }
      return { ...ep };
    },
    async approveApplicationChoice(applicationId, positionId, reviewerId, actorName) {
      const app = applications.find((a) => a.id === applicationId);
      if (!app) return 'not_found';
      if (!applicationChoices.some((c) => c.application_id === applicationId && c.position_id === positionId)) return 'skip';
      const ep = eventPositions.find((x) => x.event_id === app.event_id && x.position_id === positionId);
      const quota = ep ? ep.quota : 0;
      const approved = applicationChoices.filter((c) => c.position_id === positionId && c.accepted && c.application_id !== applicationId && (applications.find((a) => a.id === c.application_id) || {}).event_id === app.event_id).length;
      if (quota > 0 && approved >= quota) return 'full';
      applicationChoices.forEach((c) => { if (c.application_id === applicationId) c.accepted = (c.position_id === positionId); });
      const prev = app.status; app.status = 'approved'; app.reviewed_by = reviewerId || null; app.reviewed_at = now();
      statusLogs.push({ id: 'sl-' + (++seq), application_id: applicationId, from_status: prev || null, to_status: 'approved', changed_by: reviewerId || null, actor_name: actorName || null, changed_at: now() });
      return 'ok';
    },
    async listEventRoleQuotaLogs(eventRoleId) { return quotaLogs.filter((l) => l.event_role_id === eventRoleId).slice().reverse(); },
    async addEventRole(eventId, { position_id, division, quota, sort_order, is_optional, is_custom, description }) {
      let ep = eventPositions.find((x) => x.event_id === eventId && x.position_id === position_id);
      if (ep) { ep.closed_at = null; ep.updated_at = now(); return { id: ep.id }; }
      ep = { id: 'ep-' + (++seq), event_id: eventId, position_id, division: division || null, quota: Number.isFinite(quota) ? quota : 0, sort_order: sort_order || 0, is_optional: !!is_optional, is_custom: !!is_custom, description: description || null, closed_at: null, updated_at: now() };
      eventPositions.push(ep); return { id: ep.id };
    },
    async closeEventRole(eventRoleId, closed) { const ep = eventPositions.find((x) => x.id === eventRoleId); if (ep) { ep.closed_at = closed ? now() : null; ep.updated_at = now(); } },
    async deleteEventRole(eventRoleId) { const i = eventPositions.findIndex((x) => x.id === eventRoleId); if (i >= 0) eventPositions.splice(i, 1); },
    async listApplicationChoices() { return applicationChoices.map((c) => ({ ...c })); },
    // --- Two-layer selection (LAPIS 1): reviewer proposals + "reviewed" marks.
    // In-memory mirror of the Supabase interface so the applicant lists / exports
    // work in memory mode. A proposal never changes the application's status.
    async listProposals() { return proposals.map((p) => ({ ...p })); },
    async listProposalsForApplication(applicationId) { return proposals.filter((p) => p.application_id === applicationId).map((p) => ({ ...p })); },
    async addProposal(applicationId, positionId, reviewerName, note) {
      const ex = proposals.find((p) => p.application_id === applicationId && p.position_id === positionId && p.reviewer_name === reviewerName);
      if (ex) { ex.note = note || null; return; }
      proposals.push({ id: 'prop-' + (++seq), application_id: applicationId, position_id: positionId, reviewer_name: reviewerName, note: note || null, created_at: now() });
    },
    async removeProposal(applicationId, positionId, reviewerName) {
      for (let j = proposals.length - 1; j >= 0; j--) { const p = proposals[j]; if (p.application_id === applicationId && p.position_id === positionId && p.reviewer_name === reviewerName) proposals.splice(j, 1); }
    },
    async listReviewMarks() { return reviewMarks.map((r) => ({ ...r })); },
    async addReviewMark(applicationId, reviewerName) {
      if (!reviewMarks.find((r) => r.application_id === applicationId && r.reviewer_name === reviewerName)) reviewMarks.push({ id: 'rev-' + (++seq), application_id: applicationId, reviewer_name: reviewerName, created_at: now() });
    },
    async removeReviewMark(applicationId, reviewerName) {
      for (let j = reviewMarks.length - 1; j >= 0; j--) { const r = reviewMarks[j]; if (r.application_id === applicationId && r.reviewer_name === reviewerName) reviewMarks.splice(j, 1); }
    },
    async listEvents() { return events.map((e) => ({ ...e, needs: eventNeeds.filter((n) => n.event_id === e.id) })); },
    async listActiveEvents() { return events.filter((e) => e.is_active).map((e) => ({ id: e.id, name: e.name })); },
    async toggleEvent(id) { const e = events.find((e) => e.id === id); if (e) e.is_active = !e.is_active; },
    async completeEvent(id, completed) { const e = events.find((e) => e.id === id); if (e) e.completed_at = completed ? now() : null; },
    async createAssignment({ event_id, talent_id, talent_type, assigned_by }) {
      if (!assignments.find((a) => a.event_id === event_id && a.talent_id === talent_id)) {
        assignments.push({ id: 'as-' + (++seq), event_id, talent_id, talent_type, status: 'assigned', assigned_by: assigned_by || null, assigned_at: now() });
      }
    },
    async listAssignments() { return assignments.slice().reverse(); },
    async listAssignmentsForTalent(talentId) { return assignments.filter((a) => a.talent_id === talentId).slice().reverse(); },
    async createApplication({ event_id, talent_id, talent_type, role, answers }) {
      // New flow allows one application per (talent, event, position), so no
      // (talent, event) uniqueness here — the apply handlers guard duplicates.
      const rec = { id: 'app-' + (++seq), event_id, talent_id, talent_type: talent_type || 'main_power', role, answers: answers || null, status: 'pending', station: null, station_loc: null, note: null, reviewed_by: null, reviewed_at: null, created_at: now() };
      applications.push(rec);
      return { id: rec.id };
    },
    async listApplications() { return applications.slice().reverse(); },
    async listApplicationsForTalent(talentId) { return applications.filter((a) => a.talent_id === talentId).slice().reverse(); },
    async getApplication(id) { return applications.find((a) => a.id === id) || null; },
    async updateApplication(id, patch) { const a = applications.find((a) => a.id === id); if (a) Object.assign(a, patch); },
    async getApplicationForEvent(talentId, eventId) { return applications.find((a) => a.talent_id === talentId && a.event_id === eventId) || null; },
    async addApplicationChoices(applicationId, choices) { (choices || []).forEach((c) => applicationChoices.push({ id: 'ac-' + (++seq), application_id: applicationId, position_id: c.position_id, priority: c.priority, accepted: false })); },
    async replaceApplicationChoices(applicationId, choices) { for (let j = applicationChoices.length - 1; j >= 0; j--) if (applicationChoices[j].application_id === applicationId) applicationChoices.splice(j, 1); (choices || []).forEach((c) => applicationChoices.push({ id: 'ac-' + (++seq), application_id: applicationId, position_id: c.position_id, priority: c.priority, accepted: false })); },
    async listChoicesForApplication(applicationId) { return applicationChoices.filter((c) => c.application_id === applicationId).map((c) => ({ ...c })).sort((a, b) => a.priority - b.priority); },
    async acceptApplicationChoice(applicationId, positionId) { applicationChoices.forEach((c) => { if (c.application_id === applicationId) c.accepted = (c.position_id === positionId); }); },
    async clearApplicationAccepted(applicationId) { applicationChoices.forEach((c) => { if (c.application_id === applicationId) c.accepted = false; }); },
    async addStatusLog(applicationId, fromStatus, toStatus, changedBy, actorName) {
      statusLogs.push({ id: 'sl-' + (++seq), application_id: applicationId, from_status: fromStatus || null, to_status: toStatus, changed_by: changedBy || null, actor_name: actorName || null, changed_at: now() });
    },
    async listStatusLogForApplication(applicationId) { return statusLogs.filter((l) => l.application_id === applicationId).map((l) => ({ ...l })); },
    async listStatusLogs() { return statusLogs.map((l) => ({ ...l })); },
    async deleteApplication(id) { const i = applications.findIndex((a) => a.id === id); if (i >= 0) applications.splice(i, 1); for (let j = applicationChoices.length - 1; j >= 0; j--) if (applicationChoices[j].application_id === id) applicationChoices.splice(j, 1); },
    async createCertificate(row) {
      if (certificates.find((c) => c.talent_id === row.talent_id && c.event_id === row.event_id)) { const e = new Error('DUP'); e.code = 'DUP'; throw e; }
      const rec = { id: 'cert-' + (++seq), revoked_at: null, issued_at: now(), ...row };
      certificates.push(rec);
      return { id: rec.id, cert_no: rec.cert_no };
    },
    async getCertificate(id) { return certificates.find((c) => c.id === id) || null; },
    async getCertificateByNo(certNo) { return certificates.find((c) => c.cert_no === certNo) || null; },
    async listCertificatesForTalent(talentId) { return certificates.filter((c) => c.talent_id === talentId && !c.revoked_at).slice().reverse(); },
    async listCertificates() { return certificates.slice().reverse(); },
    async revokeCertificate(id, revoked) { const c = certificates.find((c) => c.id === id); if (c) c.revoked_at = revoked ? now() : null; },
    async getCertConfig() { return { signatory_name: 'Novi Eastiyanto', signatory_title: 'COO', verify_base: 'talent.20fit.id/cert' }; },
    async createProof(row) { const p = { id: 'pf-' + (++seq), ...row, status: row.status || 'pending', created_at: now() }; proofs.push(p); return { id: p.id }; },
    async updateProof(id, patch) { const p = proofs.find((p) => p.id === id); if (p) Object.assign(p, patch); },
    async listProofs() { return proofs.slice().reverse(); },
    async listProofsForTalent(talentId) { return proofs.filter((p) => p.talent_id === talentId).slice().reverse(); },
    async getProof(id) { return proofs.find((p) => p.id === id) || null; },
    async deleteProof(id) { const i = proofs.findIndex((p) => p.id === id); if (i >= 0) proofs.splice(i, 1); },
    async deleteEvent(id) {
      const i = events.findIndex((e) => e.id === id); if (i >= 0) events.splice(i, 1);
      for (let j = eventNeeds.length - 1; j >= 0; j--) if (eventNeeds[j].event_id === id) eventNeeds.splice(j, 1);
      for (let j = assignments.length - 1; j >= 0; j--) if (assignments[j].event_id === id) assignments.splice(j, 1);
      for (let j = applications.length - 1; j >= 0; j--) if (applications[j].event_id === id) applications.splice(j, 1);
    },
    async deleteStaff(id) { const i = staff.findIndex((s) => s.id === id); if (i >= 0) staff.splice(i, 1); },
    async getSettings() { return { ...settings }; },
    async updateSettings(patch) { for (const k of SETTING_KEYS) if (Number.isFinite(patch[k])) settings[k] = patch[k]; },
  };
}

let impl;
function store() {
  if (impl === undefined) {
    if (MODE === 'memory') {
      impl = memoryStore();
    } else {
      impl = supabaseStore() || memoryStore();
    }
  }
  return impl;
}

module.exports = { store, MODE };
