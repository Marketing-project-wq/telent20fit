-- NOT APPLIED YET — and must NOT be run on its own.
--
-- Renames the talent_type values 'main_power' -> 'manpower' and
-- 'fotografer' -> 'photographer' in every table that has the column, and locks
-- the column to 'kol' | 'photographer' | 'manpower'.
--
-- The app code compares against the OLD values in ~60 places (auth.js
-- TALENT_TYPES / session cookie names, legacy Man Power routes, certificate
-- rule, review tabs, dashboard counts). Run this ONLY in the same release as the
-- code change that switches those comparisons, otherwise Man Power logins and
-- the legacy certificate rule break.
--
-- Rows affected today (13 Oct 2026): talent_accounts 1 ('main_power');
-- talent_applications / assignments / needs / proofs: 0 rows with old values.

begin;

alter table public.talent_accounts          drop constraint if exists talent_accounts_talent_type_check;
alter table public.talent_applications      drop constraint if exists talent_applications_type_chk;
alter table public.talent_event_assignments drop constraint if exists talent_event_assignments_type_chk;
alter table public.talent_event_needs       drop constraint if exists talent_event_needs_talent_type_check;
alter table public.talent_post_proofs       drop constraint if exists talent_post_proofs_type_chk;

update public.talent_accounts          set talent_type = case talent_type when 'main_power' then 'manpower' when 'fotografer' then 'photographer' end where talent_type in ('main_power', 'fotografer');
update public.talent_applications      set talent_type = case talent_type when 'main_power' then 'manpower' when 'fotografer' then 'photographer' end where talent_type in ('main_power', 'fotografer');
update public.talent_event_assignments set talent_type = case talent_type when 'main_power' then 'manpower' when 'fotografer' then 'photographer' end where talent_type in ('main_power', 'fotografer');
update public.talent_event_needs       set talent_type = case talent_type when 'main_power' then 'manpower' when 'fotografer' then 'photographer' end where talent_type in ('main_power', 'fotografer');
update public.talent_post_proofs       set talent_type = case talent_type when 'main_power' then 'manpower' when 'fotografer' then 'photographer' end where talent_type in ('main_power', 'fotografer');

alter table public.talent_applications alter column talent_type set default 'manpower';

alter table public.talent_accounts          add constraint talent_accounts_talent_type_check   check (talent_type in ('kol', 'photographer', 'manpower'));
alter table public.talent_applications      add constraint talent_applications_type_chk        check (talent_type in ('kol', 'photographer', 'manpower'));
alter table public.talent_event_assignments add constraint talent_event_assignments_type_chk   check (talent_type in ('kol', 'photographer', 'manpower'));
alter table public.talent_event_needs       add constraint talent_event_needs_talent_type_check check (talent_type in ('kol', 'photographer', 'manpower'));
alter table public.talent_post_proofs       add constraint talent_post_proofs_type_chk         check (talent_type in ('kol', 'photographer', 'manpower'));

commit;
