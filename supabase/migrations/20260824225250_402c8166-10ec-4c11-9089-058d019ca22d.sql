CREATE TABLE IF NOT EXISTS public.inventory_item_types (
  value text PRIMARY KEY,
  label text NOT NULL,
  folder text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

GRANT SELECT ON public.inventory_item_types TO authenticated;
GRANT ALL ON public.inventory_item_types TO service_role;

ALTER TABLE public.inventory_item_types ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can read inventory type catalog" ON public.inventory_item_types;
CREATE POLICY "Authenticated users can read inventory type catalog"
ON public.inventory_item_types
FOR SELECT
TO authenticated
USING (true);

DROP TRIGGER IF EXISTS set_inventory_item_types_updated_at ON public.inventory_item_types;
CREATE TRIGGER set_inventory_item_types_updated_at
BEFORE UPDATE ON public.inventory_item_types
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

INSERT INTO public.inventory_item_types (value, label, folder, sort_order) VALUES
  ('20_outbuildings', '20 Outbuildings', '20 Outbuildings', 10),
  ('21_infrastructure_system', '21 Infrastructure System', '21 Infrastructure systems', 20),
  ('22_infrastructure_component', '22 Infrastructure component', '21 Infrastructure systems/22 Infrastructure components', 30),
  ('23_communication', '23 Communication', '21 Infrastructure systems/23 Communication', 40),
  ('23_1_network', '23.1 Network', '21 Infrastructure systems/23 Communication/23.1 Network', 50),
  ('23_2_ham_radio', '23.2 Ham Radio', '21 Infrastructure systems/23 Communication/23.2 Ham Radio', 60),
  ('24_energy', '24 Energy', '21 Infrastructure systems/24 Energy', 70),
  ('24_1_boiler', '24.1 Boiler', '21 Infrastructure systems/24 Energy/24.1 Boiler', 80),
  ('24_2_farm_shop_electrical', '24.2 Farm Shop Electrical', '21 Infrastructure systems/24 Energy/24.2 Farm Shop Electrical', 90),
  ('24_3_house_electrical', '24.3 House Electrical', '21 Infrastructure systems/24 Energy/24.3 House Electrical', 100),
  ('24_4_pump_house_electrical', '24.4 Pump House Electrical', '21 Infrastructure systems/24 Energy/24.4 Pump House Electrical', 110),
  ('25_sanitation', '25 Sanitation', '21 Infrastructure systems/25 Sanitation', 120),
  ('25_1_septic_house', '25.1 Septic House', '21 Infrastructure systems/25 Sanitation/25.1 Septic House', 130),
  ('25_2_septic_farm_shop', '25.2 Septic Farm Shop', '21 Infrastructure systems/25 Sanitation/25.2 Septic Farm Shop', 140),
  ('26_water', '26 Water', '21 Infrastructure systems/26 Water', 150),
  ('26_1_well_house', '26.1 Well House', '21 Infrastructure systems/26 Water/26.1 Well House', 160),
  ('26_2_cistern_farm_shop', '26.2 Cistern Farm Shop', '21 Infrastructure systems/26 Water/26.2 Cistern Farm Shop', 170),
  ('26_3_well_ag', '26.3 Well Ag', '21 Infrastructure systems/26 Water/26.3 Well Ag', 180),
  ('26_4_cistern_ag_well', '26.4 Cistern Ag Well', '21 Infrastructure systems/26 Water/26.4 Cistern Ag Well', 190),
  ('27_food_production', '27 Food Production', '27 Food Production', 200),
  ('27_1_garden', '27.1 Garden', '27 Food Production/27.1 Garden', 210),
  ('27_2_orchard', '27.2 Orchard', '27 Food Production/27.2 Orchard', 220),
  ('27_3_pastures', '27.3 Pastures', '27 Food Production/27.3 Pastures', 230),
  ('30_equipment', '30 Equipment', '30 Equipment', 240),
  ('31_parts', '31 Parts', '30 Equipment/31 Parts Catalog', 250),
  ('32_kits', '32 Kits', '30 Equipment/32 Kits', 260),
  ('40_animals', '40 Animals', '40 Animals', 270),
  ('41_feed', '41 Feed', '40 Animals/41 Feed', 280),
  ('50_food_storage', '50 Food Storage', '50 Food Storage', 290),
  ('51_land_zone', '51 Land Zone', '50 Food Storage/51 Land Zone', 300),
  ('52_plants', '52 Plants', '50 Food Storage/52 Plants', 310)
ON CONFLICT (value) DO UPDATE
  SET label = EXCLUDED.label,
      folder = EXCLUDED.folder,
      sort_order = EXCLUDED.sort_order,
      active = true;
