CREATE OR REPLACE FUNCTION public.snapshot_asset_usage()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF (NEW.current_hours IS NOT NULL AND NEW.current_hours > 0)
       OR (NEW.current_miles IS NOT NULL AND NEW.current_miles > 0) THEN
      INSERT INTO public.asset_usage_snapshots (user_id, inventory_item_id, hours, miles)
      VALUES (NEW.user_id, NEW.id,
              NULLIF(NEW.current_hours, 0),
              NULLIF(NEW.current_miles, 0));
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.current_hours IS DISTINCT FROM OLD.current_hours
     OR NEW.current_miles IS DISTINCT FROM OLD.current_miles THEN
    INSERT INTO public.asset_usage_snapshots (user_id, inventory_item_id, hours, miles)
    VALUES (NEW.user_id, NEW.id,
            NULLIF(NEW.current_hours, 0),
            NULLIF(NEW.current_miles, 0));
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.snapshot_asset_usage() FROM PUBLIC, anon, authenticated;