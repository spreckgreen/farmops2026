-- Normalize legacy slug categories to canonical Price History buckets
UPDATE public.food_plan_foods SET category = 'Animal protein' WHERE category = 'livestock-meat';
UPDATE public.food_plan_foods SET category = 'Eggs'           WHERE category = 'livestock-eggs';
UPDATE public.food_plan_foods SET category = 'Dairy'          WHERE category = 'livestock-dairy';
UPDATE public.food_plan_foods SET category = 'Fiber'          WHERE category = 'livestock-fiber';

-- Constrain category to the canonical Price History categorization
ALTER TABLE public.food_plan_foods
  DROP CONSTRAINT IF EXISTS food_plan_foods_category_check;

ALTER TABLE public.food_plan_foods
  ADD CONSTRAINT food_plan_foods_category_check
  CHECK (
    category IS NULL OR category IN (
      'Vegetables',
      'Orchard (fruit/nut)',
      'Field crops',
      'Animal protein',
      'Dairy',
      'Eggs',
      'Fiber',
      'Beverages',
      'Pantry / staples',
      'Other'
    )
  );