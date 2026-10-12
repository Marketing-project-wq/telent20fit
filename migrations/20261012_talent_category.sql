-- Talent category per position + talent_type CHECKs. Additive only: no account,
-- application or choice rows are modified. A talent's category is derived from the
-- positions they applied for (talent_application_choices -> talent_positions).

-- A) Category of each position: 'kol' | 'photographer' | 'manpower'
ALTER TABLE talent_positions ADD COLUMN IF NOT EXISTS talent_category text;
UPDATE talent_positions SET talent_category = CASE
    WHEN key = 'kol' THEN 'kol'
    WHEN key IN ('fotografer', 'videografer') THEN 'photographer'
    ELSE 'manpower' END
  WHERE talent_category IS NULL;
ALTER TABLE talent_positions ALTER COLUMN talent_category SET DEFAULT 'manpower';
ALTER TABLE talent_positions ALTER COLUMN talent_category SET NOT NULL;
ALTER TABLE talent_positions DROP CONSTRAINT IF EXISTS talent_positions_category_chk;
ALTER TABLE talent_positions ADD CONSTRAINT talent_positions_category_chk
  CHECK (talent_category IN ('kol', 'photographer', 'manpower'));
CREATE INDEX IF NOT EXISTS idx_talent_positions_category ON talent_positions (talent_category);

-- B) talent_type CHECK on the tables that don't have one yet. Values = the ones the
--    app uses (auth.TALENT_TYPES); talent_accounts and talent_event_needs already
--    carry the same constraint. NOT VALID + VALIDATE: fails without changes if any
--    existing row doesn't comply.
ALTER TABLE talent_applications DROP CONSTRAINT IF EXISTS talent_applications_type_chk;
ALTER TABLE talent_applications ADD CONSTRAINT talent_applications_type_chk
  CHECK (talent_type IN ('kol', 'main_power', 'fotografer')) NOT VALID;
ALTER TABLE talent_applications VALIDATE CONSTRAINT talent_applications_type_chk;
ALTER TABLE talent_event_assignments DROP CONSTRAINT IF EXISTS talent_event_assignments_type_chk;
ALTER TABLE talent_event_assignments ADD CONSTRAINT talent_event_assignments_type_chk
  CHECK (talent_type IN ('kol', 'main_power', 'fotografer')) NOT VALID;
ALTER TABLE talent_event_assignments VALIDATE CONSTRAINT talent_event_assignments_type_chk;
ALTER TABLE talent_post_proofs DROP CONSTRAINT IF EXISTS talent_post_proofs_type_chk;
ALTER TABLE talent_post_proofs ADD CONSTRAINT talent_post_proofs_type_chk
  CHECK (talent_type IN ('kol', 'main_power', 'fotografer')) NOT VALID;
ALTER TABLE talent_post_proofs VALIDATE CONSTRAINT talent_post_proofs_type_chk;

-- Index for category lookups through the picks
CREATE INDEX IF NOT EXISTS idx_app_choices_position ON talent_application_choices (position_id);
