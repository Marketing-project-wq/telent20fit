-- Close the public (no-login) proof path at the DB level too: a talent-side upload
-- ('pending') must carry a talent_id. Staff manual entries ('extracted') stay
-- allowed. Replaces the function from 20261012_security_proofs.sql; existing
-- rows are untouched (INSERT trigger only).
CREATE OR REPLACE FUNCTION public.proofs_require_accepted_app() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_start date;
BEGIN
  -- Staff manual entries are inserted as 'extracted' and are always allowed.
  IF NEW.status IS DISTINCT FROM 'pending' THEN
    RETURN NEW;
  END IF;
  -- Upload without a talent account (the closed public form): not allowed.
  IF NEW.talent_id IS NULL THEN
    RAISE EXCEPTION 'proof_no_talent: proofs must come from an accepted talent or staff entry' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM talent_applications a
     WHERE a.talent_id = NEW.talent_id AND a.event_id = NEW.event_id
       AND a.status IN ('approved', 'assigned', 'completed')
  ) THEN
    RAISE EXCEPTION 'proof_not_accepted: talent has no accepted application for this event' USING ERRCODE = 'check_violation';
  END IF;
  SELECT starts_at INTO v_start FROM talent_events WHERE id = NEW.event_id;
  IF NEW.posted_at IS NOT NULL AND v_start IS NOT NULL
     AND NEW.posted_at < (v_start::timestamp AT TIME ZONE 'Asia/Jakarta') THEN
    RAISE EXCEPTION 'proof_posted_before_event: posted_at is before the event start' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
