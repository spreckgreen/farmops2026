-- ============================================================================
-- Electrical Phase 4.1 — database-layer integrity.
-- No table or column changes: constraints, triggers and indexes only.
-- ============================================================================

-- ---------------------------------------------------------------- stable IDs
CREATE UNIQUE INDEX IF NOT EXISTS electrical_panels_user_stable_id_key
  ON public.electrical_panels (user_id, panel_id);
CREATE UNIQUE INDEX IF NOT EXISTS electrical_raceways_user_stable_id_key
  ON public.electrical_raceways (user_id, conduit_id);
CREATE UNIQUE INDEX IF NOT EXISTS electrical_junction_boxes_user_stable_id_key
  ON public.electrical_junction_boxes (user_id, jbox_id);
CREATE UNIQUE INDEX IF NOT EXISTS electrical_branch_runs_user_stable_id_key
  ON public.electrical_branch_runs (user_id, branch_id);
CREATE UNIQUE INDEX IF NOT EXISTS electrical_loads_user_stable_id_key
  ON public.electrical_loads (user_id, load_id);
CREATE UNIQUE INDEX IF NOT EXISTS electrical_circuit_groups_user_stable_id_key
  ON public.electrical_circuit_groups (user_id, circuit_group_id);

-- ------------------------------------------------------- controlled vocabularies
CREATE OR REPLACE FUNCTION public.electrical_allowed(_domain text)
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE _domain
    WHEN 'install_status' THEN ARRAY['planned','material_ready','rough_in_started','raceway_installed','conductors_installed','device_side_connected','source_side_connected','tested','complete','as_built_verified']
    WHEN 'label_status'   THEN ARRAY['none','queued','printed','installed','reprint']
    WHEN 'label_class'    THEN ARRAY['load_device_circuit','panel_breaker','raceway_conduit','junction_box','branch_run']
    WHEN 'endpoint_type'  THEN ARRAY['panel','junction_box','equipment','handhole','load','other']
    WHEN 'environment'    THEN ARRAY['INTERIOR','SITE_UNDERGROUND','SITE_EXTERIOR','BUILDING_TRANSITION']
    WHEN 'exit_side'      THEN ARRAY['Lower Right','Right','Upper Right','Top','Upper Left','Left','Lower Left','Bottom']
    ELSE ARRAY[]::text[]
  END
$$;

-- Validates only values that are being written or changed, so legitimate
-- pre-existing imported values are never invalidated retroactively.
CREATE OR REPLACE FUNCTION public.electrical_validate_controlled()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  newj jsonb := to_jsonb(NEW);
  oldj jsonb := CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) ELSE '{}'::jsonb END;
  spec text;
  parts text[];
  col text;
  dom text;
  val text;
  prev text;
BEGIN
  FOREACH spec IN ARRAY TG_ARGV LOOP
    parts := string_to_array(spec, ':');
    col := parts[1];
    dom := parts[2];
    IF NOT (newj ? col) THEN CONTINUE; END IF;
    val := newj->>col;
    IF val IS NULL OR val = '' THEN CONTINUE; END IF;
    prev := oldj->>col;
    IF TG_OP = 'UPDATE' AND prev IS NOT DISTINCT FROM val THEN CONTINUE; END IF;
    IF NOT (val = ANY (public.electrical_allowed(dom))) THEN
      RAISE EXCEPTION '% is not a valid %.% value. Allowed: %',
        val, TG_TABLE_NAME, col, array_to_string(public.electrical_allowed(dom), ', ');
    END IF;
  END LOOP;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS electrical_panels_controlled ON public.electrical_panels;
CREATE TRIGGER electrical_panels_controlled
  BEFORE INSERT OR UPDATE ON public.electrical_panels
  FOR EACH ROW EXECUTE FUNCTION public.electrical_validate_controlled('install_status:install_status', 'label_status:label_status');

DROP TRIGGER IF EXISTS electrical_junction_boxes_controlled ON public.electrical_junction_boxes;
CREATE TRIGGER electrical_junction_boxes_controlled
  BEFORE INSERT OR UPDATE ON public.electrical_junction_boxes
  FOR EACH ROW EXECUTE FUNCTION public.electrical_validate_controlled('install_status:install_status', 'label_status:label_status');

DROP TRIGGER IF EXISTS electrical_loads_controlled ON public.electrical_loads;
CREATE TRIGGER electrical_loads_controlled
  BEFORE INSERT OR UPDATE ON public.electrical_loads
  FOR EACH ROW EXECUTE FUNCTION public.electrical_validate_controlled('install_status:install_status', 'label_status:label_status');

DROP TRIGGER IF EXISTS electrical_circuit_groups_controlled ON public.electrical_circuit_groups;
CREATE TRIGGER electrical_circuit_groups_controlled
  BEFORE INSERT OR UPDATE ON public.electrical_circuit_groups
  FOR EACH ROW EXECUTE FUNCTION public.electrical_validate_controlled('install_status:install_status', 'label_status:label_status');

