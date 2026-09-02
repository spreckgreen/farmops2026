DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'electrical_amps_semantic') THEN
    CREATE TYPE public.electrical_amps_semantic AS ENUM (
      'CONNECTED_LOAD_CURRENT',
      'EQUIPMENT_FLA',
      'RATED_CURRENT',
      'RLA',
      'MCA',
      'MOCP',
      'INSTALLED_OCP_RATING',
      'DESIGN_CIRCUIT_AMPACITY'
    );
  END IF;
END $$;

ALTER TABLE public.electrical_loads
  ADD COLUMN IF NOT EXISTS amps_semantic public.electrical_amps_semantic,
  ADD COLUMN IF NOT EXISTS amps_semantic_provenance text,
  ADD COLUMN IF NOT EXISTS connected_load_current numeric,
  ADD COLUMN IF NOT EXISTS equipment_fla numeric,
  ADD COLUMN IF NOT EXISTS rated_current_amps numeric,
  ADD COLUMN IF NOT EXISTS rated_load_amps numeric,
  ADD COLUMN IF NOT EXISTS minimum_circuit_ampacity numeric,
  ADD COLUMN IF NOT EXISTS maximum_overcurrent_protection numeric,
  ADD COLUMN IF NOT EXISTS installed_ocp_rating numeric,
  ADD COLUMN IF NOT EXISTS design_circuit_ampacity numeric;

COMMENT ON COLUMN public.electrical_loads.amps IS 'Legacy overloaded scalar current field. Semantically unresolved unless amps_semantic + amps_semantic_provenance are populated. Never backfilled or rewritten from the additive semantic fields.';
COMMENT ON COLUMN public.electrical_loads.amps_semantic IS 'Proven meaning of the legacy amps value. Numeric equality with a manufacturer value is NOT provenance.';