
CREATE TABLE public.food_price_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  food_id uuid REFERENCES public.food_plan_foods(id) ON DELETE SET NULL,
  food_name text NOT NULL,
  old_price numeric,
  new_price numeric,
  changed_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, DELETE ON public.food_price_history TO authenticated;
GRANT ALL ON public.food_price_history TO service_role;
ALTER TABLE public.food_price_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own price history select" ON public.food_price_history FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "own price history insert" ON public.food_price_history FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own price history delete" ON public.food_price_history FOR DELETE TO authenticated USING (auth.uid() = user_id);
CREATE INDEX food_price_history_user_idx ON public.food_price_history (user_id, changed_at DESC);
CREATE INDEX food_price_history_food_idx ON public.food_price_history (food_id);

CREATE OR REPLACE FUNCTION public.log_food_price_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.price_per_pound IS NOT NULL THEN
      INSERT INTO public.food_price_history (user_id, food_id, food_name, old_price, new_price)
      VALUES (NEW.user_id, NEW.id, NEW.name, NULL, NEW.price_per_pound);
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.price_per_pound IS DISTINCT FROM OLD.price_per_pound THEN
    INSERT INTO public.food_price_history (user_id, food_id, food_name, old_price, new_price)
    VALUES (NEW.user_id, NEW.id, NEW.name, OLD.price_per_pound, NEW.price_per_pound);
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER food_plan_foods_price_history
AFTER INSERT OR UPDATE OF price_per_pound ON public.food_plan_foods
FOR EACH ROW EXECUTE FUNCTION public.log_food_price_change();
