-- ============================================================================
-- Event role templates + per-event role quota (HYROX / Running) + guards & logs
-- Project: 20FIT ALL DATA (cpvzwqptzcxnwzfzgrmt).
--
-- REVIEW ONLY — apply this migration MANUALLY after review (it is not run by
-- the app). Integrates with the EXISTING position-based model (event_types /
-- talent_positions / talent_event_positions / talent_application_choices) so
-- the apply / approve / export / certificate / two-layer-selection flows keep
-- working unchanged. ADDITIVE and idempotent (safe to run more than once).
--
-- Design decisions applied (per plan approval):
--   #1 position-backed roles (reuse talent_event_positions as "event_roles";
--      granular Running roles become master talent_positions rows).
--   #2 persist talent_events.event_type_id (category label kept for back-compat);
--      approved = talent_application_choices.accepted = true.
--   #3 "role inactive" reuses talent_event_positions.closed_at (no is_active col);
--      quota 0 = temporarily closed.
--   #4 legacy generic roles (marshal / water_station / drop_bag) left active but
--      NOT part of the Running template.
--   #5 RLS: enable + deny-all (app uses the service role); event_types RLS is a
--      commented optional hardening at the bottom.
-- ============================================================================

------------------------------------------------------------------------------
-- 1) division on master + event roles; type on events; audit columns
------------------------------------------------------------------------------
ALTER TABLE talent_positions       ADD COLUMN IF NOT EXISTS division text;
ALTER TABLE talent_event_positions ADD COLUMN IF NOT EXISTS division   text;
ALTER TABLE talent_event_positions ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0;
ALTER TABLE talent_event_positions ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
-- Persist the event's type (was only ephemeral in the form; needed for the
-- snapshot + "reset to default template"). category (label) kept as-is.
ALTER TABLE talent_events          ADD COLUMN IF NOT EXISTS event_type_id uuid REFERENCES event_types(id);

------------------------------------------------------------------------------
-- 2) Granular RUNNING master roles (grouped by division). Leaders excluded
--    (Race Director / Head Marshall / Captain are internal, never recruited).
------------------------------------------------------------------------------
INSERT INTO talent_positions (key, label_id, label_en, division, sort, is_active) VALUES
  ('run_marshall_static',        'Marshall Statis',                  'Static Marshall',              'Marshall',      300, true),
  ('run_mobile_marshall',        'Mobile Marshall',                  'Mobile Marshall',              'Marshall',      301, true),
  ('run_mobile_marshall_pw',     'Mobile Marshall Potential Winner', 'Mobile Marshall (Pot. Winner)','Marshall',      302, true),
  ('run_crew_start_finish',      'Crew Start Finish',                'Start/Finish Crew',            'Start/Finish',  310, true),
  ('run_crew_floor_runners_line','Crew Floor - Runners Line',        'Floor Crew - Runners Line',    'Start/Finish',  311, true),
  ('run_crew_water_station',     'Crew Water Station',               'Water Station Crew',           'Water Station', 320, true),
  ('run_deploy_water_station',   'Tim Deploy Water Station',         'Water Station Deploy Team',    'Water Station', 321, true),
  ('run_crew_refreshment',       'Crew Refreshment',                 'Refreshment Crew',             'Refreshment',   330, true),
  ('run_deploy_refreshment',     'Tim Deploy Refreshment',           'Refreshment Deploy Team',      'Refreshment',   331, true),
  ('run_crew_drop_bag',          'Crew Drop Bag',                    'Drop Bag Crew',                'Drop Bag',      340, true),
  ('run_information_crew',       'Information Crew',                  'Information Crew',             'Information',   350, true)
ON CONFLICT (key) DO UPDATE
  SET label_id = EXCLUDED.label_id, label_en = EXCLUDED.label_en,
      division = EXCLUDED.division, sort = EXCLUDED.sort, is_active = true;

------------------------------------------------------------------------------
-- 3) role_templates: per (event_type, position) default quota + division + order.
--    role_name is read from the joined talent_positions label (no duplication).
------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS role_templates (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type_id uuid NOT NULL REFERENCES event_types(id) ON DELETE CASCADE,
  position_id   uuid NOT NULL REFERENCES talent_positions(id),
  division      text,
  default_quota integer NOT NULL DEFAULT 1 CHECK (default_quota >= 0),
  sort_order    integer NOT NULL DEFAULT 0,
  description   text,
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_type_id, position_id)
);
CREATE INDEX IF NOT EXISTS idx_role_templates_type ON role_templates(event_type_id);
ALTER TABLE role_templates ENABLE ROW LEVEL SECURITY;   -- deny-all; service role bypasses

