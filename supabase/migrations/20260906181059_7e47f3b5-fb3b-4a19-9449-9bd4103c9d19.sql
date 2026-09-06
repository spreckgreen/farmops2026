ALTER TABLE public.site_buildings
  ADD COLUMN IF NOT EXISTS building_role text,
  ADD COLUMN IF NOT EXISTS parent_building_id uuid REFERENCES public.site_buildings(id) ON DELETE SET NULL;

ALTER TABLE public.site_buildings
  DROP CONSTRAINT IF EXISTS site_buildings_building_role_check;
ALTER TABLE public.site_buildings
  ADD CONSTRAINT site_buildings_building_role_check
  CHECK (building_role IS NULL OR building_role IN ('PRIMARY','OUTBUILDING'));

ALTER TABLE public.site_buildings
  DROP CONSTRAINT IF EXISTS site_buildings_parent_not_self;
ALTER TABLE public.site_buildings
  ADD CONSTRAINT site_buildings_parent_not_self
  CHECK (parent_building_id IS NULL OR parent_building_id <> id);

CREATE INDEX IF NOT EXISTS site_buildings_parent_idx
  ON public.site_buildings(parent_building_id);

CREATE OR REPLACE FUNCTION public.site_buildings_validate_parent()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  parent_site uuid;
BEGIN
  IF NEW.parent_building_id IS NOT NULL THEN
    SELECT site_plan_id INTO parent_site FROM public.site_buildings WHERE id = NEW.parent_building_id;
    IF parent_site IS NULL THEN
      RAISE EXCEPTION 'Parent building not found';
    END IF;
    IF parent_site <> NEW.site_plan_id THEN
      RAISE EXCEPTION 'A building can only belong to a parent on the same site';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS site_buildings_validate_parent_trg ON public.site_buildings;
CREATE TRIGGER site_buildings_validate_parent_trg
  BEFORE INSERT OR UPDATE ON public.site_buildings
  FOR EACH ROW EXECUTE FUNCTION public.site_buildings_validate_parent();