-- Two-layer applicant selection (reviewer proposals → final decision).
-- Applied to Supabase project "20FIT ALL DATA" (cpvzwqptzcxnwzfzgrmt) on 2026-09-04.
-- ADDITIVE ONLY: creates two new tables and adds one nullable column to the
-- (previously empty) status-log table. It does NOT read, alter, or delete any
-- row of talent_applications / talent_application_choices / talent_accounts.
--
-- Backup taken before applying (server-side copies, still in the DB):
--   zz_backup_talent_applications_20260904
--   zz_backup_talent_application_choices_20260904
--   zz_backup_talent_accounts_20260904

-- LAPIS 1: reviewer proposals (a recommendation only — no status change, no email).
CREATE TABLE IF NOT EXISTS talent_application_proposals (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES talent_applications(id) ON DELETE CASCADE,
  position_id    uuid NOT NULL REFERENCES talent_positions(id),
  reviewer_name  text NOT NULL,
  note           text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (application_id, position_id, reviewer_name)
);
CREATE INDEX IF NOT EXISTS idx_tap_application ON talent_application_proposals(application_id);
ALTER TABLE talent_application_proposals ENABLE ROW LEVEL SECURITY;

-- LAPIS 1: optional "reviewed but not proposed" marker, per (application, reviewer).
CREATE TABLE IF NOT EXISTS talent_application_reviews (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES talent_applications(id) ON DELETE CASCADE,
  reviewer_name  text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (application_id, reviewer_name)
);
CREATE INDEX IF NOT EXISTS idx_tar_application ON talent_application_reviews(application_id);
ALTER TABLE talent_application_reviews ENABLE ROW LEVEL SECURITY;

-- LAPIS 2: record the meeting operator's typed name on final decisions.
ALTER TABLE talent_application_status_log ADD COLUMN IF NOT EXISTS actor_name text;
