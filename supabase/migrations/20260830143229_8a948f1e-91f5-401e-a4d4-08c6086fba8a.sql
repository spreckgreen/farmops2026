-- Phase 4.4a infrastructure asset integration.
-- Infrastructure entities describe role/topology; the existing FarmOps
-- Inventory/Asset record remains authoritative for physical equipment
-- lifecycle. The link is nullable so planned/passive infrastructure needs no
-- Asset, and swapping the Asset never disturbs the stable infrastructure ID.

ALTER TABLE public.electrical_racks
  ADD COLUMN IF NOT EXISTS asset_uuid uuid REFERENCES public.inventory_items(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS asset_ref text;

ALTER TABLE public.electrical_power_assets
  ADD COLUMN IF NOT EXISTS asset_uuid uuid REFERENCES public.inventory_items(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS asset_ref text;

ALTER TABLE public.electrical_devices
  ADD COLUMN IF NOT EXISTS asset_uuid uuid REFERENCES public.inventory_items(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS asset_ref text;

CREATE INDEX IF NOT EXISTS electrical_racks_asset_idx ON public.electrical_racks(asset_uuid);
CREATE INDEX IF NOT EXISTS electrical_power_assets_asset_idx ON public.electrical_power_assets(asset_uuid);
CREATE INDEX IF NOT EXISTS electrical_devices_asset_idx ON public.electrical_devices(asset_uuid);

COMMENT ON COLUMN public.electrical_racks.asset_uuid IS 'Optional link to the authoritative Inventory/Asset record for this physical rack.';
COMMENT ON COLUMN public.electrical_power_assets.asset_uuid IS 'Optional link to the authoritative Inventory/Asset record for this power equipment.';
COMMENT ON COLUMN public.electrical_devices.asset_uuid IS 'Optional link to the authoritative Inventory/Asset record for this device.';
COMMENT ON COLUMN public.electrical_power_assets.manufacturer IS 'Deprecated in Phase 4.4a: Inventory/Asset owns manufacturer. Retained read-only so no existing value is lost.';
COMMENT ON COLUMN public.electrical_power_assets.model IS 'Deprecated in Phase 4.4a: Inventory/Asset owns model. Retained read-only so no existing value is lost.';
COMMENT ON COLUMN public.electrical_devices.manufacturer IS 'Deprecated in Phase 4.4a: Inventory/Asset owns manufacturer. Retained read-only so no existing value is lost.';
COMMENT ON COLUMN public.electrical_devices.model IS 'Deprecated in Phase 4.4a: Inventory/Asset owns model. Retained read-only so no existing value is lost.';