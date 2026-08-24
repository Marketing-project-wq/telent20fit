'use strict';

/**
 * Minimal talent authentication: scrypt password hashing + stateless
 * HMAC-signed session cookie. No external auth service needed.
 */

const crypto = require('crypto');

const SECRET = process.env.SESSION_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || 'dev-insecure-secret';
// One cookie PER account type, so a Super Admin, an EO and a Talent can each be
// signed in at the same time (different tabs) without clobbering each other.
// Logging into one area only replaces that area's own cookie.
const COOKIE_PREFIX = 'ts_';
const LEGACY_COOKIE = 'tsid';
const TALENT_TYPES = ['kol', 'main_power', 'fotografer'];
const STAFF_TYPES = ['super_admin', 'eo'];
const ALL_TYPES = TALENT_TYPES.concat(STAFF_TYPES);
function cookieName(type) { return COOKIE_PREFIX + type; }
const MAX_AGE_MS = 60 * 24 * 3600 * 1000; // 60 days — rolling (see touchSession)

// Persistent cookie so the login survives closing tabs, the browser, and
// reboots. `secure` only in production (Railway is HTTPS); left off locally so
// http testing still works.
function cookieOptions() {
  return { httpOnly: true, sameSite: 'lax', maxAge: MAX_AGE_MS, path: '/', secure: process.env.NODE_ENV === 'production' };
}

function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(pw), salt, 64).toString('hex');
  return salt + ':' + hash;
}

function verifyPassword(pw, stored) {
  if (!stored || stored.indexOf(':') < 0) return false;
  const [salt, hash] = stored.split(':');
  let h;
  try { h = crypto.scryptSync(String(pw), salt, 64).toString('hex'); } catch { return false; }
  const a = Buffer.from(h, 'hex');
  const b = Buffer.from(hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// token = base64url(JSON payload) + "." + base64url(HMAC-SHA256)
function sign(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const mac = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  return body + '.' + mac;
}

function unsign(token) {
  if (!token || typeof token !== 'string' || token.indexOf('.') < 0) return null;
  const [body, mac] = token.split('.');
  const expected = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (payload.exp && Date.now() > payload.exp) return null;
    return payload;
  } catch { return null; }
}

function setSession(res, account) {
  // Talents carry talent_type; staff carry role. Both become the session "type",
  // which selects the per-type cookie so areas don't overwrite one another.
  const type = account.talent_type || account.role;
  const token = sign({ id: account.id, type, name: account.name, exp: Date.now() + MAX_AGE_MS });
  res.cookie(cookieName(type), token, cookieOptions());
}

// Read+verify the session cookie for one specific type; null if absent/invalid.
function sessionFor(req, type) {
  const raw = req.cookies ? req.cookies[cookieName(type)] : null;
  const p = unsign(raw);
  return (p && p.type === type) ? p : null;
}
// First valid session among the given types (talent-first via ALL_TYPES order).
function anySession(req, types) {
  for (const ty of types) { const p = sessionFor(req, ty); if (p) return p; }
  return null;
}

// Rolling session: on each request, refresh every still-valid session cookie
// present (any area) with a fresh 60-day window. So an account that keeps being
// used never gets logged out on its own — only an explicit logout clears it.
function touchSession(req, res) {
  if (!req.cookies) return;
  for (const ty of ALL_TYPES) {
    const p = sessionFor(req, ty);
    if (p) res.cookie(cookieName(ty), sign({ id: p.id, type: p.type, name: p.name, exp: Date.now() + MAX_AGE_MS }), cookieOptions());
  }
}

// Clear one type, an array of types, or (no arg) every session + the legacy cookie.
function clearSession(res, type) {
  const types = type == null ? ALL_TYPES : (Array.isArray(type) ? type : [type]);
  types.forEach((ty) => res.clearCookie(cookieName(ty), { path: '/' }));
  if (type == null) res.clearCookie(LEGACY_COOKIE, { path: '/' });
}

// Per-event attendance access token: a stable HMAC of the event id. The admin
// shares the link (/absensi/:eventId?k=<token>) with an on-site PIC who can then
// check people in without a full admin login. No DB column needed.
function attendanceToken(eventId) {
  return crypto.createHmac('sha256', SECRET).update('attend:' + String(eventId)).digest('base64url').slice(0, 24);
}
function verifyAttendanceToken(eventId, token) {
  if (!token) return false;
  const expected = attendanceToken(eventId);
  const a = Buffer.from(String(token));
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Compat: any current session (talent-first). Prefer sessionFor/anySession.
function currentTalent(req) { return anySession(req, ALL_TYPES); }

/** Middleware: require a logged-in talent of the given type, else the unified talent login. */
function requireTalent(type) {
  return (req, res, next) => {
    const t = sessionFor(req, type);
    if (t) { req.talent = t; return next(); }
    res.redirect('/login');
  };
}

/** Middleware: require a logged-in staff member whose role is in `roles`, else /admin/login. */
function requireStaff(roles, loginPath) {
  return (req, res, next) => {
    const t = anySession(req, roles);
    if (t) { req.staff = t; return next(); }
    res.redirect(loginPath || '/admin/login');
  };
}

module.exports = { hashPassword, verifyPassword, setSession, touchSession, clearSession, sessionFor, anySession, currentTalent, requireTalent, requireStaff, attendanceToken, verifyAttendanceToken, TALENT_TYPES, STAFF_TYPES };
