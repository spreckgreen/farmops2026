ALTER TABLE public.inventory_items
  ADD COLUMN IF NOT EXISTS shipped_quantity numeric;