ALTER TABLE public.electrical_junction_boxes
  ADD COLUMN IF NOT EXISTS raceway_uuid uuid REFERENCES public.electrical_raceways(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS raceway_sequence integer,
  ADD COLUMN IF NOT EXISTS raceway_ref text;

ALTER TABLE public.electrical_junction_boxes
  DROP CONSTRAINT IF EXISTS electrical_junction_boxes_raceway_sequence_positive;
ALTER TABLE public.electrical_junction_boxes
  ADD CONSTRAINT electrical_junction_boxes_raceway_sequence_positive
  CHECK (raceway_sequence IS NULL OR raceway_sequence > 0);

CREATE UNIQUE INDEX IF NOT EXISTS electrical_junction_boxes_raceway_sequence_key
  ON public.electrical_junction_boxes (raceway_uuid, raceway_sequence)
  WHERE raceway_uuid IS NOT NULL AND raceway_sequence IS NOT NULL;

CREATE INDEX IF NOT EXISTS electrical_junction_boxes_raceway_uuid_idx
  ON public.electrical_junction_boxes (raceway_uuid);