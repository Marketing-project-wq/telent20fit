-- =====================================================================
-- Clickwrap talent agreement + assignment sessions
-- FILE ONLY — NOT APPLIED. Review, then run once in the Supabase SQL editor
-- (or via apply_migration) BEFORE deploying the code that uses it.
--
-- Additive only: new tables, new nullable/defaulted columns, new functions.
-- No existing row is updated or deleted, except the explicit, reviewed
-- backfill in section 7 (agreement_required=false for the 26 already
-- 'assigned' applications of the finished ISS event — pending decision).
--
-- Access model (same as the rest of talent.20fit.id): the Node server talks to
-- Postgres with the SERVICE ROLE key (bypasses RLS). RLS stays ON with no
-- policies on every new table, and EXECUTE on the new functions is revoked
-- from anon/authenticated, so the public anon key can read/write nothing.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1) Sessions per event (Sesi Pagi / Sesi Siang …). time-typed so the arrival
--    time (start - 1h) and overlaps are computed in SQL. session_date is
--    optional for multi-day events (NULL = applies to every event day).
-- ---------------------------------------------------------------------
create table if not exists public.event_sessions (
  id           uuid primary key default gen_random_uuid(),
  event_id     uuid not null references public.talent_events(id) on delete cascade,
  name         text not null,
  name_en      text,
  session_date date,
  start_time   time not null,
  end_time     time not null,
  sort_order   int  not null default 0,
  created_at   timestamptz not null default now(),
  constraint event_sessions_time_chk check (end_time > start_time)
);
create index if not exists event_sessions_event_idx on public.event_sessions(event_id, sort_order);
alter table public.event_sessions enable row level security;

-- Arrival time = 1 hour before the session starts (Pasal 1 ayat 3).
create or replace function public.event_session_arrival(p_start time)
returns time language sql immutable as $$ select (p_start - interval '1 hour')::time $$;

-- Seed: Livin' by Mandiri | VISA × Jakarta Hybrid Race
insert into public.event_sessions (event_id, name, name_en, start_time, end_time, sort_order)
select 'ce923a16-2f43-41f1-8eab-1809848fb63d', v.name, v.name_en, v.st, v.et, v.ord
from (values ('Sesi Pagi', 'Morning Session', time '06:00', time '13:30', 1),
             ('Sesi Siang', 'Afternoon Session', time '13:30', time '20:30', 2)) as v(name, name_en, st, et, ord)
where exists (select 1 from public.talent_events where id = 'ce923a16-2f43-41f1-8eab-1809848fb63d')
  and not exists (select 1 from public.event_sessions where event_id = 'ce923a16-2f43-41f1-8eab-1809848fb63d');

-- ---------------------------------------------------------------------
-- 2) Application ↔ session + agreement bookkeeping (all nullable/defaulted)
-- ---------------------------------------------------------------------
alter table public.talent_applications add column if not exists session_id uuid references public.event_sessions(id) on delete set null;
alter table public.talent_applications add column if not exists agreement_required boolean not null default true;
alter table public.talent_applications add column if not exists agreement_accepted_at timestamptz;
alter table public.talent_applications add column if not exists agreement_deadline timestamptz;
create index if not exists talent_applications_session_idx on public.talent_applications(session_id);

-- Per-event agreement window (hours after Final Accept). NULL = app default (48h).
alter table public.talent_events add column if not exists agreement_deadline_hours int
  check (agreement_deadline_hours is null or agreement_deadline_hours between 1 and 720);

-- ---------------------------------------------------------------------
-- 3) Agreement templates — append-only versions per talent category
-- ---------------------------------------------------------------------
create table if not exists public.agreement_templates (
  id              uuid primary key default gen_random_uuid(),
  talent_category text not null check (talent_category in ('kol','photographer','manpower')),
  version         int  not null check (version >= 1),
  title           text not null,
  title_en        text,
  body_html       text not null,
  body_en_html    text,
  is_active       boolean not null default false,
  published_at    timestamptz not null default now(),
  created_by      uuid,
  constraint agreement_templates_cat_ver_uniq unique (talent_category, version)
);
-- At most one active version per category.
create unique index if not exists agreement_templates_one_active
  on public.agreement_templates(talent_category) where is_active;
