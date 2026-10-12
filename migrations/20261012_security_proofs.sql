-- 1) Security: these SECURITY DEFINER functions don't check who calls them, and
--    were executable by anon/authenticated (the anon key is public). This app never
--    calls them (0 calls in the API logs); only the backend's service_role may.
REVOKE EXECUTE ON FUNCTION public.talent_accept_choice(uuid, uuid, uuid)                                   FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.talent_cancel_application(uuid, text, text, uuid)                         FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.talent_confirm_offer(uuid, uuid)                                          FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.talent_confirm_substitute(uuid, uuid)                                     FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.talent_decline_offer(uuid, text, text, uuid)                              FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.talent_lapse_offer(uuid)                                                  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.talent_offer_substitute(uuid, uuid, uuid, uuid, uuid, timestamptz, uuid)  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.talent_accept_choice(uuid, uuid, uuid)                                   TO service_role;
GRANT  EXECUTE ON FUNCTION public.talent_cancel_application(uuid, text, text, uuid)                         TO service_role;
GRANT  EXECUTE ON FUNCTION public.talent_confirm_offer(uuid, uuid)                                          TO service_role;
GRANT  EXECUTE ON FUNCTION public.talent_confirm_substitute(uuid, uuid)                                     TO service_role;
GRANT  EXECUTE ON FUNCTION public.talent_decline_offer(uuid, text, text, uuid)                              TO service_role;
GRANT  EXECUTE ON FUNCTION public.talent_lapse_offer(uuid)                                                  TO service_role;
GRANT  EXECUTE ON FUNCTION public.talent_offer_substitute(uuid, uuid, uuid, uuid, uuid, timestamptz, uuid)  TO service_role;

-- 2) Post proofs uploaded by a talent (talent_id set, status 'pending') must belong
--    to an event where their application was accepted, and can't be posted before
--    the event's start day (00:00 WIB). Admin manual entries (status 'extracted')
--    and the public no-login form (talent_id NULL) are not affected. INSERT only —
--    existing rows are untouched.
CREATE OR REPLACE FUNCTION public.proofs_require_accepted_app() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_start date;
BEGIN
  IF NEW.talent_id IS NULL OR NEW.status IS DISTINCT FROM 'pending' THEN
    RETURN NEW;
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
REVOKE ALL ON FUNCTION public.proofs_require_accepted_app() FROM PUBLIC, anon, authenticated;
-- CREATE OR REPLACE (PG14+) instead of DROP + CREATE: DROP TRIGGER needs an
-- ACCESS EXCLUSIVE lock and timed out on the busy shared database.
CREATE OR REPLACE TRIGGER trg_proofs_require_accepted_app
  BEFORE INSERT ON public.talent_post_proofs
  FOR EACH ROW EXECUTE FUNCTION public.proofs_require_accepted_app();
