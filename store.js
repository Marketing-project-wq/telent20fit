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
const POS_DETAIL_COLS = ['work_hours', 'venue_detail', 'dresscode', 'meeting_point', 'kol_content', 'kol_deadline', 'kol_min_followers', 'kol_hashtags', 'photo_output', 'photo_deadline', 'photo_equipment'];
const pickPosDetails = (src) => { const o = {}; for (const c of POS_DETAIL_COLS) o[c] = (src && src[c]) || null; return o; };

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
        .select('id,talent_type,name,login,phone,city,province,birthdate,gender,instagram,instagram_followers,experience,ktp,profile_completed_at,cv_path,portfolio_url,hyrox_cert_path,hyrox_cert_status,hyrox_cert_verified_by,hyrox_cert_verified_at,hyrox_cert_note,created_at')
        .eq('id', id).maybeSingle();
      return data || null;
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
        .select('id,talent_type,name,login,phone,city,birthdate,gender,instagram,instagram_followers,experience,ktp,profile_completed_at,hyrox_cert_status')
        .order('name');
      if (talentType) q = q.eq('talent_type', talentType);
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      return data || [];
    },
    async createEvent({ name, description, location, starts_at, ends_at, created_by, needs, mp_sow, category, start_time, end_time, reg_deadline, reg_open, status }) {
      const { data, error } = await sb.from('talent_events')
        .insert({ name, description: description || null, location: location || null, starts_at: starts_at || null, ends_at: ends_at || null, created_by: created_by || null, mp_sow: mp_sow || null, category: category || null, start_time: start_time || null, end_time: end_time || null, reg_deadline: reg_deadline || null, reg_open: reg_open || null, status: status || 'published' })
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
      if (patch.location !== undefined) row.location = patch.location || null;
      if (patch.starts_at !== undefined) row.starts_at = patch.starts_at || null;
      if (patch.ends_at !== undefined) row.ends_at = patch.ends_at || null;
      if (patch.mp_sow !== undefined) row.mp_sow = patch.mp_sow || null;
      if (patch.mockup_path !== undefined) row.mockup_path = patch.mockup_path || null;
      if (patch.category !== undefined) row.category = patch.category || null;
      if (patch.start_time !== undefined) row.start_time = patch.start_time || null;
      if (patch.end_time !== undefined) row.end_time = patch.end_time || null;
      if (patch.reg_deadline !== undefined) row.reg_deadline = patch.reg_deadline || null;
      if (patch.reg_open !== undefined) row.reg_open = patch.reg_open || null;
      if (patch.status !== undefined) row.status = patch.status;
      if (patch.reg_closed_at !== undefined) row.reg_closed_at = patch.reg_closed_at;
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
    async listEventPositions(eventId) {
      const { data, error } = await sb.from('talent_event_positions')
        .select('id,quota,closed_at,jobdesk,requirement,fee,' + POS_DETAIL_COLS.join(',') + ',position_id,talent_positions(key,label_id,label_en,sort)').eq('event_id', eventId);
      if (error) throw new Error(error.message);
      return (data || []).map((r) => ({ id: r.id, position_id: r.position_id, quota: r.quota, closed_at: r.closed_at, jobdesk: r.jobdesk || null, requirement: r.requirement || null, fee: r.fee || null, ...pickPosDetails(r), key: r.talent_positions && r.talent_positions.key, label_id: r.talent_positions && r.talent_positions.label_id, label_en: r.talent_positions && r.talent_positions.label_en, sort: (r.talent_positions && r.talent_positions.sort) || 0 }))
        .sort((a, b) => a.sort - b.sort);
    },
    async setEventPositions(eventId, positions) {
      await sb.from('talent_event_positions').delete().eq('event_id', eventId);
      const rows = (positions || []).filter((p) => p && p.position_id && p.quota > 0).map((p) => ({ event_id: eventId, position_id: p.position_id, quota: p.quota, jobdesk: p.jobdesk || null, requirement: p.requirement || null, fee: p.fee || null, ...pickPosDetails(p) }));
      if (rows.length) { const r = await sb.from('talent_event_positions').insert(rows); if (r.error) throw new Error(r.error.message); }
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
      if (rows.length) { const r = await sb.from('talent_application_choices').insert(rows); if (r.error) throw new Error(r.error.message); }
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
    // Accept a talent into one position as ONE transaction (quota check + accept +
    // auto-decline their other picks for the event + status-history rows), via the
    // talent_accept_choice RPC. Returns 'ok' | 'full' | 'skip'.
    async acceptApplicationTxn(applicationId, positionId, reviewerId) {
      const { data, error } = await sb.rpc('talent_accept_choice', { p_app_id: applicationId, p_position_id: positionId, p_reviewer: reviewerId || null });
      if (error) throw new Error(error.message);
      return data || 'skip';
    },
    // An accepted talent cancels, as ONE transaction (free slot + status history +
    // EO notification), via the talent_cancel_application RPC (also re-checks the
    // H-1 window in-DB). Returns 'ok' | 'skip' | 'closed'.
    async cancelApplicationTxn(applicationId, reason, note, actorId) {
      const { data, error } = await sb.rpc('talent_cancel_application', { p_app_id: applicationId, p_reason: reason || null, p_note: note || null, p_actor: actorId || null });
      if (error) throw new Error(error.message);
      return data || 'skip';
    },
    // Append a status-history row (kapan, dari apa ke apa, oleh siapa).
    async logStatusChange(applicationId, fromStatus, toStatus, changedBy) {
      const { error } = await sb.from('talent_application_status_log')
        .insert({ application_id: applicationId, from_status: fromStatus || null, to_status: toStatus, changed_by: changedBy || null });
      if (error) throw new Error(error.message);
    },
    // K4: talent confirms (or clears) that they're available for the position they
    // were accepted into. Records a timestamp; does not change the quota count.
    async setApplicationConfirmed(applicationId, on) {
      const { error } = await sb.from('talent_applications')
        .update({ confirmed_at: on ? new Date().toISOString() : null }).eq('id', applicationId);
      if (error) throw new Error(error.message);
    },
    async listApplicationStatusLog(applicationId) {
      const { data } = await sb.from('talent_application_status_log').select('*').eq('application_id', applicationId).order('changed_at');
      return data || [];
    },
    // ---- Offer / confirmation lifecycle (Tahap 2+) ----
    // Turn a just-accepted application into an OPEN OFFER (deadline set later, when
    // the email is actually sent). Clears any prior offer resolution (re-offer).
    async setOfferOffered(applicationId, offeredAtIso) {
      const { error } = await sb.from('talent_applications').update({
        offer_state: 'offered', offered_at: offeredAtIso, offer_sent_at: null, offer_deadline: null,
        offer_reminded_at: null, offer_resolved_at: null, offer_decline_reason: null, offer_decline_note: null, confirmed_at: null,
      }).eq('id', applicationId);
      if (error) throw new Error(error.message);
    },
    // Anchor the deadline once the offer email has actually been sent.
    async setOfferSent(applicationId, sentIso, deadlineIso) {
      const { error } = await sb.from('talent_applications').update({ offer_sent_at: sentIso, offer_deadline: deadlineIso })
        .eq('id', applicationId).eq('offer_state', 'offered').is('offer_sent_at', null);
      if (error) throw new Error(error.message);
    },
    async setOfferReminded(applicationId, iso) {
      const { error } = await sb.from('talent_applications').update({ offer_reminded_at: iso })
        .eq('id', applicationId).eq('offer_state', 'offered').is('offer_reminded_at', null);
      if (error) throw new Error(error.message);
    },
    // Transactions (advisory-locked per event in the RPC). 'ok' | 'closed' | 'skip'.
    async confirmOfferTxn(applicationId, actorId) {
      const { data, error } = await sb.rpc('talent_confirm_offer', { p_app_id: applicationId, p_actor: actorId || null });
      if (error) throw new Error(error.message); return data || 'skip';
    },
    async declineOfferTxn(applicationId, reason, note, actorId) {
      const { data, error } = await sb.rpc('talent_decline_offer', { p_app_id: applicationId, p_reason: reason || null, p_note: note || null, p_actor: actorId || null });
      if (error) throw new Error(error.message); return data || 'skip';
    },
    async lapseOfferTxn(applicationId) {
      const { data, error } = await sb.rpc('talent_lapse_offer', { p_app_id: applicationId });
      if (error) throw new Error(error.message); return data || 'skip';
    },
    // ---- Standby list (cadangan/siaga) ----
    async listStandby(eventId) {
      const { data, error } = await sb.from('talent_event_standby').select('*').eq('event_id', eventId).order('position_id').order('rank', { nullsFirst: false });
      if (error) throw new Error(error.message);
      return data || [];
    },
    async listStandbyForApp(applicationId) {
      const { data } = await sb.from('talent_event_standby').select('*').eq('application_id', applicationId);
      return data || [];
    },
    async getStandby(id) { const { data } = await sb.from('talent_event_standby').select('*').eq('id', id).maybeSingle(); return data || null; },
    async upsertStandby({ event_id, application_id, position_id, rank, state, created_by }) {
      const { data, error } = await sb.from('talent_event_standby')
        .upsert({ event_id, application_id, position_id, rank: rank == null ? null : rank, state: state || 'offered', created_by: created_by || null }, { onConflict: 'application_id,position_id' })
        .select('id').maybeSingle();
      if (error) throw new Error(error.message);
      return data;
    },
    async updateStandby(id, patch) { const { error } = await sb.from('talent_event_standby').update(patch).eq('id', id); if (error) throw new Error(error.message); },
    async deleteStandby(id) { await sb.from('talent_event_standby').delete().eq('id', id); },
    // ---- Substitution history (riwayat pergantian) ----
    async listSubstitutions(eventId) {
      const { data, error } = await sb.from('talent_substitution').select('*').eq('event_id', eventId).order('created_at', { ascending: false });
      if (error) throw new Error(error.message);
      return data || [];
    },
    async getSubstitution(id) { const { data } = await sb.from('talent_substitution').select('*').eq('id', id).maybeSingle(); return data || null; },
    async createSubstitution(row) {
      const { data, error } = await sb.from('talent_substitution').insert(row).select('id').maybeSingle();
      if (error) throw new Error(error.message);
      return data;
    },
    async updateSubstitution(id, patch) { const { error } = await sb.from('talent_substitution').update(patch).eq('id', id); if (error) throw new Error(error.message); },
    // Offer a standby candidate a vacated slot as ONE transaction (reserve + mark
    // called), via the RPC. Returns the substitution id or null if a guard blocked.
    async offerSubstituteTxn({ event_id, position_id, outgoing_application_id, incoming_application_id, from_position_id, deadline_at, created_by }) {
      const { data, error } = await sb.rpc('talent_offer_substitute', { p_event: event_id, p_position: position_id, p_outgoing: outgoing_application_id, p_incoming: incoming_application_id, p_from_position: from_position_id || null, p_deadline: deadline_at || null, p_actor: created_by || null });
      if (error) throw new Error(error.message);
      return data || null;
    },
    // A called substitute confirms, as ONE transaction (lock slot + status log +
    // mark confirmed), via the RPC. Returns 'ok' | 'skip' | 'expired'.
    async confirmSubstituteTxn(subId, actorId) {
      const { data, error } = await sb.rpc('talent_confirm_substitute', { p_sub: subId, p_actor: actorId || null });
      if (error) throw new Error(error.message);
      return data || 'skip';
    },
    // ---- EO notifications (pemberitahuan aktif) ----
    async listEoNotifications(staffId, { unreadOnly } = {}) {
      let q = sb.from('talent_eo_notification').select('*').eq('staff_id', staffId);
      if (unreadOnly) q = q.is('read_at', null);
      const { data } = await q.order('created_at', { ascending: false });
      return data || [];
    },
    async createEoNotification(row) {
      const { data, error } = await sb.from('talent_eo_notification').insert(row).select('id').maybeSingle();
      if (error) throw new Error(error.message);
      return data;
    },
    async markEoNotificationRead(id) { await sb.from('talent_eo_notification').update({ read_at: new Date().toISOString() }).eq('id', id); },
    // ---- Attendance (absensi 3-status per hari) ----
    async listAttendanceForEvent(eventId) {
      const { data, error } = await sb.from('talent_event_attendance').select('*').eq('event_id', eventId);
      if (error) throw new Error(error.message);
      return data || [];
    },
    async listAttendanceForTalent(talentId) {
      const { data } = await sb.from('talent_event_attendance').select('*').eq('talent_id', talentId);
      return data || [];
    },
    async getAttendanceById(id) { const { data } = await sb.from('talent_event_attendance').select('*').eq('id', id).maybeSingle(); return data || null; },
    async getAttendance(applicationId, eventDay) { const { data } = await sb.from('talent_event_attendance').select('*').eq('application_id', applicationId).eq('event_day', eventDay).maybeSingle(); return data || null; },
    // Set status; inserts the row on first mark (unique application_id+event_day).
    async upsertAttendance(row) {
      const payload = Object.assign({ updated_at: new Date().toISOString() }, row);
      const { data, error } = await sb.from('talent_event_attendance')
        .upsert(payload, { onConflict: 'application_id,event_day' }).select('*').maybeSingle();
      if (error) throw new Error(error.message);
      return data;
    },
    async updateAttendance(id, patch) { const { error } = await sb.from('talent_event_attendance').update(Object.assign({ updated_at: new Date().toISOString() }, patch)).eq('id', id); if (error) throw new Error(error.message); },
    async addAttendanceLog(row) { const { error } = await sb.from('talent_attendance_log').insert(row); if (error) throw new Error(error.message); },
    async listAttendanceLog(attendanceId) { const { data } = await sb.from('talent_attendance_log').select('*').eq('attendance_id', attendanceId).order('changed_at'); return data || []; },
    async listAttendanceLogsForEvent(eventId) {
      const { data: att } = await sb.from('talent_event_attendance').select('id').eq('event_id', eventId);
      const ids = (att || []).map((a) => a.id);
      if (!ids.length) return [];
      const { data } = await sb.from('talent_attendance_log').select('*').in('attendance_id', ids).order('changed_at');
      return data || [];
    },
    // ---- Attendance link token ----
    async createAttendanceLink(row) { const { data, error } = await sb.from('talent_attendance_link').insert(row).select('*').maybeSingle(); if (error) throw new Error(error.message); return data; },
    async getAttendanceLinkByToken(token) { const { data } = await sb.from('talent_attendance_link').select('*').eq('token', token).is('revoked_at', null).maybeSingle(); return data || null; },
    async getAttendanceLinkForEvent(eventId) { const { data } = await sb.from('talent_attendance_link').select('*').eq('event_id', eventId).is('revoked_at', null).order('created_at', { ascending: false }).limit(1).maybeSingle(); return data || null; },
    async revokeAttendanceLink(id) { const { error } = await sb.from('talent_attendance_link').update({ revoked_at: new Date().toISOString() }).eq('id', id); if (error) throw new Error(error.message); },
    // ---- Attendance correction requests ----
    async createCorrection(row) { const { data, error } = await sb.from('talent_attendance_correction').insert(row).select('*').maybeSingle(); if (error) throw new Error(error.message); return data; },
    async listCorrections({ state } = {}) { let q = sb.from('talent_attendance_correction').select('*'); if (state) q = q.eq('state', state); const { data } = await q.order('created_at', { ascending: false }); return data || []; },
    async listCorrectionsForTalent(talentId) { const { data } = await sb.from('talent_attendance_correction').select('*').eq('talent_id', talentId).order('created_at', { ascending: false }); return data || []; },
    async getCorrection(id) { const { data } = await sb.from('talent_attendance_correction').select('*').eq('id', id).maybeSingle(); return data || null; },
    async updateCorrection(id, patch) { const { error } = await sb.from('talent_attendance_correction').update(patch).eq('id', id); if (error) throw new Error(error.message); },
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
    id: a.id, talent_type: a.talent_type, name: a.name, login: a.login, created_at: a.created_at || null,
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
    ['judge', 'Judge', 'Judge', 10], ['runner', 'Runner', 'Runner', 20], ['kol', 'KOL', 'KOL', 30],
    ['registration_staff', 'Registration Staff', 'Registration Staff', 40], ['water_station', 'Water Station', 'Water Station', 50],
    ['time_chip_management', 'Time Chip Management', 'Time Chip Management', 60], ['fotografer', 'Fotografer', 'Photographer', 70],
    ['videografer', 'Videografer', 'Videographer', 80], ['marshal', 'Marshal', 'Marshal', 90], ['drop_bag', 'Drop Bag', 'Drop Bag', 100],
  ].map(([key, label_id, label_en, sort]) => ({ id: 'pos-' + key, key, label_id, label_en, sort, is_active: true }));
  const eventPositions = [
    { id: 'ep-j-kol', event_id: 'ev-jakarta', position_id: 'pos-kol', quota: 2, closed_at: null, jobdesk: 'Buat 3 konten (reels/story) selama event & tag akun 20FIT. Hadir di lokasi hari-H.', requirement: 'Followers IG 5.000+, engagement bagus, terbiasa bikin konten olahraga.', fee: 'Rp750.000 + merchandise event' },
    { id: 'ep-j-foto', event_id: 'ev-jakarta', position_id: 'pos-fotografer', quota: 2, closed_at: null, jobdesk: 'Dokumentasi foto di area start/finish & sepanjang rute. Deliver min. 150 foto terkurasi H+2.', requirement: 'Punya kamera mirrorless/DSLR sendiri, pengalaman foto event olahraga.', fee: 'Rp600.000/hari' },
    { id: 'ep-j-judge', event_id: 'ev-jakarta', position_id: 'pos-judge', quota: 5, closed_at: null, jobdesk: 'Menilai peserta di station sesuai peraturan lomba. Briefing H-1, hari-H 05.00–14.00.', requirement: 'Paham peraturan lomba lari, teliti, disiplin waktu.', fee: 'Rp500.000/hari + konsumsi' },
    { id: 'ep-b-judge', event_id: 'ev-bali', position_id: 'pos-judge', quota: 5, closed_at: null, jobdesk: 'Menilai peserta trail di checkpoint. Medan bukit, briefing H-1.', requirement: 'Fisik prima, paham peraturan trail run.', fee: 'Rp650.000/hari' },
    { id: 'ep-b-runner', event_id: 'ev-bali', position_id: 'pos-runner', quota: 8, closed_at: null, jobdesk: 'Sweeper/pacer di rute trail memastikan keselamatan peserta.', requirement: 'Rutin lari trail, mampu 21K.', fee: 'Rp500.000/hari' },
    { id: 'ep-s-kol', event_id: 'ev-sby', position_id: 'pos-kol', quota: 3, closed_at: null, jobdesk: 'Liputan & konten media sosial lomba, tag akun 20FIT.', requirement: 'Followers IG 5.000+, aktif bikin konten.', fee: 'Rp700.000 + merchandise' },
    { id: 'ep-s-foto', event_id: 'ev-sby', position_id: 'pos-fotografer', quota: 2, closed_at: null, jobdesk: 'Dokumentasi foto peserta & suasana event.', requirement: 'Punya kamera mirrorless/DSLR.', fee: 'Rp600.000/hari' },
    { id: 'ep-s-marshal', event_id: 'ev-sby', position_id: 'pos-marshal', quota: 6, closed_at: null, jobdesk: 'Pengarah & pengaman rute lari.', requirement: 'Fisik prima, sigap.', fee: 'Rp500.000/hari' },
  ];
  const applicationChoices = [];
  const applications = [
    { id: 'app-budi', event_id: 'ev-jakarta', talent_id: 'mp-budi', talent_type: 'main_power', role: 'Judges', answers: { q1: 'Ya', q2: 'Ya', q3: 'Jakarta Marathon 2024 (finish line)', q4: 'Ya' }, status: 'pending', station: null, station_loc: null, note: null, reviewed_by: null, reviewed_at: null, created_at: now() },
  ];
  const passwordResets = [];
  const certificates = [];
  const proofs = [];
  const statusLog = [];
  const standby = [];
  const substitutions = [];
  const eoNotifications = [];
  const attendance = [];
  const attendanceLog = [];
  const attendanceLinks = [];
  const corrections = [];
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
    async createEvent({ name, description, location, starts_at, ends_at, created_by, needs, mp_sow, category, start_time, end_time, reg_deadline, reg_open, status }) {
      const ev = { id: 'ev-' + (++seq), name, description: description || null, location: location || null, starts_at: starts_at || null, ends_at: ends_at || null, is_active: true, created_by: created_by || null, created_at: now(), mp_sow: mp_sow || null, category: category || null, start_time: start_time || null, end_time: end_time || null, reg_deadline: reg_deadline || null, reg_open: reg_open || null, status: status || 'published', reg_closed_at: null };
      events.unshift(ev);
      (needs || []).filter((n) => n && n.talent_type).forEach((n) => eventNeeds.push({ event_id: ev.id, talent_type: n.talent_type, headcount: n.headcount || 1 }));
      return { id: ev.id, name: ev.name, is_active: ev.is_active, created_at: ev.created_at };
    },
    async updateEvent(id, patch) {
      patch = patch || {};
      const ev = events.find((e) => e.id === id);
      if (!ev) return;
      if (patch.name !== undefined) ev.name = patch.name;
      if (patch.location !== undefined) ev.location = patch.location || null;
      if (patch.starts_at !== undefined) ev.starts_at = patch.starts_at || null;
      if (patch.ends_at !== undefined) ev.ends_at = patch.ends_at || null;
      if (patch.mp_sow !== undefined) ev.mp_sow = patch.mp_sow || null;
      if (patch.mockup_path !== undefined) ev.mockup_path = patch.mockup_path || null;
      if (patch.category !== undefined) ev.category = patch.category || null;
      if (patch.start_time !== undefined) ev.start_time = patch.start_time || null;
      if (patch.end_time !== undefined) ev.end_time = patch.end_time || null;
      if (patch.reg_deadline !== undefined) ev.reg_deadline = patch.reg_deadline || null;
      if (patch.reg_open !== undefined) ev.reg_open = patch.reg_open || null;
      if (patch.status !== undefined) ev.status = patch.status;
      if (patch.reg_closed_at !== undefined) ev.reg_closed_at = patch.reg_closed_at;
      if (patch.needs) {
        for (let j = eventNeeds.length - 1; j >= 0; j--) if (eventNeeds[j].event_id === id) eventNeeds.splice(j, 1);
        patch.needs.filter((n) => n && n.talent_type).forEach((n) => eventNeeds.push({ event_id: id, talent_type: n.talent_type, headcount: n.headcount || 1 }));
      }
    },
    async listPositions() { return positions.filter((p) => p.is_active).slice().sort((a, b) => a.sort - b.sort).map((p) => ({ ...p })); },
    async listEventPositions(eventId) {
      return eventPositions.filter((ep) => ep.event_id === eventId).map((ep) => { const m = positions.find((p) => p.id === ep.position_id) || {}; return { id: ep.id, position_id: ep.position_id, quota: ep.quota, closed_at: ep.closed_at || null, jobdesk: ep.jobdesk || null, requirement: ep.requirement || null, fee: ep.fee || null, ...pickPosDetails(ep), key: m.key, label_id: m.label_id, label_en: m.label_en, sort: m.sort || 0 }; }).sort((a, b) => a.sort - b.sort);
    },
    async setEventPositions(eventId, poss) {
      for (let j = eventPositions.length - 1; j >= 0; j--) if (eventPositions[j].event_id === eventId) eventPositions.splice(j, 1);
      (poss || []).filter((p) => p && p.position_id && p.quota > 0).forEach((p) => eventPositions.push({ id: 'ep-' + (++seq), event_id: eventId, position_id: p.position_id, quota: p.quota, closed_at: null, jobdesk: p.jobdesk || null, requirement: p.requirement || null, fee: p.fee || null, ...pickPosDetails(p) }));
    },
    async listApplicationChoices() { return applicationChoices.map((c) => ({ ...c })); },
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
      const rec = { id: 'app-' + (++seq), event_id, talent_id, talent_type: talent_type || 'main_power', role, answers: answers || null, status: 'pending', station: null, station_loc: null, note: null, reviewed_by: null, reviewed_at: null, confirmed_at: null, cancelled_at: null, cancel_reason: null, cancel_reason_note: null, cancel_is_emergency: false, cancelled_by: null, created_at: now() };
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
    async acceptApplicationTxn(applicationId, positionId, reviewerId) {
      const app = applications.find((a) => a.id === applicationId);
      if (!app) return 'skip';
      const myChoices = applicationChoices.filter((c) => c.application_id === applicationId);
      if (!myChoices.some((c) => c.position_id === positionId)) return 'skip';
      const ep = eventPositions.find((p) => p.event_id === app.event_id && p.position_id === positionId);
      const quota = ep ? ep.quota : 0;
      const appIds = new Set(applications.filter((a) => a.event_id === app.event_id).map((a) => a.id));
      const taken = applicationChoices.filter((c) => c.position_id === positionId && c.accepted && c.application_id !== applicationId && appIds.has(c.application_id)).length;
      if (quota > 0 && taken >= quota) return 'full';
      applicationChoices.forEach((c) => { if (c.application_id === applicationId) { c.accepted = (c.position_id === positionId); c.outcome = c.position_id === positionId ? 'accepted' : null; } });
      if (app.status !== 'approved') statusLog.push({ id: 'sl-' + (++seq), application_id: applicationId, from_status: app.status || null, to_status: 'approved', changed_by: reviewerId || null, changed_at: now() });
      Object.assign(app, { status: 'approved', reviewed_by: reviewerId || null, reviewed_at: now() });
      const others = applications.filter((a) => a.event_id === app.event_id && a.talent_id === app.talent_id && a.id !== applicationId && !['approved', 'not_selected', 'not_continued', 'rejected'].includes(a.status));
      for (const o of others) {
        applicationChoices.forEach((c) => { if (c.application_id === o.id) { c.accepted = false; c.outcome = 'not_continued'; } });
        statusLog.push({ id: 'sl-' + (++seq), application_id: o.id, from_status: o.status || null, to_status: 'not_continued', changed_by: reviewerId || null, changed_at: now() });
        Object.assign(o, { status: 'not_continued', reviewed_by: reviewerId || null, reviewed_at: now(), note: 'Otomatis: kamu diterima di posisi lain pada event ini.' });
      }
      return 'ok';
    },
    async logStatusChange(applicationId, fromStatus, toStatus, changedBy) { statusLog.push({ id: 'sl-' + (++seq), application_id: applicationId, from_status: fromStatus || null, to_status: toStatus, changed_by: changedBy || null, changed_at: now() }); },
    async cancelApplicationTxn(applicationId, reason, note, actorId) {
      const app = applications.find((a) => a.id === applicationId);
      if (!app || app.status !== 'approved') return 'skip';
      const acc = applicationChoices.find((c) => c.application_id === applicationId && c.accepted);
      const pos = acc ? acc.position_id : null;
      applicationChoices.forEach((c) => { if (c.application_id === applicationId) { c.accepted = false; c.outcome = 'cancelled'; } });
      statusLog.push({ id: 'sl-' + (++seq), application_id: applicationId, from_status: app.status, to_status: 'cancelled', changed_by: actorId || null, changed_at: now() });
      const ev = events.find((e) => e.id === app.event_id);
      Object.assign(app, { status: 'cancelled', cancelled_at: now(), cancel_reason: reason || null, cancel_reason_note: note || null, cancelled_by: actorId || null });
      eoNotifications.push({ id: 'eon-' + (++seq), event_id: app.event_id, staff_id: ev ? ev.created_by : null, kind: 'cancellation', application_id: applicationId, position_id: pos, data: { reason: reason || null, note: note || null }, read_at: null, created_at: now() });
      return 'ok';
    },
    async setApplicationConfirmed(applicationId, on) { const a = applications.find((a) => a.id === applicationId); if (a) a.confirmed_at = on ? now() : null; },
    async listApplicationStatusLog(applicationId) { return statusLog.filter((s) => s.application_id === applicationId).map((s) => ({ ...s })); },
    // ---- Offer / confirmation lifecycle (Tahap 2+) ----
    async setOfferOffered(applicationId, offeredAtIso) {
      const a = applications.find((x) => x.id === applicationId);
      if (a) Object.assign(a, { offer_state: 'offered', offered_at: offeredAtIso || now(), offer_sent_at: null, offer_deadline: null, offer_reminded_at: null, offer_resolved_at: null, offer_decline_reason: null, offer_decline_note: null, confirmed_at: null });
    },
    async setOfferSent(applicationId, sentIso, deadlineIso) {
      const a = applications.find((x) => x.id === applicationId);
      if (a && a.offer_state === 'offered' && !a.offer_sent_at) Object.assign(a, { offer_sent_at: sentIso, offer_deadline: deadlineIso });
    },
    async setOfferReminded(applicationId, iso) {
      const a = applications.find((x) => x.id === applicationId);
      if (a && a.offer_state === 'offered' && !a.offer_reminded_at) a.offer_reminded_at = iso;
    },
    async confirmOfferTxn(applicationId, actorId) {
      const a = applications.find((x) => x.id === applicationId);
      if (!a) return 'skip';
      if (a.offer_state === 'confirmed') return 'ok';
      if (a.offer_state !== 'offered') return 'closed';
      if (a.offer_deadline && Date.parse(a.offer_deadline) <= Date.now()) return 'closed';
      Object.assign(a, { offer_state: 'confirmed', confirmed_at: now(), offer_resolved_at: now() });
      statusLog.push({ id: 'sl-' + (++seq), application_id: applicationId, from_status: 'offered', to_status: 'offer_confirmed', changed_by: actorId || null, changed_at: now() });
      return 'ok';
    },
    async declineOfferTxn(applicationId, reason, note, actorId) {
      const a = applications.find((x) => x.id === applicationId);
      if (!a || a.offer_state !== 'offered') return 'skip';
      const acc = applicationChoices.find((c) => c.application_id === applicationId && c.accepted);
      const pos = acc ? acc.position_id : null;
      applicationChoices.forEach((c) => { if (c.application_id === applicationId) { c.accepted = false; c.outcome = 'declined'; } });
      Object.assign(a, { offer_state: 'declined', status: 'not_continued', offer_resolved_at: now(), offer_decline_reason: reason || null, offer_decline_note: note || null });
      statusLog.push({ id: 'sl-' + (++seq), application_id: applicationId, from_status: 'offered', to_status: 'offer_declined', changed_by: actorId || null, changed_at: now() });
      const ev = events.find((e) => e.id === a.event_id);
      eoNotifications.push({ id: 'eon-' + (++seq), event_id: a.event_id, staff_id: ev ? ev.created_by : null, kind: 'offer_declined', application_id: applicationId, position_id: pos, data: { reason: reason || null, note: note || null }, read_at: null, created_at: now() });
      return 'ok';
    },
    async lapseOfferTxn(applicationId) {
      const a = applications.find((x) => x.id === applicationId);
      if (!a || a.offer_state !== 'offered') return 'skip';
      if (!a.offer_deadline || Date.parse(a.offer_deadline) > Date.now()) return 'skip';
      const acc = applicationChoices.find((c) => c.application_id === applicationId && c.accepted);
      const pos = acc ? acc.position_id : null;
      applicationChoices.forEach((c) => { if (c.application_id === applicationId) { c.accepted = false; c.outcome = 'lapsed'; } });
      Object.assign(a, { offer_state: 'lapsed', status: 'not_continued', offer_resolved_at: now() });
      statusLog.push({ id: 'sl-' + (++seq), application_id: applicationId, from_status: 'offered', to_status: 'offer_lapsed', changed_by: null, changed_at: now() });
      const ev = events.find((e) => e.id === a.event_id);
      eoNotifications.push({ id: 'eon-' + (++seq), event_id: a.event_id, staff_id: ev ? ev.created_by : null, kind: 'offer_lapsed', application_id: applicationId, position_id: pos, data: null, read_at: null, created_at: now() });
      return 'ok';
    },
    // ---- Standby list (cadangan/siaga) ----
    async listStandby(eventId) { return standby.filter((s) => s.event_id === eventId).map((s) => ({ ...s })).sort((a, b) => String(a.position_id).localeCompare(String(b.position_id)) || ((a.rank || 999) - (b.rank || 999))); },
    async listStandbyForApp(applicationId) { return standby.filter((s) => s.application_id === applicationId).map((s) => ({ ...s })); },
    async getStandby(id) { const s = standby.find((x) => x.id === id); return s ? { ...s } : null; },
    async upsertStandby({ event_id, application_id, position_id, rank, state, created_by }) {
      let s = standby.find((x) => x.application_id === application_id && x.position_id === position_id);
      if (s) { s.rank = rank == null ? null : rank; if (state) s.state = state; }
      else { s = { id: 'sb-' + (++seq), event_id, application_id, position_id, rank: rank == null ? null : rank, state: state || 'offered', offered_at: now(), responded_at: null, created_by: created_by || null, created_at: now() }; standby.push(s); }
      return { id: s.id };
    },
    async updateStandby(id, patch) { const s = standby.find((x) => x.id === id); if (s) Object.assign(s, patch); },
    async deleteStandby(id) { const i = standby.findIndex((x) => x.id === id); if (i >= 0) standby.splice(i, 1); },
    // ---- Substitution history (riwayat pergantian) ----
    async listSubstitutions(eventId) { return substitutions.filter((s) => s.event_id === eventId).map((s) => ({ ...s })).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))); },
    async getSubstitution(id) { const s = substitutions.find((x) => x.id === id); return s ? { ...s } : null; },
    async createSubstitution(row) { const rec = { id: 'sub-' + (++seq), state: 'offered', offered_at: now(), responded_at: null, deadline_at: null, created_by: null, created_at: now(), ...row }; substitutions.push(rec); return { id: rec.id }; },
    async updateSubstitution(id, patch) { const s = substitutions.find((x) => x.id === id); if (s) Object.assign(s, patch); },
    async offerSubstituteTxn({ event_id, position_id, outgoing_application_id, incoming_application_id, from_position_id, deadline_at, created_by }) {
      if (applicationChoices.some((c) => c.application_id === incoming_application_id && c.accepted)) return null;
      if (substitutions.some((s) => s.event_id === event_id && s.position_id === position_id && s.outgoing_application_id === outgoing_application_id && s.state === 'offered')) return null;
      const rec = { id: 'sub-' + (++seq), event_id, position_id, outgoing_application_id, incoming_application_id, from_position_id: from_position_id || null, state: 'offered', offered_at: now(), responded_at: null, deadline_at: deadline_at || null, created_by: created_by || null, created_at: now() };
      substitutions.push(rec);
      standby.forEach((s) => { if (s.application_id === incoming_application_id && s.position_id === from_position_id) s.state = 'called'; });
      return rec.id;
    },
    async confirmSubstituteTxn(subId, actorId) {
      const sub = substitutions.find((s) => s.id === subId);
      if (!sub || sub.state !== 'offered') return 'skip';
      if (sub.deadline_at && new Date() > new Date(sub.deadline_at)) { sub.state = 'expired'; sub.responded_at = now(); return 'expired'; }
      const app = applications.find((a) => a.id === sub.incoming_application_id);
      if (!app) return 'skip';
      if (applicationChoices.some((c) => c.application_id === app.id && c.accepted)) return 'skip';
      const mine = applicationChoices.filter((c) => c.application_id === app.id);
      mine.forEach((c) => { c.accepted = false; c.outcome = null; });
      const has = mine.find((c) => c.position_id === sub.position_id);
      if (has) { has.accepted = true; has.outcome = 'accepted'; }
      else if (mine.length < 3) { applicationChoices.push({ id: 'ac-' + (++seq), application_id: app.id, position_id: sub.position_id, priority: mine.length + 1, accepted: true, outcome: 'accepted' }); }
      else { const top = mine.reduce((m, c) => (c.priority > m.priority ? c : m), mine[0]); top.position_id = sub.position_id; top.accepted = true; top.outcome = 'accepted'; }
      statusLog.push({ id: 'sl-' + (++seq), application_id: app.id, from_status: app.status, to_status: 'approved', changed_by: actorId || null, changed_at: now() });
      Object.assign(app, { status: 'approved', confirmed_at: now(), reviewed_by: actorId || null, reviewed_at: now() });
      sub.state = 'confirmed'; sub.responded_at = now();
      standby.forEach((s) => { if (s.application_id === app.id) s.state = 'confirmed'; });
      return 'ok';
    },
    // ---- EO notifications (pemberitahuan aktif) ----
    async listEoNotifications(staffId, { unreadOnly } = {}) { return eoNotifications.filter((n) => n.staff_id === staffId && (!unreadOnly || !n.read_at)).map((n) => ({ ...n })).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))); },
    async createEoNotification(row) { const rec = { id: 'eon-' + (++seq), data: null, read_at: null, created_at: now(), ...row }; eoNotifications.push(rec); return { id: rec.id }; },
    async markEoNotificationRead(id) { const n = eoNotifications.find((x) => x.id === id); if (n) n.read_at = now(); },
    // ---- Attendance ----
    async listAttendanceForEvent(eventId) { return attendance.filter((a) => a.event_id === eventId).map((a) => ({ ...a })); },
    async listAttendanceForTalent(talentId) { return attendance.filter((a) => a.talent_id === talentId).map((a) => ({ ...a })); },
    async getAttendanceById(id) { const a = attendance.find((x) => x.id === id); return a ? { ...a } : null; },
    async getAttendance(applicationId, eventDay) { const a = attendance.find((x) => x.application_id === applicationId && x.event_day === eventDay); return a ? { ...a } : null; },
    async upsertAttendance(row) {
      let a = attendance.find((x) => x.application_id === row.application_id && x.event_day === row.event_day);
      if (a) { Object.assign(a, row, { updated_at: now() }); }
      else { a = Object.assign({ id: 'att-' + (++seq), status: null, note: null, marked_by_name: null, marked_by_staff: null, marked_at: null, is_emergency: false, emergency_by: null, emergency_reason: null, emergency_at: null, created_at: now(), updated_at: now() }, row); attendance.push(a); }
      return { ...a };
    },
    async updateAttendance(id, patch) { const a = attendance.find((x) => x.id === id); if (a) Object.assign(a, patch, { updated_at: now() }); },
    async addAttendanceLog(row) { attendanceLog.push(Object.assign({ id: 'atl-' + (++seq), changed_at: now() }, row)); },
    async listAttendanceLog(attendanceId) { return attendanceLog.filter((x) => x.attendance_id === attendanceId).map((x) => ({ ...x })).sort((a, b) => String(a.changed_at).localeCompare(String(b.changed_at))); },
    async listAttendanceLogsForEvent(eventId) { const ids = new Set(attendance.filter((a) => a.event_id === eventId).map((a) => a.id)); return attendanceLog.filter((x) => ids.has(x.attendance_id)).map((x) => ({ ...x })).sort((a, b) => String(a.changed_at).localeCompare(String(b.changed_at))); },
    // ---- Attendance link ----
    async createAttendanceLink(row) { const rec = Object.assign({ id: 'alk-' + (++seq), created_by: null, created_at: now(), revoked_at: null }, row); attendanceLinks.push(rec); return { ...rec }; },
    async getAttendanceLinkByToken(token) { const l = attendanceLinks.find((x) => x.token === token && !x.revoked_at); return l ? { ...l } : null; },
    async getAttendanceLinkForEvent(eventId) { const l = attendanceLinks.filter((x) => x.event_id === eventId && !x.revoked_at).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0]; return l ? { ...l } : null; },
    async revokeAttendanceLink(id) { const l = attendanceLinks.find((x) => x.id === id); if (l) l.revoked_at = now(); },
    // ---- Corrections ----
    async createCorrection(row) { const rec = Object.assign({ id: 'cor-' + (++seq), state: 'pending', decided_by: null, decided_at: null, decision_note: null, created_at: now() }, row); corrections.push(rec); return { ...rec }; },
    async listCorrections({ state } = {}) { return corrections.filter((c) => !state || c.state === state).map((c) => ({ ...c })).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))); },
    async listCorrectionsForTalent(talentId) { return corrections.filter((c) => c.talent_id === talentId).map((c) => ({ ...c })).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))); },
    async getCorrection(id) { const c = corrections.find((x) => x.id === id); return c ? { ...c } : null; },
    async updateCorrection(id, patch) { const c = corrections.find((x) => x.id === id); if (c) Object.assign(c, patch); },
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
