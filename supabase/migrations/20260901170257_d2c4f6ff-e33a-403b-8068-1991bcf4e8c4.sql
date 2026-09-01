ALTER TABLE public.electrical_panels
  ADD COLUMN IF NOT EXISTS system_voltage jsonb,
  ADD COLUMN IF NOT EXISTS system_voltage_applied_at timestamptz;

COMMENT ON COLUMN public.electrical_panels.system_voltage IS
  'System-voltage designation (line_neutral_volts, line_line_volts, phases, wires, code, designation, model_version). Panel/feeder/branch voltage is a system designation, not a scalar. The scalar voltage column is preserved for backwards compatibility.';
COMMENT ON COLUMN public.electrical_panels.system_voltage_applied_at IS
  'When the system-voltage designation was applied by the Phase 4.4b apply gate.';