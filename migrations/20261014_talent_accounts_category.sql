-- NOT APPLIED YET — run separately after review.
--
-- Talent category on the account, SEPARATE from talent_type.
-- talent_type is the login/session area (auth cookie ts_<type>, routes such as
-- requireTalent('kol'), legacy Man Power pages for 'main_power'); changing it
-- logs a person out or sends them to another area. So the category lives in its
-- own column. Nullable: existing 761 accounts stay NULL ("belum dikategorikan")
-- until an admin sets them; nothing is guessed.

alter table public.talent_accounts
  add column if not exists talent_category text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'talent_accounts_category_chk') then
    alter table public.talent_accounts
      add constraint talent_accounts_category_chk
      check (talent_category is null or talent_category in ('kol', 'photographer', 'manpower'));
  end if;
end $$;

create index if not exists talent_accounts_category_idx on public.talent_accounts (talent_category);

-- Audit trail for every category change (bulk tool, registration, apply).
create table if not exists public.talent_category_logs (
  id          uuid primary key default gen_random_uuid(),
  talent_id   uuid not null references public.talent_accounts(id) on delete cascade,
  old_category text,
  new_category text,
  source      text not null,            -- 'admin_bulk' | 'register' | 'apply'
  changed_by  uuid,                      -- staff id for admin changes, null otherwise
  changed_at  timestamptz not null default now()
);
create index if not exists talent_category_logs_talent_idx on public.talent_category_logs (talent_id, changed_at desc);
alter table public.talent_category_logs enable row level security;  -- server uses service role; no policies
