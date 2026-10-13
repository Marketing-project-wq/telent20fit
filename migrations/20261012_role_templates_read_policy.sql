-- OPTIONAL — NOT REQUIRED BY THE APP. Do not run unless a browser-side
-- (anon-key) Supabase client is actually introduced.
--
-- talent.20fit.id reads role_templates / talent_positions on the server with
-- SUPABASE_SERVICE_ROLE_KEY (store.js), which bypasses RLS, so these tables
-- work today with RLS on and no policies. Adding these opens read access to
-- anyone holding the project's public anon key (the project is shared by many
-- apps). Read-only: no INSERT/UPDATE/DELETE policies on purpose.

alter table public.role_templates enable row level security;
alter table public.talent_positions enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'role_templates' and policyname = 'role_templates_read') then
    create policy role_templates_read on public.role_templates
      for select to anon, authenticated using (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'talent_positions' and policyname = 'talent_positions_read') then
    create policy talent_positions_read on public.talent_positions
      for select to anon, authenticated using (true);
  end if;
end $$;
