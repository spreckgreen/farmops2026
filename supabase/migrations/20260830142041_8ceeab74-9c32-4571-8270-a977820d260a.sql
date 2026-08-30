ALTER TABLE public.electrical_panels ADD COLUMN IF NOT EXISTS ods_extras TEXT;
ALTER TABLE public.electrical_loads ADD COLUMN IF NOT EXISTS ods_extras TEXT;
ALTER TABLE public.electrical_circuit_groups ADD COLUMN IF NOT EXISTS ods_extras TEXT;
ALTER TABLE public.electrical_feeders ADD COLUMN IF NOT EXISTS ods_extras TEXT;
ALTER TABLE public.electrical_raceways ADD COLUMN IF NOT EXISTS ods_extras TEXT;
ALTER TABLE public.electrical_junction_boxes ADD COLUMN IF NOT EXISTS ods_extras TEXT;
ALTER TABLE public.electrical_branch_runs ADD COLUMN IF NOT EXISTS ods_extras TEXT;

COMMENT ON COLUMN public.electrical_panels.ods_extras IS 'Phase 4.4a lossless capture: JSON object of canonical ODS columns with no dedicated FarmOps field, keyed by exact workbook header. Written by the workbook importer only.';
COMMENT ON COLUMN public.electrical_loads.ods_extras IS 'Phase 4.4a lossless capture: JSON object of canonical ODS columns with no dedicated FarmOps field, keyed by exact workbook header. Written by the workbook importer only.';
COMMENT ON COLUMN public.electrical_circuit_groups.ods_extras IS 'Phase 4.4a lossless capture: JSON object of canonical ODS columns with no dedicated FarmOps field, keyed by exact workbook header. Written by the workbook importer only.';
COMMENT ON COLUMN public.electrical_feeders.ods_extras IS 'Phase 4.4a lossless capture: JSON object of canonical ODS columns with no dedicated FarmOps field, keyed by exact workbook header. Written by the workbook importer only.';
COMMENT ON COLUMN public.electrical_raceways.ods_extras IS 'Phase 4.4a lossless capture: JSON object of canonical ODS columns with no dedicated FarmOps field, keyed by exact workbook header. Written by the workbook importer only.';
COMMENT ON COLUMN public.electrical_junction_boxes.ods_extras IS 'Phase 4.4a lossless capture: JSON object of canonical ODS columns with no dedicated FarmOps field, keyed by exact workbook header. Written by the workbook importer only.';
COMMENT ON COLUMN public.electrical_branch_runs.ods_extras IS 'Phase 4.4a lossless capture: JSON object of canonical ODS columns with no dedicated FarmOps field, keyed by exact workbook header. Written by the workbook importer only.';