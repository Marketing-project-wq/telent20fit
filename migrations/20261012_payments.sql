-- Payment recap: talent bank details, change log, per-position daily fee,
-- per-application payment rows and an export log. Additive only: no existing
-- rows are changed. All new tables keep RLS on with no policies (server-only
-- access via service_role, like the other talent_* tables).

-- 1) Bank details on the talent account (TEXT so leading zeros survive)
ALTER TABLE talent_accounts
  ADD COLUMN IF NOT EXISTS bank_name           text,
  ADD COLUMN IF NOT EXISTS bank_account_number text,
  ADD COLUMN IF NOT EXISTS bank_account_holder text,
  ADD COLUMN IF NOT EXISTS bank_updated_at     timestamptz;
ALTER TABLE talent_accounts ADD CONSTRAINT talent_accounts_bank_acct_chk
  CHECK (bank_account_number IS NULL OR bank_account_number ~ '^[0-9]{6,20}$');

-- 2) Every bank-detail change is logged (fraud-sensitive)
CREATE TABLE IF NOT EXISTS talent_bank_change_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  talent_id uuid NOT NULL REFERENCES talent_accounts(id),
  old_bank_name text, old_account_number text, old_account_holder text,
  new_bank_name text, new_account_number text, new_account_holder text,
  changed_at timestamptz NOT NULL DEFAULT now(),
  changed_by uuid, changed_by_role text
);
CREATE INDEX IF NOT EXISTS idx_bank_logs_talent ON talent_bank_change_logs (talent_id, changed_at DESC);
ALTER TABLE talent_bank_change_logs ENABLE ROW LEVEL SECURITY;

-- 3) Daily fee per event position (the old text `fee` stays as the talent-facing text)
ALTER TABLE talent_event_positions ADD COLUMN IF NOT EXISTS fee_amount bigint;
ALTER TABLE talent_event_positions ADD CONSTRAINT talent_event_positions_fee_amount_chk
  CHECK (fee_amount IS NULL OR fee_amount >= 0);

-- 4) One payment row per application (created when staff edits the fee or marks paid)
CREATE TABLE IF NOT EXISTS talent_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL UNIQUE REFERENCES talent_applications(id),
  event_id uuid NOT NULL REFERENCES talent_events(id),
  talent_id uuid NOT NULL REFERENCES talent_accounts(id),
  fee_final bigint CHECK (fee_final IS NULL OR fee_final >= 0),   -- NULL = fee_amount x days attended
  fee_note text,
  payment_status text NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid', 'paid')),
  paid_at timestamptz,
  paid_by uuid REFERENCES staff_accounts(id),
  paid_bank_name text, paid_account_number text, paid_account_holder text,   -- snapshot when paid
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_payments_event ON talent_payments (event_id, payment_status);
ALTER TABLE talent_payments ENABLE ROW LEVEL SECURITY;

-- 5) Export log: who downloaded what, when, how many rows
CREATE TABLE IF NOT EXISTS talent_export_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id uuid REFERENCES staff_accounts(id), staff_name text, staff_role text,
  event_id uuid REFERENCES talent_events(id),
  kind text NOT NULL CHECK (kind IN ('payments_pdf', 'payments_csv')),
  row_count integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_export_logs_event ON talent_export_logs (event_id, created_at DESC);
ALTER TABLE talent_export_logs ENABLE ROW LEVEL SECURITY;

-- 6) Defense in depth: no table privileges for the public API roles at all
REVOKE ALL ON TABLE public.talent_payments, public.talent_bank_change_logs, public.talent_export_logs FROM anon, authenticated;
GRANT ALL ON TABLE public.talent_payments, public.talent_bank_change_logs, public.talent_export_logs TO service_role;
