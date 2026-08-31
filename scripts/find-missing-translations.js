#!/usr/bin/env node
'use strict';

/**
 * Read-only audit: lists every role/position whose ID or EN text is missing
 * for a translatable field, so a human can fill them in (per the project's
 * i18n policy, nothing here is auto-translated or guessed).
 *
 * Needs SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in the environment (the
 * same ones server.js/store.js use) pointed at the database you want to
 * audit — this does NOT write anything, only SELECTs.
 *
 * Run manually: node scripts/find-missing-translations.js
 */

const { createClient } = require('@supabase/supabase-js');

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set — point this at the database you want to audit and re-run.');
  process.exit(1);
}
const sb = createClient(url, key, { auth: { persistSession: false } });

const empty = (v) => v == null || String(v).trim() === '';

// [displayField, idColumn, enColumn]
const POSITION_FIELDS = [
  ['name (custom "Lainnya" only)', 'custom_label', 'custom_label_en'],
  ['description', 'description', 'description_en'],
  ['jobdesk', 'jobdesk', 'jobdesk_en'],
  ['requirement', 'requirement', 'requirement_en'],
];

async function main() {
  const rows = [];

  // Master role names.
  {
    const { data, error } = await sb.from('talent_positions').select('id,key,label_id,label_en');
    if (error) throw error;
    (data || []).forEach((p) => {
      const missing = [empty(p.label_id) && 'id', empty(p.label_en) && 'en'].filter(Boolean);
      if (missing.length) rows.push({ table: 'talent_positions', id: p.id, label: p.key, field: 'name (label)', missing: missing.join('+') });
    });
  }

  // Per-event position content — join event + role name so the list is
  // actually usable (an id alone doesn't tell a human which card to fix).
  {
    const { data, error } = await sb.from('talent_event_positions')
      .select('id,event_id,custom_label,custom_label_en,description,description_en,jobdesk,jobdesk_en,requirement,requirement_en,talent_positions(key,label_id,label_en),talent_events(name)');
    if (error) throw error;
    (data || []).forEach((p) => {
      const roleKey = (p.talent_positions && p.talent_positions.key) || '?';
      const roleName = (p.talent_positions && (p.talent_positions.label_en || p.talent_positions.label_id)) || roleKey;
      const eventName = (p.talent_events && p.talent_events.name) || p.event_id;
      POSITION_FIELDS.forEach(([display, idCol, enCol]) => {
        if (idCol === 'custom_label' && roleKey !== 'other') return; // only the "Lainnya" slot uses custom_label
        const idEmpty = empty(p[idCol]);
        const enEmpty = empty(p[enCol]);
        if (!idEmpty && !enEmpty) return;
        const missing = [idEmpty && 'id', enEmpty && 'en'].filter(Boolean);
        rows.push({
          table: 'talent_event_positions', id: p.id, label: `${eventName} — ${roleName}`,
          field: display, missing: missing.join('+'),
          note: (idEmpty && enEmpty) ? 'BOTH EMPTY — card falls back to role template if one exists, else shows nothing' : 'one side empty — the other language currently borrows this text (⚠️ marker + console.warn on render)',
        });
      });
    });
  }

  if (!rows.length) {
    console.log('No missing translations found — every role/position has both id and en filled in.');
    return;
  }

  console.log(`${rows.length} field(s) missing a translation:\n`);
  rows.forEach((r) => {
    console.log(`[${r.table}] ${r.label} — ${r.field} — missing: ${r.missing}${r.note ? '  (' + r.note + ')' : ''} (row id: ${r.id})`);
  });
  console.log(`\n${rows.length} total. Fill these in via the EO event form (or Supabase directly for talent_positions);`);
  console.log('this script does not write anything — nothing here is auto-translated.');
}

main().catch((e) => { console.error('Audit failed:', e.message); process.exit(1); });
