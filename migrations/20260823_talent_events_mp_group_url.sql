-- One Man Power group link per event, shown on the talent dashboard (not email).
-- Applied to Supabase project cpvzwqptzcxnwzfzgrmt on 2026-08-23. Additive + reversible.

-- UP:
alter table talent_events add column if not exists mp_group_url text;

-- DOWN:
-- alter table talent_events drop column if exists mp_group_url;