-- Seed the RUNNING template (event_type key = 'lari'). HYROX ('hyrox') is left
-- WITHOUT a template on purpose — the create-event form handles the empty case.
WITH seed(pos_key, division, default_quota, sort_order) AS (VALUES
  ('run_marshall_static',        'Marshall',      20, 300),
  ('run_mobile_marshall',        'Marshall',      10, 301),
  ('run_mobile_marshall_pw',     'Marshall',       4, 302),
  ('run_crew_start_finish',      'Start/Finish',  10, 310),
  ('run_crew_floor_runners_line','Start/Finish',   8, 311),
  ('run_crew_water_station',     'Water Station', 10, 320),
  ('run_deploy_water_station',   'Water Station',  5, 321),
  ('run_crew_refreshment',       'Refreshment',   10, 330),
  ('run_deploy_refreshment',     'Refreshment',   15, 331),
  ('run_crew_drop_bag',          'Drop Bag',       4, 340),
  ('run_information_crew',       'Information',    2, 350)
)
INSERT INTO role_templates (event_type_id, position_id, division, default_quota, sort_order)
SELECT et.id, p.id, s.division, s.default_quota, s.sort_order
FROM seed s
JOIN talent_positions p ON p.key = s.pos_key
JOIN event_types et     ON et.key = 'lari'
ON CONFLICT (event_type_id, position_id) DO UPDATE
  SET division = EXCLUDED.division, default_quota = EXCLUDED.default_quota,
      sort_order = EXCLUDED.sort_order, is_active = true, updated_at = now();

------------------------------------------------------------------------------
-- 4) event_role_quota_logs (audit trail for every quota change)
------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS event_role_quota_logs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_role_id uuid NOT NULL REFERENCES talent_event_positions(id) ON DELETE CASCADE,
  old_quota     integer,
  new_quota     integer NOT NULL,
  changed_by    uuid,
  changed_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_quota_logs_role ON event_role_quota_logs(event_role_id);
ALTER TABLE event_role_quota_logs ENABLE ROW LEVEL SECURITY;   -- deny-all

------------------------------------------------------------------------------
-- 5) approved-count helper (approved = an accepted choice for that role/event)
------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION event_role_approved_count(p_event_id uuid, p_position_id uuid)
RETURNS integer LANGUAGE sql STABLE AS $$
  SELECT count(*)::int
  FROM talent_application_choices c
  JOIN talent_applications a ON a.id = c.application_id
  WHERE a.event_id = p_event_id AND c.position_id = p_position_id AND c.accepted = true;
$$;

------------------------------------------------------------------------------
-- 6) Quota guard + log triggers (fire on ANY quota UPDATE, incl. form saves).
--    changed_by is carried via a tx-local GUC 'app.actor' set by the RPC/app.
------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION trg_event_role_quota_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE approved int;
BEGIN
  IF NEW.quota IS DISTINCT FROM OLD.quota THEN
    IF NEW.quota < 0 THEN
      RAISE EXCEPTION 'QUOTA_NEGATIVE';
    END IF;
    approved := event_role_approved_count(NEW.event_id, NEW.position_id);
    IF NEW.quota < approved THEN
      RAISE EXCEPTION 'QUOTA_BELOW_APPROVED:%', approved USING ERRCODE = 'check_violation';
    END IF;
    NEW.updated_at := now();
  END IF;
  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION trg_event_role_quota_log() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE actor uuid;
BEGIN
  IF NEW.quota IS DISTINCT FROM OLD.quota THEN
    BEGIN
      actor := nullif(current_setting('app.actor', true), '')::uuid;
    EXCEPTION WHEN others THEN
      actor := NULL;
    END;
    INSERT INTO event_role_quota_logs(event_role_id, old_quota, new_quota, changed_by)
      VALUES (NEW.id, OLD.quota, NEW.quota, actor);
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS event_role_quota_guard ON talent_event_positions;
CREATE TRIGGER event_role_quota_guard BEFORE UPDATE ON talent_event_positions
  FOR EACH ROW EXECUTE FUNCTION trg_event_role_quota_guard();
