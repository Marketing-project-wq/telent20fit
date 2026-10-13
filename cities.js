'use strict';

/**
 * Indonesian cities for the public "Location" filter. Each entry is the label
 * shown in the dropdown plus the words that identify it inside an event's free
 * "location" text (venue names and districts included, so e.g. a venue in
 * "Menteng" or "GBK" counts as Jakarta).
 */
const CITIES = [
  ['Jakarta', ['jakarta', 'menteng', 'senayan', 'gbk', 'gelora bung karno', 'kuningan', 'sudirman', 'thamrin', 'kemang', 'kebayoran', 'kelapa gading', 'pik', 'pantai indah kapuk', 'ancol', 'cilandak', 'pondok indah', 'cempaka putih', 'kemayoran']],
  ['Bogor', ['bogor', 'sentul']],
  ['Depok', ['depok']],
  ['Tangerang', ['tangerang', 'bsd', 'serpong', 'bintaro', 'alam sutera', 'karawaci', 'gading serpong']],
  ['Bekasi', ['bekasi']],
  ['Bandung', ['bandung']],
  ['Semarang', ['semarang']],
  ['Yogyakarta', ['yogyakarta', 'jogja', 'yogya', 'sleman', 'bantul']],
  ['Solo', ['solo', 'surakarta']],
  ['Surabaya', ['surabaya']],
  ['Malang', ['malang', 'batu']],
  ['Bali', ['bali', 'denpasar', 'ubud', 'kuta', 'seminyak', 'canggu', 'nusa dua', 'sanur', 'jimbaran']],
  ['Lombok', ['lombok', 'mataram', 'mandalika']],
  ['Medan', ['medan']],
  ['Padang', ['padang']],
  ['Pekanbaru', ['pekanbaru']],
  ['Batam', ['batam']],
  ['Palembang', ['palembang']],
  ['Bandar Lampung', ['lampung']],
  ['Pontianak', ['pontianak']],
  ['Balikpapan', ['balikpapan']],
  ['Samarinda', ['samarinda']],
  ['Banjarmasin', ['banjarmasin']],
  ['Makassar', ['makassar']],
  ['Manado', ['manado']],
  ['Kupang', ['kupang']],
  ['Ambon', ['ambon']],
  ['Jayapura', ['jayapura']],
];

const CITY_NAMES = CITIES.map(([name]) => name);

// Whole-word match so short words ("batu", "solo", "pik") don't hit inside other words.
const wordRe = (w) => new RegExp('(^|[^a-z])' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '([^a-z]|$)', 'i');
const MATCHERS = CITIES.map(([name, words]) => [name, words.map(wordRe)]);

/** The city an event location belongs to, or '' when none is recognised. */
function cityOfLocation(location) {
  const loc = String(location || '');
  const hit = MATCHERS.find(([, res]) => res.some((re) => re.test(loc)));
  return hit ? hit[0] : '';
}

/** True when the event location belongs to `city` (empty city = any). */
function locationInCity(location, city) {
  if (!city) return true;
  const c = String(city).trim().toLowerCase();
  const entry = MATCHERS.find(([name]) => name.toLowerCase() === c);
  if (entry) return entry[1].some((re) => re.test(String(location || '')));
  return String(location || '').toLowerCase().includes(c); // unknown city: plain text match
}

module.exports = { CITY_NAMES, cityOfLocation, locationInCity };
