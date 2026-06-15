
-- Schema parity with Welcoming Pages (assets, consumables, service_schedules)

-- 1) Extend inventory_items with WP asset columns
ALTER TABLE public.inventory_items
  ADD COLUMN IF NOT EXISTS description text DEFAULT '',
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'available',
  ADD COLUMN IF NOT EXISTS tags text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS barcode text DEFAULT '',
  ADD COLUMN IF NOT EXISTS current_hours numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS current_miles numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS usage_tracking text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS min_quantity numeric;

-- Backfill min_quantity from existing reorder_level so both stay in sync
UPDATE public.inventory_items
  SET min_quantity = reorder_level
  WHERE min_quantity IS NULL AND reorder_level IS NOT NULL;

-- Validate status via trigger (avoid CHECK on text that may be backfilled)
CREATE OR REPLACE FUNCTION public.validate_inventory_status()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.status IS NULL OR NEW.status = '' THEN NEW.status := 'available'; END IF;
  IF NEW.status NOT IN ('available','in_use','maintenance','retired') THEN
    RAISE EXCEPTION 'invalid status %, must be available|in_use|maintenance|retired', NEW.status;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS validate_inventory_status_trg ON public.inventory_items;
CREATE TRIGGER validate_inventory_status_trg
  BEFORE INSERT OR UPDATE ON public.inventory_items
  FOR EACH ROW EXECUTE FUNCTION public.validate_inventory_status();

-- 2) Extend maintenance_records with WP service_schedules columns
ALTER TABLE public.maintenance_records
  ADD COLUMN IF NOT EXISTS title text,
  ADD COLUMN IF NOT EXISTS description text DEFAULT '',
  ADD COLUMN IF NOT EXISTS asset_id uuid REFERENCES public.inventory_items(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS scheduled_date timestamptz,
  ADD COLUMN IF NOT EXISTS completed_date timestamptz,
  ADD COLUMN IF NOT EXISTS recurrence text DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS consumables_used jsonb NOT NULL DEFAULT '[]'::jsonb;

CREATE INDEX IF NOT EXISTS maintenance_records_asset_id_idx
  ON public.maintenance_records(asset_id);

-- 3) New consumables table (WP parity)
CREATE TABLE IF NOT EXISTS public.consumables (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  name text NOT NULL,
  unit text DEFAULT 'pcs',
  quantity_in_stock numeric NOT NULL DEFAULT 0,
  min_quantity numeric NOT NULL DEFAULT 0,
  cost_per_unit numeric(10,2) DEFAULT 0,
  category text DEFAULT '',
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.consumables TO authenticated;
GRANT ALL ON public.consumables TO service_role;

ALTER TABLE public.consumables ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own consumables" ON public.consumables
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users insert own consumables" ON public.consumables
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own consumables" ON public.consumables
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users delete own consumables" ON public.consumables
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

DROP TRIGGER IF EXISTS consumables_updated_at_trg ON public.consumables;
CREATE TRIGGER consumables_updated_at_trg
  BEFORE UPDATE ON public.consumables
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
