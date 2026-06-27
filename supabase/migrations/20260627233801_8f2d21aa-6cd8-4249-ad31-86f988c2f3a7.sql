CREATE TABLE public.weather_forecasts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  station_id TEXT NOT NULL,
  forecast_date DATE NOT NULL,
  high_temp_f NUMERIC,
  low_temp_f NUMERIC,
  conditions TEXT,
  icon TEXT,
  precip_probability NUMERIC,
  precip_type TEXT,
  sunrise TIMESTAMPTZ,
  sunset TIMESTAMPTZ,
  raw JSONB,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, station_id, forecast_date)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.weather_forecasts TO authenticated;
GRANT ALL ON public.weather_forecasts TO service_role;

ALTER TABLE public.weather_forecasts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users select own forecasts" ON public.weather_forecasts
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users insert own forecasts" ON public.weather_forecasts
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own forecasts" ON public.weather_forecasts
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users delete own forecasts" ON public.weather_forecasts
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE TRIGGER weather_forecasts_set_updated_at
  BEFORE UPDATE ON public.weather_forecasts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX weather_forecasts_user_date_idx
  ON public.weather_forecasts (user_id, forecast_date DESC);