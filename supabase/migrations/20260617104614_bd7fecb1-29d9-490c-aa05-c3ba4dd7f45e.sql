ALTER TABLE public.orchard_trees ADD COLUMN IF NOT EXISTS category text;
CREATE INDEX IF NOT EXISTS orchard_trees_category_idx ON public.orchard_trees(category);