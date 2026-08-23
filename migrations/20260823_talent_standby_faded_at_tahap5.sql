-- Tahap 5 (F8) — mark when an uncalled standby was told their chance is now
-- small (~H-2), so the courtesy email is sent at most once.
-- Applied to Supabase project cpvzwqptzcxnwzfzgrmt on 2026-08-23. Additive + reversible.

-- ============================ UP ============================
alter table talent_event_standby add column if not exists faded_at timestamptz;

-- ============================ DOWN ============================
-- alter table talent_event_standby drop column if exists faded_at;
