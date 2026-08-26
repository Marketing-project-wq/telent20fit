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
// English is the default UI language: a new visitor with no saved preference sees
// EN, and any unrecognised/absent lang coerces to EN (never a mixed ID/EN page).
const DEFAULT = 'en';

function normLang(l) {
  return l === 'id' ? 'id' : 'en';
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