DROP TRIGGER IF EXISTS electrical_raceways_controlled ON public.electrical_raceways;
CREATE TRIGGER electrical_raceways_controlled
  BEFORE INSERT OR UPDATE ON public.electrical_raceways
  FOR EACH ROW EXECUTE FUNCTION public.electrical_validate_controlled(
    'install_status:install_status', 'label_status:label_status', 'environment:environment',
    'source_endpoint_type:endpoint_type', 'dest_endpoint_type:endpoint_type', 'exit_side:exit_side');

DROP TRIGGER IF EXISTS electrical_branch_runs_controlled ON public.electrical_branch_runs;
CREATE TRIGGER electrical_branch_runs_controlled
  BEFORE INSERT OR UPDATE ON public.electrical_branch_runs
  FOR EACH ROW EXECUTE FUNCTION public.electrical_validate_controlled(
    'install_status:install_status', 'label_status:label_status',
    'source_endpoint_type:endpoint_type', 'dest_endpoint_type:endpoint_type');

DROP TRIGGER IF EXISTS electrical_labels_controlled ON public.electrical_labels;
CREATE TRIGGER electrical_labels_controlled
  BEFORE INSERT OR UPDATE ON public.electrical_labels
  FOR EACH ROW EXECUTE FUNCTION public.electrical_validate_controlled('state:label_status', 'label_class:label_class');

-- ------------------------------------------------ endpoint / relationship integrity
-- When a real entity is linked, the FK is authoritative: the endpoint type and
-- the human-readable stable ID are derived from it so they can never disagree.
CREATE OR REPLACE FUNCTION public.electrical_validate_raceway_endpoints()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE sid text;
BEGIN
  IF NEW.source_panel_uuid IS NOT NULL AND NEW.source_jbox_uuid IS NOT NULL THEN
    RAISE EXCEPTION 'A raceway source cannot be both a panel and a junction box.';
  END IF;
  IF NEW.dest_panel_uuid IS NOT NULL AND NEW.dest_jbox_uuid IS NOT NULL THEN
    RAISE EXCEPTION 'A raceway destination cannot be both a panel and a junction box.';
  END IF;
  IF NEW.source_panel_uuid IS NOT NULL AND NEW.source_panel_uuid = NEW.dest_panel_uuid THEN
    RAISE EXCEPTION 'A raceway cannot start and end at the same panel.';
  END IF;
  IF NEW.source_jbox_uuid IS NOT NULL AND NEW.source_jbox_uuid = NEW.dest_jbox_uuid THEN
    RAISE EXCEPTION 'A raceway cannot start and end at the same junction box.';
  END IF;

  IF NEW.source_panel_uuid IS NOT NULL THEN
    IF NEW.source_endpoint_type IS NOT NULL AND NEW.source_endpoint_type <> 'panel' THEN
      RAISE EXCEPTION 'source_endpoint_type "%" contradicts the linked panel.', NEW.source_endpoint_type;
    END IF;
    SELECT panel_id INTO sid FROM public.electrical_panels WHERE id = NEW.source_panel_uuid;
    IF sid IS NULL THEN RAISE EXCEPTION 'Linked source panel does not exist.'; END IF;
    NEW.source_endpoint_type := 'panel';
    NEW.source_endpoint_ref := sid;
  ELSIF NEW.source_jbox_uuid IS NOT NULL THEN
    IF NEW.source_endpoint_type IS NOT NULL AND NEW.source_endpoint_type <> 'junction_box' THEN
      RAISE EXCEPTION 'source_endpoint_type "%" contradicts the linked junction box.', NEW.source_endpoint_type;
    END IF;
    SELECT jbox_id INTO sid FROM public.electrical_junction_boxes WHERE id = NEW.source_jbox_uuid;
    IF sid IS NULL THEN RAISE EXCEPTION 'Linked source junction box does not exist.'; END IF;
    NEW.source_endpoint_type := 'junction_box';
    NEW.source_endpoint_ref := sid;
  END IF;

  IF NEW.dest_panel_uuid IS NOT NULL THEN
    IF NEW.dest_endpoint_type IS NOT NULL AND NEW.dest_endpoint_type <> 'panel' THEN
      RAISE EXCEPTION 'dest_endpoint_type "%" contradicts the linked panel.', NEW.dest_endpoint_type;
    END IF;
    SELECT panel_id INTO sid FROM public.electrical_panels WHERE id = NEW.dest_panel_uuid;
    IF sid IS NULL THEN RAISE EXCEPTION 'Linked destination panel does not exist.'; END IF;
    NEW.dest_endpoint_type := 'panel';
    NEW.dest_endpoint_ref := sid;
  ELSIF NEW.dest_jbox_uuid IS NOT NULL THEN
    IF NEW.dest_endpoint_type IS NOT NULL AND NEW.dest_endpoint_type <> 'junction_box' THEN
      RAISE EXCEPTION 'dest_endpoint_type "%" contradicts the linked junction box.', NEW.dest_endpoint_type;
    END IF;
    SELECT jbox_id INTO sid FROM public.electrical_junction_boxes WHERE id = NEW.dest_jbox_uuid;
    IF sid IS NULL THEN RAISE EXCEPTION 'Linked destination junction box does not exist.'; END IF;
    NEW.dest_endpoint_type := 'junction_box';
    NEW.dest_endpoint_ref := sid;
  END IF;

  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS electrical_raceways_endpoints ON public.electrical_raceways;