alter table public.agreement_templates enable row level security;

-- Versions are evidence: content can never change and rows can never be
-- deleted. Only is_active may flip (activating a newer version deactivates
-- the previous one).
create or replace function public.agreement_templates_guard()
returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'agreement_templates is append-only (delete refused)';
  end if;
  if new.talent_category is distinct from old.talent_category
     or new.version is distinct from old.version
     or new.title is distinct from old.title
     or new.title_en is distinct from old.title_en
     or new.body_html is distinct from old.body_html
     or new.body_en_html is distinct from old.body_en_html
     or new.published_at is distinct from old.published_at
     or new.created_by is distinct from old.created_by then
    raise exception 'agreement_templates is append-only: publish a new version instead';
  end if;
  return new;
end $$;
drop trigger if exists agreement_templates_guard_trg on public.agreement_templates;
create trigger agreement_templates_guard_trg
  before update or delete on public.agreement_templates
  for each row execute function public.agreement_templates_guard();

-- Publish a new version (next number) and make it the active one, atomically.
create or replace function public.agreement_publish_version(
  p_category text, p_title text, p_title_en text, p_body_html text, p_body_en_html text, p_created_by uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_next int; v_id uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended('agreement:' || p_category, 0));
  select coalesce(max(version), 0) + 1 into v_next from agreement_templates where talent_category = p_category;
  update agreement_templates set is_active = false where talent_category = p_category and is_active;
  insert into agreement_templates (talent_category, version, title, title_en, body_html, body_en_html, is_active, created_by)
  values (p_category, v_next, p_title, p_title_en, p_body_html, p_body_en_html, true, p_created_by)
  returning id into v_id;
  return v_id;
end $$;

-- ---------------------------------------------------------------------
-- 4) Acceptance evidence — append-only (one per application)
-- ---------------------------------------------------------------------
create table if not exists public.talent_agreement_acceptances (
  id                uuid primary key default gen_random_uuid(),
  application_id    uuid not null unique references public.talent_applications(id) on delete restrict,
  talent_id         uuid not null,
  event_id          uuid not null,
  session_id        uuid,                       -- session agreed to AT THAT TIME (no FK: survives session edits/deletes)
  session_snapshot  jsonb,                      -- {name, date, start, end, arrival} as shown to the talent
  assignment_snapshot jsonb,                    -- {event, position, dates, location} as shown to the talent
  template_id       uuid not null references public.agreement_templates(id) on delete restrict,
  template_version  int  not null,
  accepted_at       timestamptz not null default now(),   -- UTC; shown in WIB
  typed_name        text not null,
  ip_address        inet,                       -- taken server-side from the request, never from the browser
  user_agent        text,                       -- taken server-side from the request header
  acceptance_method text not null default 'clickwrap',
  lang              text,
  pdf_path          text                        -- private bucket path; filled once after the PDF is generated
);
create index if not exists taa_event_idx  on public.talent_agreement_acceptances(event_id);
create index if not exists taa_talent_idx on public.talent_agreement_acceptances(talent_id);
alter table public.talent_agreement_acceptances enable row level security;

-- Append-only: no DELETE, no UPDATE — except filling pdf_path exactly once
-- (NULL -> value) with every other column unchanged.
create or replace function public.talent_agreement_acceptances_guard()
returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'talent_agreement_acceptances is append-only (delete refused)';
  end if;
  if old.pdf_path is null and new.pdf_path is not null
     and (to_jsonb(new) - 'pdf_path') = (to_jsonb(old) - 'pdf_path') then
    return new;
  end if;
  raise exception 'talent_agreement_acceptances is append-only (update refused)';
end $$;
drop trigger if exists talent_agreement_acceptances_guard_trg on public.talent_agreement_acceptances;
create trigger talent_agreement_acceptances_guard_trg
  before update or delete on public.talent_agreement_acceptances
  for each row execute function public.talent_agreement_acceptances_guard();

