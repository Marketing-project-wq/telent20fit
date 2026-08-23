-- Tahap 1 — Offer/confirmation lifecycle for talent acceptance.
-- Applied to Supabase project cpvzwqptzcxnwzfzgrmt on 2026-08-23.
-- Additive + reversible. No existing data is dropped by the UP migration.
--
-- Reused (already present, NOT recreated here):
--   talent_event_standby            -- cadangan + nomor urut (rank) + state
--   talent_substitution             -- manual pengganti + deadline_at/reminded_at
--   talent_application_status_log   -- riwayat perubahan status (from/to/by/at)

-- ============================ UP ============================
alter table talent_applications
  add column if not exists offer_state         text,        -- NULL | offered | confirmed | declined | lapsed
  add column if not exists offered_at          timestamptz, -- when the EO made the offer (accept moment)
  add column if not exists offer_sent_at       timestamptz, -- when the offer EMAIL was sent OK -> deadline anchor
  add column if not exists offer_deadline      timestamptz, -- min(offer_sent_at + 48h, eventStart - 12h)
  add column if not exists offer_reminded_at   timestamptz, -- 12h pre-deadline reminder sent once
  add column if not exists offer_decline_reason text,       -- talent's reason if they decline
  add column if not exists offer_decline_note  text,        -- free-text note with the decline
  add column if not exists offer_resolved_at   timestamptz; -- when confirmed / declined / lapsed

create index if not exists idx_talent_applications_offer_open
  on talent_applications (offer_deadline)
  where offer_state = 'offered';

update talent_applications
   set offer_state       = 'confirmed',
       offered_at        = coalesce(offered_at, reviewed_at, created_at),
       offer_resolved_at = coalesce(confirmed_at, reviewed_at, now())
 where status = 'approved' and offer_state is null;

-- ============================ DOWN ============================
-- Rollback (drops only the columns/index this migration added):
-- drop index if exists idx_talent_applications_offer_open;
-- alter table talent_applications
--   drop column if exists offer_state,
--   drop column if exists offered_at,
--   drop column if exists offer_sent_at,
--   drop column if exists offer_deadline,
--   drop column if exists offer_reminded_at,
--   drop column if exists offer_decline_reason,
--   drop column if exists offer_decline_note,
--   drop column if exists offer_resolved_at;