CREATE TRIGGER electrical_raceways_endpoints
  BEFORE INSERT OR UPDATE ON public.electrical_raceways
  FOR EACH ROW EXECUTE FUNCTION public.electrical_validate_raceway_endpoints();

CREATE OR REPLACE FUNCTION public.electrical_validate_branch_endpoints()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE sid text;
BEGIN
  IF NEW.source_panel_uuid IS NOT NULL AND NEW.source_jbox_uuid IS NOT NULL THEN
    RAISE EXCEPTION 'A branch run source cannot be both a panel and a junction box.';
  END IF;

  IF NEW.source_panel_uuid IS NOT NULL THEN
    IF NEW.source_endpoint_type IS NOT NULL AND NEW.source_endpoint_type <> 'panel' THEN
      RAISE EXCEPTION 'source_endpoint_type "%" contradicts the linked panel.', NEW.source_endpoint_type;
    END IF;
    SELECT panel_id INTO sid FROM public.electrical_panels WHERE id = NEW.source_panel_uuid;
    IF sid IS NULL THEN RAISE EXCEPTION 'Linked source panel does not exist.'; END IF;
    NEW.source_endpoint_type := 'panel';
    NEW.source_endpoint_ref := sid;
  ELSIF NEW.source_jbox_uuid IS NOT NULL THEN
    IF NEW.source_endpoint_type IS NOT NULL AND NEW.source_endpoint_type <> 'junction_box' THEN
      RAISE EXCEPTION 'source_endpoint_type "%" contradicts the linked junction box.', NEW.source_endpoint_type;
    END IF;
    SELECT jbox_id INTO sid FROM public.electrical_junction_boxes WHERE id = NEW.source_jbox_uuid;
    IF sid IS NULL THEN RAISE EXCEPTION 'Linked source junction box does not exist.'; END IF;
    NEW.source_endpoint_type := 'junction_box';
    NEW.source_endpoint_ref := sid;
  END IF;

  IF NEW.load_uuid IS NOT NULL THEN
    IF NEW.dest_endpoint_type IS NOT NULL AND NEW.dest_endpoint_type NOT IN ('load','equipment') THEN
      RAISE EXCEPTION 'dest_endpoint_type "%" contradicts the linked load.', NEW.dest_endpoint_type;
    END IF;
    SELECT load_id INTO sid FROM public.electrical_loads WHERE id = NEW.load_uuid;
    IF sid IS NULL THEN RAISE EXCEPTION 'Linked destination load does not exist.'; END IF;
    IF NEW.dest_endpoint_type IS NULL THEN NEW.dest_endpoint_type := 'load'; END IF;
    NEW.dest_endpoint_ref := sid;
  END IF;

  IF NEW.circuit_group_uuid IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.electrical_circuit_groups WHERE id = NEW.circuit_group_uuid) THEN
    RAISE EXCEPTION 'Linked circuit group does not exist.';
  END IF;

  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS electrical_branch_runs_endpoints ON public.electrical_branch_runs;
CREATE TRIGGER electrical_branch_runs_endpoints
  BEFORE INSERT OR UPDATE ON public.electrical_branch_runs
  FOR EACH ROW EXECUTE FUNCTION public.electrical_validate_branch_endpoints();

-- Loads and circuit groups: keep the FK and the readable reference in agreement.
CREATE OR REPLACE FUNCTION public.electrical_validate_load_links()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE sid text;
BEGIN
  IF NEW.circuit_group_uuid IS NOT NULL THEN
    SELECT circuit_group_id INTO sid FROM public.electrical_circuit_groups WHERE id = NEW.circuit_group_uuid;
    IF sid IS NULL THEN RAISE EXCEPTION 'Linked circuit group does not exist.'; END IF;
    NEW.circuit_group_ref := sid;
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS electrical_loads_links ON public.electrical_loads;
CREATE TRIGGER electrical_loads_links
  BEFORE INSERT OR UPDATE ON public.electrical_loads
  FOR EACH ROW EXECUTE FUNCTION public.electrical_validate_load_links();

CREATE OR REPLACE FUNCTION public.electrical_validate_group_links()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE sid text;
BEGIN
  IF NEW.panel_uuid IS NOT NULL THEN
    SELECT panel_id INTO sid FROM public.electrical_panels WHERE id = NEW.panel_uuid;
    IF sid IS NULL THEN RAISE EXCEPTION 'Linked panel does not exist.'; END IF;
    NEW.suggested_panel := sid;
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS electrical_circuit_groups_links ON public.electrical_circuit_groups;
CREATE TRIGGER electrical_circuit_groups_links
  BEFORE INSERT OR UPDATE ON public.electrical_circuit_groups
  FOR EACH ROW EXECUTE FUNCTION public.electrical_validate_group_links();