-- Loose name match: case, repeated spaces and punctuation ignored.
create or replace function public.agreement_norm_name(p text)
returns text language sql immutable as $$
  select btrim(regexp_replace(regexp_replace(lower(coalesce(p, '')), '[^[:alnum:][:space:]]', '', 'g'), '\s+', ' ', 'g'))
$$;

-- ---------------------------------------------------------------------
-- 5) ONE function for the whole acceptance (single transaction).
--    In this app the admin's "Final Accept" sets status 'approved' (offer);
--    accepting the agreement is the talent's confirmation → 'assigned'.
--    (Replaces the old POST /talent/applications/:id/agree.)
--    Returns jsonb: {ok:true, id, version, accepted_at} | {ok:false, error}
-- ---------------------------------------------------------------------
create or replace function public.talent_accept_agreement(
  p_app_id uuid, p_talent_id uuid, p_typed_name text, p_ip inet, p_user_agent text, p_lang text default 'id')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  a   talent_applications%rowtype;
  acc record; ev record; tpl record; ses record; pos record;
  v_id uuid; v_at timestamptz; v_existing record;
begin
  select * into a from talent_applications where id = p_app_id for update;
  if not found or a.talent_id is distinct from p_talent_id then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  select * into v_existing from talent_agreement_acceptances where application_id = p_app_id;
  if found then  -- idempotent: already accepted
    return jsonb_build_object('ok', true, 'id', v_existing.id, 'version', v_existing.template_version, 'accepted_at', v_existing.accepted_at, 'already', true);
  end if;

  if a.status <> 'approved' then
    return jsonb_build_object('ok', false, 'error', 'bad_status', 'status', a.status);
  end if;

  select coalesce(nullif(btrim(full_name), ''), name) as legal_name into acc from talent_accounts where id = a.talent_id;
  if agreement_norm_name(p_typed_name) = '' or agreement_norm_name(p_typed_name) <> agreement_norm_name(acc.legal_name) then
    return jsonb_build_object('ok', false, 'error', 'name_mismatch');
  end if;

  -- Accepted position (decides the template category).
  select p.id, p.label_id, p.label_en, coalesce(p.talent_category, 'manpower') as cat, ep.custom_label
    into pos
    from talent_application_choices c
    join talent_positions p on p.id = c.position_id
    left join talent_event_positions ep on ep.event_id = a.event_id and ep.position_id = c.position_id
   where c.application_id = a.id and c.accepted
   limit 1;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'no_position');
  end if;

  select * into tpl from agreement_templates where talent_category = pos.cat and is_active limit 1;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'no_template', 'category', pos.cat);
  end if;

  select name, starts_at, ends_at, location, city into ev from talent_events where id = a.event_id;
  select id, name, session_date, start_time, end_time into ses from event_sessions where id = a.session_id;

  v_at := now();
  insert into talent_agreement_acceptances (
    application_id, talent_id, event_id, session_id, session_snapshot, assignment_snapshot,
    template_id, template_version, accepted_at, typed_name, ip_address, user_agent, acceptance_method, lang)
  values (
    a.id, a.talent_id, a.event_id, a.session_id,
    case when ses.id is null then null else jsonb_build_object(
      'name', ses.name, 'date', ses.session_date, 'start', to_char(ses.start_time, 'HH24:MI'),
      'end', to_char(ses.end_time, 'HH24:MI'), 'arrival', to_char(event_session_arrival(ses.start_time), 'HH24:MI')) end,
    jsonb_build_object('event', ev.name, 'starts_at', ev.starts_at, 'ends_at', ev.ends_at,
      'location', ev.location, 'city', ev.city,
      'position', coalesce(pos.custom_label, pos.label_id, pos.label_en), 'category', pos.cat),
    tpl.id, tpl.version, v_at, btrim(p_typed_name), p_ip, left(p_user_agent, 1000), 'clickwrap', p_lang)
  returning id into v_id;

  update talent_applications
     set status = 'assigned', agreement_accepted_at = v_at, confirmed_at = v_at
   where id = a.id;

  insert into talent_application_status_log (application_id, from_status, to_status, changed_by, actor_name)
  values (a.id, 'approved', 'assigned', null, 'talent: clickwrap v' || tpl.version);

  return jsonb_build_object('ok', true, 'id', v_id, 'version', tpl.version, 'accepted_at', v_at);
