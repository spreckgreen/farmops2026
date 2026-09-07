ALTER TABLE public.inventory_items
  ADD COLUMN IF NOT EXISTS rack_units integer;

ALTER TABLE public.inventory_components
  ADD COLUMN IF NOT EXISTS rack_units integer,
  ADD COLUMN IF NOT EXISTS rack_position_u integer;

ALTER TABLE public.inventory_items
  DROP CONSTRAINT IF EXISTS inventory_items_rack_units_positive;
ALTER TABLE public.inventory_items
  ADD CONSTRAINT inventory_items_rack_units_positive
  CHECK (rack_units IS NULL OR rack_units > 0);

ALTER TABLE public.inventory_components
  DROP CONSTRAINT IF EXISTS inventory_components_rack_units_positive;
ALTER TABLE public.inventory_components
  ADD CONSTRAINT inventory_components_rack_units_positive
  CHECK (rack_units IS NULL OR rack_units > 0);

ALTER TABLE public.inventory_components
  DROP CONSTRAINT IF EXISTS inventory_components_rack_position_positive;
ALTER TABLE public.inventory_components
  ADD CONSTRAINT inventory_components_rack_position_positive
  CHECK (rack_position_u IS NULL OR rack_position_u >= 1);

COMMENT ON COLUMN public.inventory_items.rack_units IS
  'Height of this item in rack spaces (U) when it is rack mounted. NULL when unknown or not rack mounted.';
COMMENT ON COLUMN public.inventory_components.rack_units IS
  'Height in rack spaces (U) for this specific placement; overrides the item height when set.';
COMMENT ON COLUMN public.inventory_components.rack_position_u IS
  'Lowest rack space (U) this part occupies, counted from the bottom of the rack. NULL when not yet placed.';