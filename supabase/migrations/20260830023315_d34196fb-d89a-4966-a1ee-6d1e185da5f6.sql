-- Phase 4.3: normalized panel breaker positions and panel raceway exits.
-- Additive only: no existing table, column, record or stable ID is changed.

ALTER TABLE public.electrical_panels
  ADD COLUMN IF NOT EXISTS breaker_columns integer,
  ADD COLUMN IF NOT EXISTS positions_per_column integer;

CREATE TABLE public.electrical_breaker_positions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  panel_uuid uuid NOT NULL REFERENCES public.electrical_panels(id) ON DELETE CASCADE,
  side text NOT NULL DEFAULT 'Left',
  position integer NOT NULL,
  breaker_number integer,
  poles integer NOT NULL DEFAULT 1,
  circuit_group_uuid uuid REFERENCES public.electrical_circuit_groups(id) ON DELETE SET NULL,
  load_uuid uuid REFERENCES public.electrical_loads(id) ON DELETE SET NULL,
  label text,
  ocp_amps numeric,
  install_status text,
  label_status text,
  completion_percent numeric,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX electrical_breaker_positions_panel_idx ON public.electrical_breaker_positions (panel_uuid);
CREATE UNIQUE INDEX electrical_breaker_positions_slot_key
  ON public.electrical_breaker_positions (user_id, panel_uuid, side, position);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.electrical_breaker_positions TO authenticated;
GRANT ALL ON public.electrical_breaker_positions TO service_role;
ALTER TABLE public.electrical_breaker_positions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own breaker positions select" ON public.electrical_breaker_positions FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Own breaker positions insert" ON public.electrical_breaker_positions FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Own breaker positions update" ON public.electrical_breaker_positions FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Own breaker positions delete" ON public.electrical_breaker_positions FOR DELETE TO authenticated USING (auth.uid() = user_id);
CREATE TRIGGER electrical_breaker_positions_set_updated_at BEFORE UPDATE ON public.electrical_breaker_positions FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.electrical_panel_exits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  panel_uuid uuid NOT NULL REFERENCES public.electrical_panels(id) ON DELETE CASCADE,
  raceway_uuid uuid REFERENCES public.electrical_raceways(id) ON DELETE SET NULL,
  exit_order integer NOT NULL,
  exit_side text,
  trade_size text,
  raceway_ref text,
  install_status text,
  label_status text,
  completion_percent numeric,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX electrical_panel_exits_panel_idx ON public.electrical_panel_exits (panel_uuid);
CREATE INDEX electrical_panel_exits_raceway_idx ON public.electrical_panel_exits (raceway_uuid);
CREATE UNIQUE INDEX electrical_panel_exits_order_key
  ON public.electrical_panel_exits (user_id, panel_uuid, exit_order);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.electrical_panel_exits TO authenticated;
GRANT ALL ON public.electrical_panel_exits TO service_role;
ALTER TABLE public.electrical_panel_exits ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own panel exits select" ON public.electrical_panel_exits FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Own panel exits insert" ON public.electrical_panel_exits FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Own panel exits update" ON public.electrical_panel_exits FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Own panel exits delete" ON public.electrical_panel_exits FOR DELETE TO authenticated USING (auth.uid() = user_id);
CREATE TRIGGER electrical_panel_exits_set_updated_at BEFORE UPDATE ON public.electrical_panel_exits FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();