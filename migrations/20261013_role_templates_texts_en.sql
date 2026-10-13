-- English versions of a role template's texts, filled automatically when a
-- position is saved to a template (the text may be typed in Indonesian or
-- English; the app translates the other side). Additive only: three
-- nullable columns, no existing row is changed.

alter table public.role_templates add column if not exists description_en text;
alter table public.role_templates add column if not exists jobdesk_en text;
alter table public.role_templates add column if not exists requirement_en text;
