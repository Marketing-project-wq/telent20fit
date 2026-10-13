-- Jobdesk + Requirement on role templates, so a position saved with
-- "Save to template" (event form → Extra positions) carries its texts into
-- the next event of that type. Additive only: two nullable columns, no
-- existing row is changed. The app works without this (it falls back to
-- description only) — run it to keep Jobdesk/Requirement in templates.

alter table public.role_templates add column if not exists jobdesk text;
alter table public.role_templates add column if not exists requirement text;
