'use strict';

/**
 * Optional integration with the 20FIT app's authentication API.
 *
 * When APP_API_URL and APP_API_TOKEN are both set, a talent sign-in is also
 * checked against the main 20FIT app account directory — so anyone who already
 * has a 20FIT app account can sign in here with the very same credentials, and
 * we mirror them into a local talent account so the rest of the site works.
 *
 * When either var is missing this module is inert (`isConfigured()` is false)
 * and login falls back to the local talent accounts exactly as before, so
 * nothing changes until the API is configured in Railway. Credentials live in
 * environment variables only — never hard-code the token.
 *
 * Contract (from the app API docs):
 *   POST {APP_API_URL}/api/v1/auth/login
 *   headers: Authorization: Bearer {APP_API_TOKEN}
 *            Content-Type: application/json
 *   body:    { "email": ..., "password": ..., "login_source": "app" }
 *   200 -> credentials valid.
 */

const BASE = String(process.env.APP_API_URL || '').replace(/\/+$/, '');
const TOKEN = String(process.env.APP_API_TOKEN || '');
const LOGIN_SOURCE = String(process.env.APP_API_LOGIN_SOURCE || 'app');
const TIMEOUT_MS = Number(process.env.APP_API_TIMEOUT_MS || 8000);
const LOGIN_PATH = '/api/v1/auth/login';

function isConfigured() { return !!(BASE && TOKEN); }

// Best-effort pull of a display name / email / phone out of whatever shape the
// API returns (fields at the top level, under `user`, or under `data` — the
// 20FIT app puts them under `data`). We only need these to seed the local
// talent account; everything is optional.
function pickUser(body) {
  const u = (body && (body.user || (body.data && (body.data.user || body.data)) || body)) || {};
  if (typeof u !== 'object') return { name: null, email: null, phone: null };
  const name = u.name || u.full_name || u.fullname || u.display_name || u.username || null;
  const email = u.email || null;
  const phone = u.phone || u.phone_number || u.mobile || null;
  return {
    name: name ? String(name).trim().slice(0, 200) : null,
    email: email ? String(email).trim() : null,
    phone: (phone != null && String(phone).trim()) ? String(phone).trim().slice(0, 40) : null,
  };
}

// A few APIs answer 200 with an explicit failure flag rather than a 4xx; treat
// those as a failed login too. We stay conservative so a normal success body
// (which may carry a token/user and no such flags) is never misread as failure.
function looksFailed(body) {
  if (!body || typeof body !== 'object') return false;
  if (body.success === false || body.ok === false) return true;
  if (typeof body.status === 'string' && /^(error|fail(ed)?|unauthori[sz]ed)$/i.test(body.status)) return true;
  if (body.error && !body.user && !body.data && !body.token && !body.access_token) return true;
  return false;
}

/**
 * Verify one email+password against the app API.
 * Returns { ok, configured, status?, user?, error? }. `ok` is true only when the
 * app confirms the credentials. Any network/timeout failure resolves to
 * { ok:false } — the app API can never take down local login.
 */
async function login(email, password) {
  if (!isConfigured()) return { ok: false, configured: false };
  if (!email || !password) return { ok: false, configured: true, status: 0 };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(BASE + LOGIN_PATH, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + TOKEN,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({ email, password, login_source: LOGIN_SOURCE }),
      signal: ctrl.signal,
    });
    let body = null;
    try { body = await r.json(); } catch (_) { /* non-JSON body is acceptable */ }
    if (!r.ok) return { ok: false, configured: true, status: r.status };
    if (looksFailed(body)) return { ok: false, configured: true, status: r.status };
    return { ok: true, configured: true, status: r.status, user: pickUser(body || {}) };
  } catch (e) {
    return { ok: false, configured: true, error: (e && (e.code || e.name)) || 'request_failed' };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { isConfigured, login };
