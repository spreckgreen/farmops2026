-- Planner nutrition targets and preferred USDA preparation form.
ALTER TABLE public.food_plan_people
  ADD COLUMN IF NOT EXISTS nutrition_targets jsonb NOT NULL DEFAULT
    '{"energyKcal":2000,"proteinG":50,"fatG":78,"carbohydrateG":275,"fiberG":28,"sugarG":null,"sodiumMg":2300}'::jsonb;

ALTER TABLE public.food_plan_foods
  ADD COLUMN IF NOT EXISTS nutrition_form text NOT NULL DEFAULT 'As listed';

ALTER TABLE public.food_plan_people
  DROP CONSTRAINT IF EXISTS food_plan_people_nutrition_targets_object;
ALTER TABLE public.food_plan_people
  ADD CONSTRAINT food_plan_people_nutrition_targets_object
  CHECK (jsonb_typeof(nutrition_targets) = 'object');

ALTER TABLE public.food_plan_foods
  DROP CONSTRAINT IF EXISTS food_plan_foods_nutrition_form_not_blank;
ALTER TABLE public.food_plan_foods
  ADD CONSTRAINT food_plan_foods_nutrition_form_not_blank
  CHECK (btrim(nutrition_form) <> '');

COMMENT ON COLUMN public.food_plan_people.nutrition_targets IS
  'Per-person daily nutrition comparison targets. Defaults to FDA adult Daily Values and may be customized.';
COMMENT ON COLUMN public.food_plan_foods.nutrition_form IS
  'Preferred approved USDA food form used by the planner assessment.';