end $$;

-- "Saya tidak bisa hadir": same outcome the app already uses for a talent decline
-- (status 'rejected', note 'Declined by talent', reserved slot released), in one
-- transaction. The legacy talent_cancel_application RPC is NOT used: it sets
-- status 'cancelled' (unknown to this app) and refuses inside 24h of the event.
create or replace function public.talent_decline_assignment(p_app_id uuid, p_talent_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a talent_applications%rowtype;
begin
  select * into a from talent_applications where id = p_app_id for update;
  if not found or a.talent_id is distinct from p_talent_id then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  if a.status <> 'approved' then
    return jsonb_build_object('ok', false, 'error', 'bad_status', 'status', a.status);
  end if;
  update talent_application_choices set accepted = false where application_id = a.id;
  update talent_applications set status = 'rejected', note = 'Declined by talent', reviewed_at = now() where id = a.id;
  insert into talent_application_status_log (application_id, from_status, to_status, changed_by, actor_name)
  values (a.id, 'approved', 'rejected', null, 'talent: declined assignment');
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------------
-- 6) Lock functions down: server (service_role) only.
-- ---------------------------------------------------------------------
revoke all on function public.talent_accept_agreement(uuid, uuid, text, inet, text, text) from public, anon, authenticated;
revoke all on function public.talent_decline_assignment(uuid, uuid) from public, anon, authenticated;
revoke all on function public.agreement_publish_version(text, text, text, text, text, uuid) from public, anon, authenticated;
grant execute on function public.talent_accept_agreement(uuid, uuid, text, inet, text, text) to service_role;
grant execute on function public.talent_decline_assignment(uuid, uuid) to service_role;
grant execute on function public.agreement_publish_version(text, text, text, text, text, uuid) to service_role;
revoke all on table public.event_sessions, public.agreement_templates, public.talent_agreement_acceptances from anon, authenticated;

-- Legacy offer/substitute RPCs: not called by this app (only approve_application_choice
-- and set_event_role_quota are). Mark deprecated; DO NOT drop yet.
comment on function public.talent_accept_choice(uuid, uuid, uuid)        is 'DEPRECATED 2026-10: not used by talent.20fit.id (clickwrap replaces the offer flow). Do not drop before confirming no other client uses it.';
comment on function public.talent_confirm_offer(uuid, uuid)              is 'DEPRECATED 2026-10: replaced by talent_accept_agreement.';
comment on function public.talent_decline_offer(uuid, text, text, uuid)  is 'DEPRECATED 2026-10: replaced by talent_decline_assignment.';
comment on function public.talent_lapse_offer(uuid)                      is 'DEPRECATED 2026-10: deadline no longer auto-cancels (flag only).';
comment on function public.talent_cancel_application(uuid, text, text, uuid) is 'DEPRECATED 2026-10: sets status cancelled, unknown to talent.20fit.id.';
comment on function public.talent_offer_substitute(uuid, uuid, uuid, uuid, uuid, timestamptz, uuid) is 'DEPRECATED 2026-10: substitute flow not used by talent.20fit.id.';
comment on function public.talent_confirm_substitute(uuid, uuid)         is 'DEPRECATED 2026-10: substitute flow not used by talent.20fit.id.';

-- ---------------------------------------------------------------------
-- 7) Existing data — PENDING DECISION (see plan). Proposed: the 26 'assigned'
--    applications all belong to the finished ISS event (11–13 Sep 2026) and
--    already confirmed via the old Agree button → exempt them.
-- ---------------------------------------------------------------------
update public.talent_applications set agreement_required = false
 where status = 'assigned' and agreement_accepted_at is null
   and event_id = '6da616eb-d0f1-4a73-a104-6c70f9b6229d';

