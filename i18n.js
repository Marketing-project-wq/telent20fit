'use strict';

/**
 * Minimal key-based i18n for the server-rendered app.
 * Translations live in ./i18n/en.json and ./i18n/id.json (key -> string).
 * t(lang, key, vars) looks up the key, falls back to ID then to the raw key,
 * and interpolates {placeholder} tokens from `vars`.
 */

const en = require('./i18n/en.json');
const id = require('./i18n/id.json');
const DICT = { en, id };
const DEFAULT = 'id';

function normLang(l) {
  return l === 'en' ? 'en' : 'id';
}

function t(lang, key, vars) {
  const d = DICT[normLang(lang)] || DICT[DEFAULT];
  let s = (d && d[key] != null) ? d[key] : (DICT[DEFAULT][key] != null ? DICT[DEFAULT][key] : key);
  if (vars) {
    for (const k in vars) s = String(s).split('{' + k + '}').join(vars[k]);
  }
  return s;
}

module.exports = { t, normLang, LANGS: ['id', 'en'] };
