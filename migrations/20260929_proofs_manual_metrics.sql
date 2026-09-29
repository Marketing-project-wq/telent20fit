-- ============================================================================
-- Post Proofs: manual entry/edit + final metrics + per-KOL report + search
-- Project: 20FIT ALL DATA (cpvzwqptzcxnwzfzgrmt).
--
-- REVIEW ONLY — apply this migration MANUALLY after review (it is NOT run by
-- the app). ADDITIVE and idempotent (safe to run more than once).
--
-- Context / design decisions (per plan approval):
--   * The AI-extracted numbers stay in `extracted` and are NEVER overwritten.
--   * `metrics_manual` holds only the numbers a human typed in.
--   * `metrics_final` is what every report/CSV reads: per-field COALESCE of
--     manual over AI (manual wins PER FIELD, not per row). It is recomputed by
--     the app on every manual edit and at the end of a re-extract, so a
--     re-extract can refresh AI numbers without ever clobbering manual ones.
--   * `is_manual_entry` marks proofs an EO/admin created without a screenshot
--     (e.g. numbers received from the KOL over WhatsApp).
--   * Auth: the app talks to Postgres with the SERVICE ROLE, which bypasses
--     RLS. Enabling RLS deny-all here is defense-in-depth only (in case the
--     anon/authenticated key is ever exposed to a browser) — it does not
--     change how the app behaves.
-- ============================================================================

------------------------------------------------------------------------------
-- 1) New columns on talent_post_proofs
------------------------------------------------------------------------------
ALTER TABLE talent_post_proofs
  ADD COLUMN IF NOT EXISTS metrics_manual  jsonb,
  ADD COLUMN IF NOT EXISTS metrics_final   jsonb,
  ADD COLUMN IF NOT EXISTS metrics_source  text,          -- 'ai' | 'manual' | 'mixed'
  ADD COLUMN IF NOT EXISTS edited_by       uuid,          -- staff_accounts.id of last human editor
  ADD COLUMN IF NOT EXISTS edited_at       timestamptz,
  ADD COLUMN IF NOT EXISTS is_manual_entry boolean NOT NULL DEFAULT false;

------------------------------------------------------------------------------
-- 2) Backfill metrics_final from the existing AI extraction, so the reports
--    that now read metrics_final show identical numbers to before.
------------------------------------------------------------------------------
UPDATE talent_post_proofs
   SET metrics_final  = extracted,
       metrics_source = 'ai'
 WHERE metrics_final IS NULL
   AND extracted IS NOT NULL;

------------------------------------------------------------------------------
-- 3) Indexes for the per-KOL report and the server-side filters
------------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_proofs_talent_id    ON talent_post_proofs (talent_id);
CREATE INDEX IF NOT EXISTS idx_proofs_event_id     ON talent_post_proofs (event_id);
CREATE INDEX IF NOT EXISTS idx_proofs_posted_at    ON talent_post_proofs (posted_at DESC);
CREATE INDEX IF NOT EXISTS idx_proofs_status       ON talent_post_proofs (status);
CREATE INDEX IF NOT EXISTS idx_proofs_content_type ON talent_post_proofs (content_type);

-- Case-insensitive partial search on KOL name / username. pg_trgm powers fast
-- ILIKE '%q%' lookups; it is available on Supabase by default.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS idx_proofs_username_trgm
  ON talent_post_proofs USING gin (lower(submitter_username) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_proofs_name_trgm
  ON talent_post_proofs USING gin (lower(submitter_name) gin_trgm_ops);

------------------------------------------------------------------------------
-- 4) RLS: enable + deny-all (defense-in-depth; the service role bypasses it).
--    If RLS is already enabled with an intentional policy, review before
--    running — this only turns it ON and adds no permissive policy.
------------------------------------------------------------------------------
ALTER TABLE talent_post_proofs ENABLE ROW LEVEL SECURITY;   -- no policy = deny-all for anon/authenticated

-- ----------------------------------------------------------------------------
-- OPTIONAL backfill (review, then uncomment): if you want existing proofs that
-- are already linked to a talent to carry that account's name/username in the
-- denormalized submitter_* columns (so search matches them). The app already
-- does this going forward whenever a proof is (re)linked to a KOL.
-- ----------------------------------------------------------------------------
-- UPDATE talent_post_proofs p
--    SET submitter_name     = COALESCE(NULLIF(p.submitter_name, ''), a.name),
--        submitter_username = COALESCE(NULLIF(p.submitter_username, ''), a.instagram)
--   FROM talent_accounts a
--  WHERE p.talent_id = a.id;
