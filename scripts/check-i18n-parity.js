#!/usr/bin/env node
'use strict';

/**
 * Fails (non-zero exit) if i18n/en.json and i18n/id.json don't have the exact
 * same set of keys, or if any value is an empty string. This is the guard
 * against the class of bug where a key gets added to one locale file and
 * forgotten in the other — i18n.t() silently falls back to English in that
 * case (see i18n.js), so it would otherwise ship unnoticed straight into a
 * mixed-language page.
 *
 * Run manually: node scripts/check-i18n-parity.js
 * Wired into: npm run lint / npm run build (see package.json)
 */

const en = require('../i18n/en.json');
const id = require('../i18n/id.json');

const enKeys = new Set(Object.keys(en));
const idKeys = new Set(Object.keys(id));

const missingInId = [...enKeys].filter((k) => !idKeys.has(k)).sort();
const missingInEn = [...idKeys].filter((k) => !enKeys.has(k)).sort();
const emptyInEn = Object.keys(en).filter((k) => en[k] === '').sort();
const emptyInId = Object.keys(id).filter((k) => id[k] === '').sort();

let ok = true;

function report(title, keys) {
  if (!keys.length) return;
  ok = false;
  console.error(`\n${title} (${keys.length}):`);
  keys.forEach((k) => console.error('  - ' + k));
}

report('Keys present in en.json but MISSING from id.json', missingInId);
report('Keys present in id.json but MISSING from en.json', missingInEn);
report('Keys with an EMPTY string value in en.json', emptyInEn);
report('Keys with an EMPTY string value in id.json', emptyInId);

if (ok) {
  console.log(`i18n parity OK — ${enKeys.size} keys, identical in both locales, none empty.`);
  process.exit(0);
} else {
  console.error(`\ni18n parity FAILED. Fix the keys above before merging — an English/Indonesian`);
  console.error('page pair must have exactly the same key set with no empty values.');
  process.exit(1);
}
