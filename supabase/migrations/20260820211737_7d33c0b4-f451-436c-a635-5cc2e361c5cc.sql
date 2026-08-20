ALTER TABLE public.daily_notes
  ADD COLUMN IF NOT EXISTS energy_level smallint,
  ADD COLUMN IF NOT EXISTS productivity_level smallint;

ALTER TABLE public.daily_notes
  DROP CONSTRAINT IF EXISTS daily_notes_energy_level_check;
ALTER TABLE public.daily_notes
  ADD CONSTRAINT daily_notes_energy_level_check CHECK (energy_level IS NULL OR energy_level BETWEEN 1 AND 5);

ALTER TABLE public.daily_notes
  DROP CONSTRAINT IF EXISTS daily_notes_productivity_level_check;
ALTER TABLE public.daily_notes
  ADD CONSTRAINT daily_notes_productivity_level_check CHECK (productivity_level IS NULL OR productivity_level BETWEEN 1 AND 5);