DROP TRIGGER IF EXISTS event_role_quota_log ON talent_event_positions;
CREATE TRIGGER event_role_quota_log AFTER UPDATE ON talent_event_positions
  FOR EACH ROW EXECUTE FUNCTION trg_event_role_quota_log();

------------------------------------------------------------------------------
-- 7) RPC: change a role's quota (row lock -> guard/log handled by the triggers)
------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_event_role_quota(
  p_event_role_id uuid, p_new_quota integer, p_changed_by uuid DEFAULT NULL
) RETURNS talent_event_positions
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r talent_event_positions;
BEGIN
  PERFORM set_config('app.actor', COALESCE(p_changed_by::text, ''), true);
  SELECT * INTO r FROM talent_event_positions WHERE id = p_event_role_id FOR UPDATE;  -- row lock
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ROLE_NOT_FOUND';
  END IF;
  UPDATE talent_event_positions SET quota = p_new_quota WHERE id = p_event_role_id
    RETURNING * INTO r;   -- BEFORE trigger enforces quota >= approved, AFTER trigger logs
  RETURN r;
END; $$;

------------------------------------------------------------------------------
-- 8) RPC: race-safe approve (replaces the app's in-process withEventLock).
--    The app still sends the acceptance email + auto-declines the talent's
--    other picks after 'ok'.
------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION approve_application_choice(
  p_application_id uuid, p_position_id uuid,
  p_reviewer_id uuid DEFAULT NULL, p_actor_name text DEFAULT NULL
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_event uuid; v_prev text; v_quota int; approved int;
BEGIN
  SELECT event_id, status INTO v_event, v_prev
    FROM talent_applications WHERE id = p_application_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN 'not_found';
  END IF;

  PERFORM 1 FROM talent_application_choices
    WHERE application_id = p_application_id AND position_id = p_position_id;
  IF NOT FOUND THEN
    RETURN 'skip';                       -- not one of the applicant's picks
  END IF;

  SELECT quota INTO v_quota FROM talent_event_positions
    WHERE event_id = v_event AND position_id = p_position_id FOR UPDATE;   -- lock the role row

  approved := (SELECT count(*) FROM talent_application_choices c
               JOIN talent_applications a ON a.id = c.application_id
               WHERE a.event_id = v_event AND c.position_id = p_position_id
                 AND c.accepted AND c.application_id <> p_application_id);
  IF COALESCE(v_quota, 0) > 0 AND approved >= v_quota THEN
    RETURN 'full';
  END IF;

  UPDATE talent_application_choices SET accepted = false WHERE application_id = p_application_id;
  UPDATE talent_application_choices SET accepted = true, outcome = 'accepted'
    WHERE application_id = p_application_id AND position_id = p_position_id;
  UPDATE talent_applications SET status = 'approved', reviewed_by = p_reviewer_id, reviewed_at = now()
    WHERE id = p_application_id;
  INSERT INTO talent_application_status_log(application_id, from_status, to_status, changed_by, actor_name)
    VALUES (p_application_id, v_prev, 'approved', p_reviewer_id, p_actor_name);
  RETURN 'ok';
END; $$;

------------------------------------------------------------------------------
-- 9) Lock RPC execution down to the backend (service) role only
------------------------------------------------------------------------------
REVOKE ALL ON FUNCTION set_event_role_quota(uuid, integer, uuid)            FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION approve_application_choice(uuid, uuid, uuid, text)    FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION set_event_role_quota(uuid, integer, uuid)          TO service_role;
GRANT EXECUTE ON FUNCTION approve_application_choice(uuid, uuid, uuid, text)  TO service_role;

------------------------------------------------------------------------------
-- 10) OPTIONAL hardening / backfill — review, then uncomment to run.
------------------------------------------------------------------------------
-- Enable RLS on event_types (currently OFF). Safe: the app uses the service role.
-- ALTER TABLE event_types ENABLE ROW LEVEL SECURITY;

-- Backfill event_type_id on existing events from their category label:
-- UPDATE talent_events e SET event_type_id = t.id
--   FROM event_types t
--   WHERE e.event_type_id IS NULL AND e.category IN (t.label_id, t.label_en);

-- Backfill division on existing event roles from the master position:
-- UPDATE talent_event_positions ep SET division = p.division
--   FROM talent_positions p
--   WHERE ep.position_id = p.id AND ep.division IS NULL;
