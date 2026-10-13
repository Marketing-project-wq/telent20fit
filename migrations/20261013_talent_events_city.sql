-- Event city (Indonesian city picked from a list in the event form), separate
-- from the free-text venue in `location`. Additive only; existing rows keep
-- city = null and the app derives their city from the location text.
alter table public.talent_events add column if not exists city text;
