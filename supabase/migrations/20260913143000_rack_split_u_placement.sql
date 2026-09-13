-- Allow two half-width devices to share the same vertical rack units.
ALTER TABLE public.inventory_components
  ADD COLUMN IF NOT EXISTS rack_lane text NOT NULL DEFAULT 'full';

ALTER TABLE public.inventory_components
  DROP CONSTRAINT IF EXISTS inventory_components_rack_lane_check;

ALTER TABLE public.inventory_components
  ADD CONSTRAINT inventory_components_rack_lane_check
  CHECK (rack_lane IN ('full', 'left', 'right'));

COMMENT ON COLUMN public.inventory_components.rack_lane IS
  'Horizontal rack-face placement: full width, left half, or right half.';
