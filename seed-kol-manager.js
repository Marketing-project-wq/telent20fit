'use strict';

const auth = require('./auth');

async function main() {
  const { createClient } = require('@supabase/supabase-js');
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) { console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY'); process.exit(1); }
  const sb = createClient(url, key);

  const login = 'kol_manager';
  const password = 'KolMgr_2026!';

  const { data: existing } = await sb.from('staff_accounts').select('id').eq('login', login).maybeSingle();
  if (existing) { console.log('KOL Manager account already exists (id: %s)', existing.id); return; }

  const { data, error } = await sb.from('staff_accounts').insert({
    role: 'kol_manager',
    name: 'KOL Manager',
    login,
    password_hash: auth.hashPassword(password),
    status: 'active',
    email_verified_at: new Date().toISOString(),
  }).select('id').maybeSingle();

  if (error) { console.error('Failed:', error.message); process.exit(1); }
  console.log('KOL Manager account created (id: %s)', data.id);
  console.log('  Login: %s', login);
  console.log('  Password: %s', password);
}

main().catch((e) => { console.error(e); process.exit(1); });
