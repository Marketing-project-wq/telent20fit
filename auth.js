'use strict';

/**
 * Minimal talent authentication: scrypt password hashing + stateless
 * HMAC-signed session cookie. No external auth service needed.
 */

const crypto = require('crypto');

const SECRET = process.env.SESSION_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || 'dev-insecure-secret';
const COOKIE = 'tsid';
const MAX_AGE_MS = 30 * 24 * 3600 * 1000; // 30 days

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
  // Talents carry talent_type; staff carry role. Both become the session "type".
  const type = account.talent_type || account.role;
  const token = sign({ id: account.id, type, name: account.name, exp: Date.now() + MAX_AGE_MS });
  res.cookie(COOKIE, token, { httpOnly: true, sameSite: 'lax', maxAge: MAX_AGE_MS, path: '/' });
}

function clearSession(res) { res.clearCookie(COOKIE, { path: '/' }); }

function currentTalent(req) { return unsign(req.cookies ? req.cookies[COOKIE] : null); }

/** Middleware: require a logged-in talent of the given type, else redirect to its login. */
function requireTalent(type) {
  const loginPath = '/' + type.replace(/_/g, '-') + '/login';
  return (req, res, next) => {
    const t = currentTalent(req);
    if (t && t.type === type) { req.talent = t; return next(); }
    res.redirect(loginPath);
  };
}

/** Middleware: require a logged-in staff member whose role is in `roles`, else /admin/login. */
function requireStaff(roles) {
  return (req, res, next) => {
    const t = currentTalent(req);
    if (t && roles.includes(t.type)) { req.staff = t; return next(); }
    res.redirect('/admin/login');
  };
}

module.exports = { hashPassword, verifyPassword, setSession, clearSession, currentTalent, requireTalent, requireStaff, COOKIE };
