#!/usr/bin/env node
'use strict';

/**
 * Heuristic scan for user-facing strings in views.js (and server.js) that
 * look hardcoded rather than routed through t()/tr(). This is NOT a hard
 * CI gate — it's a manual-run helper (no full JS/HTML parser here, on
 * purpose, to avoid a heavy dependency) that flags CANDIDATES for a human
 * to review. Expect some false positives (brand names, emoji, punctuation-
 * only fragments, SVG path data) — that's normal; the point is to narrow
 * down where to look, not to auto-fix anything.
 *
 * Run manually: node scripts/scan-hardcoded-strings.js
 * Optionally: node scripts/scan-hardcoded-strings.js path/to/file.js
 */

const fs = require('fs');
const path = require('path');

const files = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ['views.js', 'server.js'].map((f) => path.join(__dirname, '..', f));

// A run of letters (any script) with at least one lowercase-after-uppercase
// word boundary, i.e. looks like a real word/sentence rather than a class
// name, emoji, or all-caps acronym like "KOL"/"HYROX"/"CV".
const WORDY = /[A-Za-z]{3,}/;
const LIKELY_PROSE = /[a-z]{2,}\s[a-z]{2,}/i; // at least two space-separated words

// Attributes whose literal string value is user-visible (screen reader / tooltip
// / placeholder text) and therefore should be localized.
const USER_FACING_ATTRS = ['aria-label', 'title', 'placeholder', 'alt'];

// Lines matching any of these are almost certainly NOT user-facing prose —
// skip them outright to cut noise (CSS, SVG paths, class lists, URLs...).
const SKIP_LINE = [
  /^\s*[.#@]/, // CSS rules
  /<svg|<path|viewBox=|d="[Mm][\d.\-, ]/, // SVG markup
  /^\s*(const|let|var|function)\s/, // pure JS lines with no markup at all
  /https?:\/\//, // has a URL — usually href/src, not prose (still might miss inline anchor text, acceptable)
];

function scanFile(file) {
  if (!fs.existsSync(file)) return [];
  const rel = path.relative(process.cwd(), file);
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  const hits = [];

  lines.forEach((line, i) => {
    if (SKIP_LINE.some((re) => re.test(line))) return;
    // Already-localized line? (a t(...)/tr(...) call anywhere on it) — still
    // worth flagging OTHER literal text on the same line, but this cuts a
    // large fraction of false positives from mixed dynamic+static lines less
    // reliably, so we just lower confidence rather than skip entirely below.
    const looksLocalized = /\bt\(|\btr\(/.test(line);

    // 1) >literal text< between tags, not a template placeholder.
    const tagTextRe = />([^<>{}\n]{4,})</g;
    let m;
    while ((m = tagTextRe.exec(line))) {
      const text = m[1].trim();
      if (!text || !WORDY.test(text) || !LIKELY_PROSE.test(text)) continue;
      if (/^\$\{/.test(text)) continue; // pure interpolation
      hits.push({ file: rel, lineNo: i + 1, kind: 'tag-text', text, localizedLine: looksLocalized });
    }
    // 2) Hardcoded user-facing attributes: attr="literal text" (no ${ interpolation).
    USER_FACING_ATTRS.forEach((attr) => {
      const attrRe = new RegExp(attr + '="([^"$]{3,})"', 'g');
      let am;
      while ((am = attrRe.exec(line))) {
        const text = am[1].trim();
        if (!WORDY.test(text)) continue;
        hits.push({ file: rel, lineNo: i + 1, kind: attr, text, localizedLine: looksLocalized });
      }
    });
  });
  return hits;
}

const allHits = files.flatMap(scanFile);

if (!allHits.length) {
  console.log('No candidate hardcoded strings found.');
  process.exit(0);
}

console.log(`${allHits.length} candidate hardcoded string(s) — review each; many will be false positives\n` +
  '(brand names, values already built from t()/tr() elsewhere on a wrapping line, etc.):\n');
allHits.forEach((h) => {
  const flag = h.localizedLine ? ' [line also has t()/tr() — check if this bit was missed]' : '';
  console.log(`${h.file}:${h.lineNo}  [${h.kind}]  "${h.text}"${flag}`);
});
console.log(`\n${allHits.length} candidate(s) total. This is a heuristic aid, not a verdict — use judgement.`);
