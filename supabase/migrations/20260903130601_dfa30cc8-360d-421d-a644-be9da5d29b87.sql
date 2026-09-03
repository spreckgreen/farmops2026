ALTER TABLE public.electrical_loads
  ADD COLUMN IF NOT EXISTS design_grid text,
  ADD COLUMN IF NOT EXISTS design_x_ft numeric,
  ADD COLUMN IF NOT EXISTS design_y_ft numeric,
  ADD COLUMN IF NOT EXISTS field_verification_status text,
  ADD COLUMN IF NOT EXISTS verification_notes text,
  ADD COLUMN IF NOT EXISTS location_evidence text,
  ADD COLUMN IF NOT EXISTS verified_at timestamptz;

ALTER TABLE public.electrical_panels
  ADD COLUMN IF NOT EXISTS design_grid text,
  ADD COLUMN IF NOT EXISTS design_x_ft numeric,
  ADD COLUMN IF NOT EXISTS design_y_ft numeric,
  ADD COLUMN IF NOT EXISTS field_verification_status text,
  ADD COLUMN IF NOT EXISTS verification_notes text,
  ADD COLUMN IF NOT EXISTS location_evidence text,
  ADD COLUMN IF NOT EXISTS verified_at timestamptz;

CREATE OR REPLACE FUNCTION public.electrical_allowed(_domain text)
 RETURNS text[]
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT CASE _domain
    WHEN 'install_status' THEN ARRAY['planned','material_ready','rough_in_started','raceway_installed','conductors_installed','device_side_connected','source_side_connected','tested','complete','as_built_verified']
    WHEN 'label_status'   THEN ARRAY['none','queued','printed','installed','reprint']
    WHEN 'label_class'    THEN ARRAY['load_device_circuit','panel_breaker','raceway_conduit','junction_box','branch_run']
    WHEN 'endpoint_type'  THEN ARRAY['panel','junction_box','equipment','handhole','load','other']
    WHEN 'environment'    THEN ARRAY['INTERIOR','SITE_UNDERGROUND','SITE_EXTERIOR','BUILDING_TRANSITION']
    WHEN 'exit_side'      THEN ARRAY['Lower Right','Right','Upper Right','Top','Upper Left','Left','Lower Left','Bottom']
    WHEN 'field_verification_status' THEN ARRAY['NOT_REVIEWED','FIELD_CONFIRMATION_REQUIRED','VERIFIED_AS_INSTALLED','UPDATED_FROM_FIELD_OBSERVATION','INTENTIONALLY_MOBILE','NOT_YET_INSTALLED']
    ELSE ARRAY[]::text[]
  END
$function$;

DROP TRIGGER IF EXISTS electrical_loads_controlled ON public.electrical_loads;
CREATE TRIGGER electrical_loads_controlled
  BEFORE INSERT OR UPDATE ON public.electrical_loads
  FOR EACH ROW EXECUTE FUNCTION public.electrical_validate_controlled(
    'install_status:install_status', 'label_status:label_status',
    'field_verification_status:field_verification_status');

DROP TRIGGER IF EXISTS electrical_panels_controlled ON public.electrical_panels;
CREATE TRIGGER electrical_panels_controlled
  BEFORE INSERT OR UPDATE ON public.electrical_panels
  FOR EACH ROW EXECUTE FUNCTION public.electrical_validate_controlled(
    'install_status:install_status', 'label_status:label_status',
    'field_verification_status:field_verification_status');