-- 1. CREATE TABLE
CREATE TABLE public.asset_usage_snapshots (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  inventory_item_id uuid NOT NULL REFERENCES public.inventory_items(id) ON DELETE CASCADE,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  hours numeric,
  miles numeric,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX asset_usage_snapshots_item_time_idx
  ON public.asset_usage_snapshots (inventory_item_id, recorded_at DESC);
CREATE INDEX asset_usage_snapshots_user_idx
  ON public.asset_usage_snapshots (user_id);

-- 2. GRANT
GRANT SELECT, INSERT, UPDATE, DELETE ON public.asset_usage_snapshots TO authenticated;
GRANT ALL ON public.asset_usage_snapshots TO service_role;

-- 3. ENABLE RLS
ALTER TABLE public.asset_usage_snapshots ENABLE ROW LEVEL SECURITY;

-- 4. POLICIES
CREATE POLICY "Users read own usage snapshots"
  ON public.asset_usage_snapshots FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Users insert own usage snapshots"
  ON public.asset_usage_snapshots FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users update own usage snapshots"
  ON public.asset_usage_snapshots FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users delete own usage snapshots"
  ON public.asset_usage_snapshots FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

-- Auto-snapshot trigger on inventory_items
CREATE OR REPLACE FUNCTION public.snapshot_asset_usage()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only snapshot when hours or miles actually change (and are set)
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

DROP TRIGGER IF EXISTS trg_snapshot_asset_usage ON public.inventory_items;
CREATE TRIGGER trg_snapshot_asset_usage
  AFTER INSERT OR UPDATE OF current_hours, current_miles
  ON public.inventory_items
  FOR EACH ROW
  EXECUTE FUNCTION public.snapshot_asset_usage();

-- Backfill a starting snapshot for existing items that already have usage
INSERT INTO public.asset_usage_snapshots (user_id, inventory_item_id, hours, miles, recorded_at)
SELECT user_id, id,
       NULLIF(current_hours, 0),
       NULLIF(current_miles, 0),
       COALESCE(updated_at, created_at, now())
FROM public.inventory_items
WHERE (current_hours IS NOT NULL AND current_hours > 0)
   OR (current_miles IS NOT NULL AND current_miles > 0);