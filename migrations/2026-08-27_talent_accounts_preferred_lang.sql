-- Migration: add talent_accounts.preferred_lang
--
-- Purpose: let a talent's explicit language choice (made via the ID/EN
-- toggle while logged in) follow them to a new device/browser on next
-- login, instead of only living in a same-device cookie. See
-- server.js: applyPreferredLang(), the /lang/:code route, and
-- talentLoginPost.
--
-- Status: NOT YET RUN. Review and run manually against the production
-- Supabase project (SQL editor or your migration tool of choice) — this
-- repo has no migration runner, so nothing executes this automatically.
--
-- Reversible: see the ROLLBACK block at the bottom.

-- ============================== UP ==========================================

alter table talent_accounts
  add column if not exists preferred_lang text
    check (preferred_lang is null or preferred_lang in ('id', 'en'));

comment on column talent_accounts.preferred_lang is
  'Talent''s explicitly chosen UI language (id/en), set when they use the '
  'language toggle while logged in. NULL means "no explicit choice yet" — '
  'the app falls back to the per-device cookie / site default (English), '
  'it does NOT default this column to ''en'' for existing rows.';

-- ============================== ROLLBACK ====================================
-- Run this block (uncommented) to fully revert the migration above.
--
-- alter table talent_accounts drop column if exists preferred_lang;
