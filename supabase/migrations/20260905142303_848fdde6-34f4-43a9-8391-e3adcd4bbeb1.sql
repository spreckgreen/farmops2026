ALTER TABLE public.cameras
  ADD COLUMN IF NOT EXISTS ring_model text,
  ADD COLUMN IF NOT EXISTS compass_side text,
  ADD COLUMN IF NOT EXISTS side_slot integer;

ALTER TABLE public.cameras
  ADD CONSTRAINT cameras_compass_side_check
  CHECK (compass_side IS NULL OR compass_side IN ('N','NE','E','SE','S','SW','W','NW'));

ALTER TABLE public.cameras
  ADD CONSTRAINT cameras_side_slot_check
  CHECK (side_slot IS NULL OR side_slot >= 1);