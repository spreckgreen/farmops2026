ALTER TABLE public.electrical_racks
  ADD COLUMN IF NOT EXISTS build_kit_item_id uuid REFERENCES public.inventory_items(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS electrical_racks_build_kit_item_id_idx
  ON public.electrical_racks(build_kit_item_id);

COMMENT ON COLUMN public.electrical_racks.build_kit_item_id IS
  'Inventory kit item (item_type 32_kits) whose parts list describes the gear installed in this rack. Separate from asset_uuid, which records the rack asset itself.';