-- ---------------------------------------------------------------------
-- 8) Seed: agreement v1 for Man Power (text from docs/clickwrap-talent.html)
-- ---------------------------------------------------------------------
insert into public.agreement_templates (talent_category, version, title, title_en, body_html, body_en_html, is_active)
select 'manpower', 1, 'Perjanjian Penugasan Talent', 'Talent Assignment Agreement', $agr$
<p>Perjanjian ini merupakan kesepakatan antara <b>20FIT</b>, selanjutnya disebut sebagai Penyelenggara, dan individu yang menerima penugasan untuk terlibat dalam event yang diselenggarakan atau dikelola oleh 20FIT, selanjutnya disebut sebagai Talent. Perjanjian ini dibuat untuk mengatur ketentuan kerja sama antara Penyelenggara dan Talent, termasuk tugas, tanggung jawab, jadwal, lokasi, serta posisi Talent sebagaimana tercantum dalam detail event.</p>
<p>Dengan menyetujui perjanjian ini, Talent menyatakan bahwa dirinya telah membaca, memahami, dan bersedia mematuhi seluruh ketentuan yang berlaku selama pelaksanaan event. Talent juga bersedia menjalankan tugas sesuai dengan posisi dan arahan yang diberikan oleh Penyelenggara, menjaga sikap profesional, serta bertanggung jawab atas tugas yang telah disepakati agar pelaksanaan event dapat berjalan dengan tertib dan lancar.</p>
<h3>Pasal 1 — Ruang Lingkup Penugasan</h3>
<ol>
<li>Talent bertanggung jawab untuk melaksanakan tugas sesuai dengan posisi, tanggal, waktu, dan lokasi yang tercantum dalam rincian penugasan event.</li>
<li>Pelaksanaan penugasan dibagi ke dalam 2 (dua) sesi, yaitu Sesi Pagi pukul 06.00&ndash;13.30 WIB dan Sesi Siang pukul 13.30&ndash;20.30 WIB. Talent wajib hadir sesuai dengan sesi dan jadwal kehadiran yang telah ditentukan serta diinformasikan oleh Penyelenggara melalui grup komunikasi yang digunakan untuk koordinasi event. Penugasan berakhir setelah seluruh rangkaian acara pada sesi tersebut selesai, termasuk kegiatan pembongkaran dan perapian area, kecuali terdapat ketentuan lain yang telah disepakati. Ketidakhadiran atau keterlambatan yang tidak sesuai dengan jadwal dan tanpa alasan yang dapat diterima dapat menjadi bahan evaluasi bagi Penyelenggara.</li>
<li>Talent wajib tiba di lokasi event selambat-lambatnya 1 (satu) jam sebelum sesi penugasannya dimulai, untuk keperluan registrasi kehadiran, pengambilan atribut, dan pengarahan singkat dari koordinator. Keterlambatan dari ketentuan ini dapat menjadi bahan evaluasi bagi Penyelenggara.</li>
<li>Talent yang telah ditempatkan pada sesi tertentu tidak diperkenankan mengajukan permohonan pemindahan jadwal, kecuali terdapat Talent lain pada posisi yang sama yang bersedia menukar sesi penugasannya. Pertukaran sesi tersebut wajib disepakati oleh kedua Talent yang bersangkutan dan dilaporkan kepada koordinator untuk mendapat persetujuan sebelum pelaksanaan event. Pertukaran yang dilakukan tanpa persetujuan koordinator dianggap sebagai ketidakhadiran.</li>
<li>Penyelenggara berhak menyesuaikan atau memindahkan posisi Talent ke posisi lain dengan tingkat tanggung jawab yang setara apabila diperlukan berdasarkan kebutuhan dan kondisi di lapangan.</li>
<li>Talent wajib mengikuti briefing yang dijadwalkan oleh Penyelenggara untuk memahami alur acara, pembagian tugas, serta arahan teknis sebelum bertugas. Ketidakhadiran tanpa alasan yang dapat diterima dapat mengakibatkan pembatalan penugasan.</li>
</ol>
<h3>Pasal 2 — Kehadiran dan Pembatalan</h3>
<ol>
<li>Dengan menyetujui perjanjian ini, Talent menyatakan kesediaan dan kesanggupannya untuk hadir serta melaksanakan tugas sesuai dengan tanggal, waktu, dan lokasi penugasan yang telah disepakati.</li>
<li>Apabila Talent berhalangan hadir, Talent wajib menyampaikan pemberitahuan kepada koordinator yang bertanggung jawab selambat-lambatnya 1 (satu) hari sebelum pelaksanaan event.</li>
<li>Apabila terjadi keadaan darurat yang menyebabkan Talent tidak dapat hadir, Talent wajib segera menginformasikan kondisi tersebut kepada koordinator disertai penjelasan yang sesuai.</li>
<li>Ketidakhadiran tanpa pemberitahuan atau pembatalan secara sepihak dapat dicatat dalam riwayat penugasan Talent dan menjadi bahan pertimbangan dalam proses seleksi untuk penugasan berikutnya.</li>
</ol>
<h3>Pasal 3 — Pelaksanaan Tugas</h3>
<ol>
<li>Talent wajib mengenakan seragam, tanda pengenal, gelang akses, atau atribut lain yang ditentukan oleh Penyelenggara selama bertugas, serta mengembalikan perlengkapan yang dipinjamkan setelah penugasan selesai.</li>
<li>Talent wajib menjalankan tugas sesuai dengan deskripsi pekerjaan, arahan koordinator, dan prosedur operasional yang berlaku di lokasi event, termasuk mematuhi ketentuan keselamatan dan keamanan.</li>
<li>Talent tidak diperkenankan meninggalkan pos atau area penugasan selama jam kerja tanpa izin dari koordinator, kecuali dalam keadaan darurat.</li>
<li>Talent dilarang mengonsumsi minuman beralkohol atau menggunakan obat-obatan terlarang selama menjalankan tugas maupun berada dalam kondisi yang dapat mengganggu pelaksanaan pekerjaan.</li>
<li>Talent wajib menjaga sikap profesional, berkomunikasi dengan sopan, serta menghormati peserta, sesama Talent, panitia, dan seluruh pihak yang terlibat dalam event.</li>
</ol>
<h3>Pasal 4 — Pembayaran</h3>
<ol>
<li>Besaran pembayaran untuk Talent mengikuti nominal dan ketentuan yang tercantum pada rincian penugasan atau kesepakatan yang telah disetujui oleh kedua belah pihak. Pembayaran dilakukan melalui transfer ke rekening bank atas nama Talent sendiri, kecuali disepakati lain secara tertulis.</li>
<li>Talent bertanggung jawab untuk memastikan bahwa data rekening yang diberikan kepada Penyelenggara benar, lengkap, dan masih aktif. Apabila terjadi keterlambatan pembayaran akibat kesalahan data rekening yang diberikan oleh Talent, proses pembayaran dapat ditunda sampai data yang benar diterima.</li>
<li>Pembayaran dilakukan sesuai dengan jadwal dan ketentuan yang telah diinformasikan oleh Penyelenggara.</li>
<li>Talent yang tidak hadir tanpa alasan yang dapat diterima atau meninggalkan penugasan sebelum waktunya tanpa persetujuan koordinator dapat dikenai penyesuaian atau pembatalan pembayaran sesuai dengan ketentuan yang telah disepakati oleh kedua belah pihak.</li>
</ol>
<h3>Pasal 5 — Dokumentasi dan Penggunaan Materi</h3>
<ol>
<li>Talent memahami bahwa selama pelaksanaan event, Penyelenggara atau pihak yang ditunjuk dapat mengambil foto dan video yang menampilkan Talent untuk keperluan dokumentasi kegiatan.</li>
<li>Penggunaan foto dan video Talent untuk keperluan publikasi, promosi, atau materi komunikasi event oleh Penyelenggara dan sponsor resmi harus didasarkan pada persetujuan Talent serta memperhatikan tujuan dan ruang lingkup penggunaan yang telah diinformasikan.</li>
<li>Talent wajib membuat dan mengunggah konten Threads pada akun media sosial pribadinya yang berisi pengalaman selama mengikuti event yang diselenggarakan oleh 20FIT bersama brand mitra, dengan menandai akun resmi 20FIT dan brand terkait. Konten tersebut wajib diunggah setelah pelaksanaan event sesuai arahan yang disampaikan Penyelenggara, serta tidak memuat informasi yang bersifat rahasia sebagaimana diatur dalam Pasal 6.</li>
</ol>
<h3>Pasal 6 — Kerahasiaan Informasi</h3>
<ol>
<li>Talent wajib menjaga kerahasiaan informasi internal yang diperoleh selama penugasan, termasuk data peserta, informasi operasional, susunan acara yang belum dipublikasikan, serta informasi kerja sama dengan sponsor yang bersifat rahasia.</li>
<li>Talent dilarang menyebarluaskan informasi rahasia kepada pihak yang tidak berwenang, baik secara lisan, tertulis, melalui media sosial, maupun melalui media komunikasi lainnya.</li>
<li>Talent tidak diperkenankan memberikan pernyataan resmi, membuat pengumuman, atau bertindak atas nama Penyelenggara maupun sponsor tanpa izin dari pihak yang berwenang.</li>
<li>Kewajiban menjaga kerahasiaan tetap berlaku setelah penugasan berakhir untuk informasi yang masih bersifat rahasia.</li>
</ol>
<h3>Pasal 7 — Pelindungan Data Pribadi</h3>
<ol>
<li>Talent memahami bahwa data pribadi yang diberikan melalui platform 20FIT Talent atau selama proses penugasan akan digunakan untuk keperluan administrasi, komunikasi, penempatan tugas, dan pembayaran sesuai dengan tujuan yang telah diinformasikan.</li>
<li>Penyelenggara wajib mengelola dan melindungi data pribadi Talent sesuai dengan ketentuan peraturan perundang-undangan yang berlaku, termasuk Undang-Undang Nomor 27 Tahun 2022 tentang Pelindungan Data Pribadi.</li>
<li>Talent bertanggung jawab untuk memberikan data yang benar dan memperbarui informasi apabila terdapat perubahan yang relevan dengan pelaksanaan penugasan.</li>
</ol>
<h3>Pasal 8 — Ketentuan Penutup</h3>
<ol>
<li>Perjanjian ini berlaku khusus untuk penugasan pada event yang tercantum dalam rincian penugasan dan tidak secara otomatis berlaku untuk event lainnya.</li>
<li>Perjanjian ini tidak dengan sendirinya membentuk hubungan kerja tetap antara Penyelenggara dan Talent. Status dan hubungan hukum para pihak mengikuti sifat penugasan serta ketentuan peraturan perundang-undangan yang berlaku.</li>
<li>Perjanjian ini berakhir setelah penugasan selesai dilaksanakan dan seluruh kewajiban yang disepakati oleh kedua belah pihak telah dipenuhi, termasuk pembayaran apabila berlaku.</li>
<li>Hal-hal yang belum diatur dalam perjanjian ini akan dibahas dan diselesaikan melalui musyawarah antara Penyelenggara dan Talent dengan tetap memperhatikan ketentuan peraturan perundang-undangan yang berlaku.</li>
<li>Dengan menyetujui perjanjian ini melalui platform 20FIT Talent atau mekanisme persetujuan yang disediakan, Talent menyatakan telah membaca, memahami, dan menyetujui seluruh ketentuan yang tercantum di dalamnya.</li>
</ol>$agr$, null, true
where not exists (select 1 from public.agreement_templates where talent_category = 'manpower');

commit;

-- Verification (read-only), run after applying:
-- select count(*) from event_sessions where event_id = 'ce923a16-2f43-41f1-8eab-1809848fb63d';  -- 2
-- select talent_category, version, is_active, length(body_html) from agreement_templates;       -- manpower v1 active
-- select count(*) filter (where agreement_required) req, count(*) filter (where not agreement_required) exempt from talent_applications;
