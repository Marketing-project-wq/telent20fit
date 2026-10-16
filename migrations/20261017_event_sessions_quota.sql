-- APPLIED 2026-10-17. Per-session headcount cap: when a session reaches its quota
-- it can no longer be chosen (Final Accept / change session). NULL = no cap.
-- Additive; seeds 31 for both JHR × Mandiri sessions (owner's request).
alter table public.event_sessions add column if not exists quota int check (quota is null or quota >= 1);
update public.event_sessions set quota = 31
 where event_id = 'ce923a16-2f43-41f1-8eab-1809848fb63d' and name in ('Sesi Pagi', 'Sesi Siang') and quota is null;
