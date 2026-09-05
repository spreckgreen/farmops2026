-- Logical vs physical panel classification.
ALTER TABLE public.electrical_panels
  ADD COLUMN IF NOT EXISTS panel_kind text NOT NULL DEFAULT 'physical',
  ADD COLUMN IF NOT EXISTS physical_panel_uuid uuid REFERENCES public.electrical_panels(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS logical_panel_note text;

CREATE INDEX IF NOT EXISTS electrical_panels_physical_panel_uuid_idx
  ON public.electrical_panels (physical_panel_uuid);

ALTER TABLE public.electrical_loads
  ADD COLUMN IF NOT EXISTS logical_panel_uuid uuid REFERENCES public.electrical_panels(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS logical_panel_ref text;

CREATE INDEX IF NOT EXISTS electrical_loads_logical_panel_uuid_idx
  ON public.electrical_loads (logical_panel_uuid);

ALTER TABLE public.electrical_circuit_groups
  ADD COLUMN IF NOT EXISTS logical_panel_uuid uuid REFERENCES public.electrical_panels(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS logical_panel_ref text;

CREATE INDEX IF NOT EXISTS electrical_circuit_groups_logical_panel_uuid_idx
  ON public.electrical_circuit_groups (logical_panel_uuid);

-- Allowed vocabulary for the new classification.
CREATE OR REPLACE FUNCTION public.electrical_panel_kinds()
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $$ SELECT ARRAY['physical','logical']::text[] $$;

-- A logical panel is a grouping policy, never panelboard equipment.
CREATE OR REPLACE FUNCTION public.electrical_validate_panel_kind()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  host_kind text;
BEGIN
  IF NEW.panel_kind IS NULL OR NEW.panel_kind = '' THEN
    NEW.panel_kind := 'physical';
  END IF;
  IF NOT (NEW.panel_kind = ANY (public.electrical_panel_kinds())) THEN
    RAISE EXCEPTION 'panel_kind "%" is not valid. Allowed: physical, logical', NEW.panel_kind;
  END IF;

  IF NEW.panel_kind = 'physical' THEN
    IF NEW.physical_panel_uuid IS NOT NULL THEN
      RAISE EXCEPTION 'Only a logical panel is hosted on a physical panel.';
    END IF;
    RETURN NEW;
  END IF;

  -- logical from here on
  IF NEW.physical_panel_uuid IS NULL THEN
    RAISE EXCEPTION 'A logical panel must record the physical panel that hosts its circuits.';
  END IF;
  IF NEW.physical_panel_uuid = NEW.id THEN
    RAISE EXCEPTION 'A logical panel cannot be hosted on itself.';
  END IF;

  SELECT panel_kind INTO host_kind FROM public.electrical_panels WHERE id = NEW.physical_panel_uuid;
  IF host_kind IS NULL THEN
    RAISE EXCEPTION 'The hosting physical panel does not exist.';
  END IF;
  IF host_kind <> 'physical' THEN
    RAISE EXCEPTION 'A logical panel must be hosted on a physical panel, not another logical panel.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.electrical_panels WHERE physical_panel_uuid = NEW.id) THEN
    RAISE EXCEPTION 'This panel already hosts a logical panel, so it cannot itself become logical.';
  END IF;

  -- No fictitious enclosure, bus or breaker capacity.
  IF NEW.spaces IS NOT NULL OR NEW.circuits IS NOT NULL OR NEW.breaker_columns IS NOT NULL
     OR NEW.positions_per_column IS NOT NULL OR NEW.bus_rating_amps IS NOT NULL THEN
    RAISE EXCEPTION 'A logical panel has no independent enclosure, bus or breaker capacity; those values belong to its hosting physical panel.';
  END IF;
  IF NEW.feeder_source IS NOT NULL THEN
    RAISE EXCEPTION 'A logical panel has no feeder of its own; record the feeder on the hosting physical panel.';
  END IF;

  -- No physical dependents may treat it as a source.
  IF EXISTS (SELECT 1 FROM public.electrical_breaker_positions WHERE panel_uuid = NEW.id) THEN
    RAISE EXCEPTION 'A logical panel cannot have breaker positions.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.electrical_circuit_groups WHERE panel_uuid = NEW.id) THEN
    RAISE EXCEPTION 'A logical panel cannot be the physical source of a circuit group.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.electrical_raceways
              WHERE source_panel_uuid = NEW.id OR dest_panel_uuid = NEW.id) THEN
    RAISE EXCEPTION 'A logical panel cannot be a raceway endpoint.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.electrical_feeders
              WHERE source_panel_uuid = NEW.id OR dest_panel_uuid = NEW.id) THEN
    RAISE EXCEPTION 'A logical panel cannot be a feeder endpoint.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.electrical_branch_runs WHERE source_panel_uuid = NEW.id) THEN
    RAISE EXCEPTION 'A logical panel cannot be the source of a branch run.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS electrical_panels_validate_kind ON public.electrical_panels;
CREATE TRIGGER electrical_panels_validate_kind
  BEFORE INSERT OR UPDATE ON public.electrical_panels
  FOR EACH ROW EXECUTE FUNCTION public.electrical_validate_panel_kind();

-- Physical paths may never point at a logical panel.
CREATE OR REPLACE FUNCTION public.electrical_reject_logical_physical_source()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  newj jsonb := to_jsonb(NEW);
  col text;
  ref uuid;
  kind text;
BEGIN
  FOREACH col IN ARRAY TG_ARGV LOOP
    IF NOT (newj ? col) THEN CONTINUE; END IF;
    ref := NULLIF(newj->>col, '')::uuid;
    IF ref IS NULL THEN CONTINUE; END IF;
    SELECT panel_kind INTO kind FROM public.electrical_panels WHERE id = ref;
    IF kind = 'logical' THEN
      RAISE EXCEPTION '%.% cannot reference a logical panel; logical panels carry no physical supply path.',
        TG_TABLE_NAME, col;
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS electrical_breaker_positions_reject_logical ON public.electrical_breaker_positions;
CREATE TRIGGER electrical_breaker_positions_reject_logical
  BEFORE INSERT OR UPDATE ON public.electrical_breaker_positions
  FOR EACH ROW EXECUTE FUNCTION public.electrical_reject_logical_physical_source('panel_uuid');

DROP TRIGGER IF EXISTS electrical_raceways_reject_logical ON public.electrical_raceways;
CREATE TRIGGER electrical_raceways_reject_logical
  BEFORE INSERT OR UPDATE ON public.electrical_raceways
  FOR EACH ROW EXECUTE FUNCTION public.electrical_reject_logical_physical_source('source_panel_uuid', 'dest_panel_uuid');

DROP TRIGGER IF EXISTS electrical_feeders_reject_logical ON public.electrical_feeders;
CREATE TRIGGER electrical_feeders_reject_logical
  BEFORE INSERT OR UPDATE ON public.electrical_feeders
  FOR EACH ROW EXECUTE FUNCTION public.electrical_reject_logical_physical_source('source_panel_uuid', 'dest_panel_uuid');

DROP TRIGGER IF EXISTS electrical_branch_runs_reject_logical ON public.electrical_branch_runs;
CREATE TRIGGER electrical_branch_runs_reject_logical
  BEFORE INSERT OR UPDATE ON public.electrical_branch_runs
  FOR EACH ROW EXECUTE FUNCTION public.electrical_reject_logical_physical_source('source_panel_uuid');

-- Logical assignment: must reference a logical panel, and keeps a readable ref.
CREATE OR REPLACE FUNCTION public.electrical_validate_logical_panel_link()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  kind text;
  sid text;
BEGIN
  IF NEW.logical_panel_uuid IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT panel_kind, panel_id INTO kind, sid
    FROM public.electrical_panels WHERE id = NEW.logical_panel_uuid;
  IF sid IS NULL THEN
    RAISE EXCEPTION 'Linked logical panel does not exist.';
  END IF;
  IF kind <> 'logical' THEN
    RAISE EXCEPTION 'Panel % is physical; a logical assignment must reference a logical panel.', sid;
  END IF;
  NEW.logical_panel_ref := sid;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS electrical_loads_validate_logical_panel ON public.electrical_loads;
CREATE TRIGGER electrical_loads_validate_logical_panel
  BEFORE INSERT OR UPDATE ON public.electrical_loads
  FOR EACH ROW EXECUTE FUNCTION public.electrical_validate_logical_panel_link();

DROP TRIGGER IF EXISTS electrical_circuit_groups_validate_logical_panel ON public.electrical_circuit_groups;
CREATE TRIGGER electrical_circuit_groups_validate_logical_panel
  BEFORE INSERT OR UPDATE ON public.electrical_circuit_groups
  FOR EACH ROW EXECUTE FUNCTION public.electrical_validate_logical_panel_link();

-- A circuit group's physical panel must stay physical.
DROP TRIGGER IF EXISTS electrical_circuit_groups_reject_logical ON public.electrical_circuit_groups;
CREATE TRIGGER electrical_circuit_groups_reject_logical
  BEFORE INSERT OR UPDATE ON public.electrical_circuit_groups
  FOR EACH ROW EXECUTE FUNCTION public.electrical_reject_logical_physical_source('panel_uuid');