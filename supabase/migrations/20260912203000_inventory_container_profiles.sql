-- Structured physical containers: toolbox stacks, drawers, medical bags/cases,
-- duffels, computer cases, and vehicle recovery kits.
-- inventory_items remains canonical; inventory_components remains logical BOM membership.

ALTER TABLE public.inventory_items
  DROP CONSTRAINT IF EXISTS inventory_items_container_kind_check;
ALTER TABLE public.inventory_items
  ADD CONSTRAINT inventory_items_container_kind_check
  CHECK (container_kind IN ('item','kit','bag','case','toolbox','drawer_unit','pouch'));

COMMENT ON COLUMN public.inventory_items.container_kind IS
  'Physical/logical role: item, kit, bag, case, toolbox, drawer unit, or removable pouch.';

CREATE TABLE IF NOT EXISTS public.inventory_container_templates (
  id text PRIMARY KEY,
  label text NOT NULL,
  container_kind text NOT NULL CHECK (container_kind IN ('kit','bag','case','toolbox','drawer_unit','pouch')),
  category text NOT NULL CHECK (category IN ('tools','medical','general','compute','vehicle_recovery')),
  description text NOT NULL,
  suggested_compartments jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(suggested_compartments) = 'array'),
  sort_order integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true
);

INSERT INTO public.inventory_container_templates
(id,label,container_kind,category,description,suggested_compartments,sort_order) VALUES
('ridgid_stackable_toolbox','RIDGID stackable toolbox','toolbox','tools',
 'Stack-compatible RIDGID tool box with an addressable main bay and lid area.',
 '[{"code":"MAIN","name":"Main bay","compartmentType":"main_compartment","sortOrder":10},{"code":"LID","name":"Lid storage","compartmentType":"lid_compartment","sortOrder":20}]',10),
('ridgid_drawer_toolbox','RIDGID drawer toolbox','drawer_unit','tools',
 'Stack-compatible RIDGID drawer box. Add or remove drawer rows to match the physical model.',
 '[{"code":"D1","name":"Drawer 1","compartmentType":"drawer","sortOrder":10},{"code":"D2","name":"Drawer 2","compartmentType":"drawer","sortOrder":20},{"code":"D3","name":"Drawer 3","compartmentType":"drawer","sortOrder":30}]',20),
('first_aid_medical_bag','First aid / medical bag','bag','medical',
 'Soft medical bag with pockets and removable pouches; supports expiration and inspection tracking.',
 '[{"code":"MAIN","name":"Main compartment","compartmentType":"main_compartment","sortOrder":10},{"code":"FRONT","name":"Front pocket","compartmentType":"pocket","sortOrder":20},{"code":"LEFT","name":"Left pocket","compartmentType":"pocket","sortOrder":30},{"code":"RIGHT","name":"Right pocket","compartmentType":"pocket","sortOrder":40},{"code":"POUCH","name":"Removable pouch","compartmentType":"removable_pouch","sortOrder":50}]',30),
('first_aid_medical_case','First aid / medical case','case','medical',
 'Rigid medical case with tray and lower storage; supports expiration and inspection tracking.',
 '[{"code":"TRAY","name":"Upper tray","compartmentType":"tray","sortOrder":10},{"code":"LOWER","name":"Lower bay","compartmentType":"main_compartment","sortOrder":20},{"code":"LID","name":"Lid organizer","compartmentType":"lid_compartment","sortOrder":30}]',40),
('duffel_bag_kit','Duffel bag kit','bag','general','General-purpose deployable kit in a duffel bag.',
 '[{"code":"MAIN","name":"Main compartment","compartmentType":"main_compartment","sortOrder":10},{"code":"LEFT","name":"Left end pocket","compartmentType":"pocket","sortOrder":20},{"code":"RIGHT","name":"Right end pocket","compartmentType":"pocket","sortOrder":30},{"code":"FRONT","name":"Front pocket","compartmentType":"pocket","sortOrder":40}]',50),
('computer_case','Computer case','case','compute',
 'Case for a computer and its power, network, storage, and peripheral accessories.',
 '[{"code":"DEVICE","name":"Computer sleeve","compartmentType":"device_sleeve","sortOrder":10},{"code":"POWER","name":"Power supply pocket","compartmentType":"cable_pocket","sortOrder":20},{"code":"ACCESSORY","name":"Accessory pocket","compartmentType":"pocket","sortOrder":30},{"code":"DOCS","name":"Document sleeve","compartmentType":"document_sleeve","sortOrder":40}]',60),
('vehicle_recovery_kit','Vehicle recovery kit','kit','vehicle_recovery',
 'Vehicle-assigned recovery kit organized by recovery function.',
 '[{"code":"STRAPS","name":"Straps and ropes","compartmentType":"section","sortOrder":10},{"code":"RIGGING","name":"Shackles and rigging","compartmentType":"section","sortOrder":20},{"code":"WINCH","name":"Winch accessories","compartmentType":"section","sortOrder":30},{"code":"TIRE","name":"Tire and air","compartmentType":"section","sortOrder":40},{"code":"PPE","name":"Gloves and PPE","compartmentType":"pocket","sortOrder":50},{"code":"TOOLS","name":"Recovery tools","compartmentType":"section","sortOrder":60}]',70)
ON CONFLICT (id) DO UPDATE SET label=EXCLUDED.label, container_kind=EXCLUDED.container_kind,
 category=EXCLUDED.category, description=EXCLUDED.description,
 suggested_compartments=EXCLUDED.suggested_compartments, sort_order=EXCLUDED.sort_order, active=EXCLUDED.active;

CREATE TABLE IF NOT EXISTS public.inventory_container_profiles (
  inventory_item_id uuid PRIMARY KEY REFERENCES public.inventory_items(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  template_id text REFERENCES public.inventory_container_templates(id) ON DELETE SET NULL,
  category text NOT NULL CHECK (category IN ('tools','medical','general','compute','vehicle_recovery')),
  stack_system text,
  stack_compatible boolean NOT NULL DEFAULT false,
  lockable boolean NOT NULL DEFAULT false,
  weather_rating text,
  carry_style text,
  exterior_length numeric(10,2) CHECK (exterior_length IS NULL OR exterior_length > 0),
  exterior_width numeric(10,2) CHECK (exterior_width IS NULL OR exterior_width > 0),
  exterior_height numeric(10,2) CHECK (exterior_height IS NULL OR exterior_height > 0),
  dimension_unit text NOT NULL DEFAULT 'in' CHECK (dimension_unit IN ('in','cm','mm')),
  empty_weight numeric(10,2) CHECK (empty_weight IS NULL OR empty_weight >= 0),
  weight_unit text NOT NULL DEFAULT 'lb' CHECK (weight_unit IN ('lb','kg','oz','g')),
  assigned_vehicle_item_id uuid REFERENCES public.inventory_items(id) ON DELETE SET NULL,
  medical_classification text,
  inspection_interval_days integer CHECK (inspection_interval_days IS NULL OR inspection_interval_days > 0),
  expiration_tracking_required boolean NOT NULL DEFAULT false,
  notes text,
  attributes jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(attributes) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS inventory_container_profiles_user_idx ON public.inventory_container_profiles(user_id);
CREATE INDEX IF NOT EXISTS inventory_container_profiles_template_idx ON public.inventory_container_profiles(template_id);
CREATE INDEX IF NOT EXISTS inventory_container_profiles_vehicle_idx ON public.inventory_container_profiles(assigned_vehicle_item_id);

CREATE TABLE IF NOT EXISTS public.inventory_container_compartments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  container_item_id uuid NOT NULL REFERENCES public.inventory_items(id) ON DELETE CASCADE,
  parent_compartment_id uuid REFERENCES public.inventory_container_compartments(id) ON DELETE CASCADE,
  code text NOT NULL,
  name text NOT NULL,
  compartment_type text NOT NULL CHECK (compartment_type IN (
    'main_compartment','drawer','pocket','lid_compartment','tray','divider_bin',
    'removable_pouch','device_sleeve','document_sleeve','cable_pocket','section','attachment_point'
  )),
  sort_order integer NOT NULL DEFAULT 0,
  removable boolean NOT NULL DEFAULT false,
  lockable boolean NOT NULL DEFAULT false,
  label_text text,
  capacity_value numeric(12,3) CHECK (capacity_value IS NULL OR capacity_value >= 0),
  capacity_unit text,
  notes text,
  attributes jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(attributes) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (container_item_id, code)
);
CREATE INDEX IF NOT EXISTS inventory_container_compartments_container_idx
 ON public.inventory_container_compartments(container_item_id,sort_order);
CREATE INDEX IF NOT EXISTS inventory_container_compartments_parent_idx
 ON public.inventory_container_compartments(parent_compartment_id);

ALTER TABLE public.inventory_items
 ADD COLUMN IF NOT EXISTS primary_compartment_id uuid REFERENCES public.inventory_container_compartments(id) ON DELETE SET NULL,
 ADD COLUMN IF NOT EXISTS current_compartment_id uuid REFERENCES public.inventory_container_compartments(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS inventory_items_primary_compartment_idx ON public.inventory_items(primary_compartment_id);
CREATE INDEX IF NOT EXISTS inventory_items_current_compartment_idx ON public.inventory_items(current_compartment_id);

COMMENT ON COLUMN public.inventory_items.primary_compartment_id IS
 'Exact drawer, pocket, sleeve, or section within primary_container_item_id.';
COMMENT ON COLUMN public.inventory_items.current_compartment_id IS
 'Exact current drawer, pocket, sleeve, or section within current_container_item_id.';

CREATE TABLE IF NOT EXISTS public.inventory_container_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  parent_container_item_id uuid NOT NULL REFERENCES public.inventory_items(id) ON DELETE CASCADE,
  child_container_item_id uuid NOT NULL REFERENCES public.inventory_items(id) ON DELETE CASCADE,
  relationship_type text NOT NULL CHECK (relationship_type IN ('stacked_on','attached_to','mounted_to')),
  parent_attachment_point_id uuid REFERENCES public.inventory_container_compartments(id) ON DELETE SET NULL,
  child_attachment_point_id uuid REFERENCES public.inventory_container_compartments(id) ON DELETE SET NULL,
  sort_order integer NOT NULL DEFAULT 0,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (parent_container_item_id <> child_container_item_id),
  UNIQUE (parent_container_item_id,child_container_item_id,relationship_type)
);
CREATE INDEX IF NOT EXISTS inventory_container_links_parent_idx
 ON public.inventory_container_links(parent_container_item_id,sort_order);
CREATE INDEX IF NOT EXISTS inventory_container_links_child_idx
 ON public.inventory_container_links(child_container_item_id);

CREATE OR REPLACE FUNCTION public.touch_inventory_container_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $func$
BEGIN NEW.updated_at := now(); RETURN NEW; END;
$func$;
DROP TRIGGER IF EXISTS inventory_container_profiles_touch ON public.inventory_container_profiles;
CREATE TRIGGER inventory_container_profiles_touch BEFORE UPDATE ON public.inventory_container_profiles
 FOR EACH ROW EXECUTE FUNCTION public.touch_inventory_container_updated_at();
DROP TRIGGER IF EXISTS inventory_container_compartments_touch ON public.inventory_container_compartments;
CREATE TRIGGER inventory_container_compartments_touch BEFORE UPDATE ON public.inventory_container_compartments
 FOR EACH ROW EXECUTE FUNCTION public.touch_inventory_container_updated_at();

CREATE OR REPLACE FUNCTION public.validate_inventory_compartment()
RETURNS trigger LANGUAGE plpgsql AS $func$
DECLARE item_owner uuid; parent_container uuid;
BEGIN
 SELECT user_id INTO item_owner FROM public.inventory_items WHERE id=NEW.container_item_id;
 IF item_owner IS NULL OR item_owner<>NEW.user_id THEN RAISE EXCEPTION 'Container item must belong to the same user'; END IF;
 IF NEW.parent_compartment_id IS NOT NULL THEN
  IF NEW.parent_compartment_id=NEW.id THEN RAISE EXCEPTION 'A compartment cannot contain itself'; END IF;
  SELECT container_item_id INTO parent_container FROM public.inventory_container_compartments
   WHERE id=NEW.parent_compartment_id AND user_id=NEW.user_id;
  IF parent_container IS NULL OR parent_container<>NEW.container_item_id THEN
   RAISE EXCEPTION 'Parent compartment must be in the same container';
  END IF;
 END IF;
 RETURN NEW;
END;
$func$;
DROP TRIGGER IF EXISTS validate_inventory_compartment_row ON public.inventory_container_compartments;
CREATE TRIGGER validate_inventory_compartment_row BEFORE INSERT OR UPDATE ON public.inventory_container_compartments
 FOR EACH ROW EXECUTE FUNCTION public.validate_inventory_compartment();

CREATE OR REPLACE FUNCTION public.validate_inventory_item_compartment_assignment()
RETURNS trigger LANGUAGE plpgsql AS $func$
DECLARE compartment_container uuid;
BEGIN
 IF NEW.primary_compartment_id IS NOT NULL THEN
  SELECT container_item_id INTO compartment_container FROM public.inventory_container_compartments
   WHERE id=NEW.primary_compartment_id AND user_id=NEW.user_id;
  IF compartment_container IS NULL OR NEW.primary_container_item_id IS DISTINCT FROM compartment_container THEN
   RAISE EXCEPTION 'Primary compartment must belong to the primary container';
  END IF;
 END IF;
 IF NEW.current_compartment_id IS NOT NULL THEN
  SELECT container_item_id INTO compartment_container FROM public.inventory_container_compartments
   WHERE id=NEW.current_compartment_id AND user_id=NEW.user_id;
  IF compartment_container IS NULL OR NEW.current_container_item_id IS DISTINCT FROM compartment_container THEN
   RAISE EXCEPTION 'Current compartment must belong to the current container';
  END IF;
 END IF;
 RETURN NEW;
END;
$func$;
DROP TRIGGER IF EXISTS validate_inventory_item_compartment_assignment_row ON public.inventory_items;
CREATE TRIGGER validate_inventory_item_compartment_assignment_row
 BEFORE INSERT OR UPDATE OF user_id,primary_container_item_id,current_container_item_id,
 primary_compartment_id,current_compartment_id ON public.inventory_items
 FOR EACH ROW EXECUTE FUNCTION public.validate_inventory_item_compartment_assignment();

CREATE OR REPLACE FUNCTION public.validate_inventory_container_profile()
RETURNS trigger LANGUAGE plpgsql AS $func$
DECLARE item_owner uuid; vehicle_owner uuid;
BEGIN
 SELECT user_id INTO item_owner FROM public.inventory_items WHERE id=NEW.inventory_item_id;
 IF item_owner IS NULL OR item_owner<>NEW.user_id THEN RAISE EXCEPTION 'Container profile item must belong to the same user'; END IF;
 IF NEW.assigned_vehicle_item_id IS NOT NULL THEN
  SELECT user_id INTO vehicle_owner FROM public.inventory_items WHERE id=NEW.assigned_vehicle_item_id;
  IF vehicle_owner IS NULL OR vehicle_owner<>NEW.user_id THEN RAISE EXCEPTION 'Assigned vehicle must belong to the same user'; END IF;
 END IF;
 RETURN NEW;
END;
$func$;
DROP TRIGGER IF EXISTS validate_inventory_container_profile_row ON public.inventory_container_profiles;
CREATE TRIGGER validate_inventory_container_profile_row BEFORE INSERT OR UPDATE ON public.inventory_container_profiles
 FOR EACH ROW EXECUTE FUNCTION public.validate_inventory_container_profile();

CREATE OR REPLACE FUNCTION public.validate_inventory_container_link()
RETURNS trigger LANGUAGE plpgsql AS $func$
DECLARE owned_count integer; attachment_container uuid;
BEGIN
 SELECT count(*) INTO owned_count FROM public.inventory_items
  WHERE id IN (NEW.parent_container_item_id,NEW.child_container_item_id) AND user_id=NEW.user_id;
 IF owned_count<>2 THEN RAISE EXCEPTION 'Both linked containers must belong to the same user'; END IF;
 IF NEW.parent_attachment_point_id IS NOT NULL THEN
  SELECT container_item_id INTO attachment_container FROM public.inventory_container_compartments
   WHERE id=NEW.parent_attachment_point_id AND user_id=NEW.user_id;
  IF attachment_container IS DISTINCT FROM NEW.parent_container_item_id THEN
   RAISE EXCEPTION 'Parent attachment point must belong to the parent container';
  END IF;
 END IF;
 IF NEW.child_attachment_point_id IS NOT NULL THEN
  SELECT container_item_id INTO attachment_container FROM public.inventory_container_compartments
   WHERE id=NEW.child_attachment_point_id AND user_id=NEW.user_id;
  IF attachment_container IS DISTINCT FROM NEW.child_container_item_id THEN
   RAISE EXCEPTION 'Child attachment point must belong to the child container';
  END IF;
 END IF;
 RETURN NEW;
END;
$func$;
DROP TRIGGER IF EXISTS validate_inventory_container_link_row ON public.inventory_container_links;
CREATE TRIGGER validate_inventory_container_link_row BEFORE INSERT OR UPDATE ON public.inventory_container_links
 FOR EACH ROW EXECUTE FUNCTION public.validate_inventory_container_link();

ALTER TABLE public.inventory_container_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_container_compartments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_container_links ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS inventory_container_profiles_owner ON public.inventory_container_profiles;
CREATE POLICY inventory_container_profiles_owner ON public.inventory_container_profiles FOR ALL
 USING (auth.uid()=user_id) WITH CHECK (auth.uid()=user_id);
DROP POLICY IF EXISTS inventory_container_compartments_owner ON public.inventory_container_compartments;
CREATE POLICY inventory_container_compartments_owner ON public.inventory_container_compartments FOR ALL
 USING (auth.uid()=user_id) WITH CHECK (auth.uid()=user_id);
DROP POLICY IF EXISTS inventory_container_links_owner ON public.inventory_container_links;
CREATE POLICY inventory_container_links_owner ON public.inventory_container_links FOR ALL
 USING (auth.uid()=user_id) WITH CHECK (auth.uid()=user_id);

GRANT SELECT ON public.inventory_container_templates TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.inventory_container_profiles TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.inventory_container_compartments TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.inventory_container_links TO authenticated;

ALTER TABLE public.inventory_container_movements
 ADD COLUMN IF NOT EXISTS prior_current_compartment_id uuid
 REFERENCES public.inventory_container_compartments(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.move_kit_contents_on_checkout()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $func$
DECLARE conflict_name text; checkout_location text;
BEGIN
 checkout_location:=nullif(trim(NEW.label),'');
 IF checkout_location IS NULL THEN checkout_location:='Checked out · '||NEW.id::text; END IF;
 WITH RECURSIVE contents(item_id,immediate_container_id) AS (
  SELECT NEW.kit_item_id,NULL::uuid UNION
  SELECT i.id,i.primary_container_item_id FROM public.inventory_items i
  JOIN contents p ON i.primary_container_item_id=p.item_id WHERE i.user_id=NEW.user_id
 )
 SELECT i.name INTO conflict_name FROM contents c
 JOIN public.inventory_items i ON i.id=c.item_id AND i.user_id=NEW.user_id
 JOIN public.inventory_container_movements m ON m.item_id=i.id AND m.restored_at IS NULL LIMIT 1;
 IF conflict_name IS NOT NULL THEN RAISE EXCEPTION '% is already checked out in another kit or rack',conflict_name; END IF;
 WITH RECURSIVE contents(item_id,immediate_container_id) AS (
  SELECT NEW.kit_item_id,NULL::uuid UNION
  SELECT i.id,i.primary_container_item_id FROM public.inventory_items i
  JOIN contents p ON i.primary_container_item_id=p.item_id WHERE i.user_id=NEW.user_id
 )
 INSERT INTO public.inventory_container_movements
  (user_id,deployment_id,item_id,prior_location,prior_current_container_item_id,prior_current_compartment_id)
 SELECT NEW.user_id,NEW.id,i.id,i.location,i.current_container_item_id,i.current_compartment_id
 FROM contents c JOIN public.inventory_items i ON i.id=c.item_id AND i.user_id=NEW.user_id;
 WITH RECURSIVE contents(item_id,immediate_container_id) AS (
  SELECT NEW.kit_item_id,NULL::uuid UNION
  SELECT i.id,i.primary_container_item_id FROM public.inventory_items i
  JOIN contents p ON i.primary_container_item_id=p.item_id WHERE i.user_id=NEW.user_id
 )
 UPDATE public.inventory_items i SET location=checkout_location,
  current_container_item_id=coalesce(c.immediate_container_id,i.current_container_item_id)
 FROM contents c WHERE i.id=c.item_id AND i.user_id=NEW.user_id;
 RETURN NEW;
END;
$func$;

CREATE OR REPLACE FUNCTION public.restore_kit_contents_on_checkin()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $func$
BEGIN
 IF OLD.status<>'returned' AND NEW.status='returned' THEN
  UPDATE public.inventory_items i SET location=m.prior_location,
   current_container_item_id=m.prior_current_container_item_id,
   current_compartment_id=m.prior_current_compartment_id
  FROM public.inventory_container_movements m
  WHERE m.deployment_id=NEW.id AND m.user_id=NEW.user_id AND m.item_id=i.id AND m.restored_at IS NULL;
  UPDATE public.inventory_container_movements SET restored_at=coalesce(NEW.returned_at,now())
   WHERE deployment_id=NEW.id AND user_id=NEW.user_id AND restored_at IS NULL;
 END IF;
 RETURN NEW;
END;
$func$;

CREATE OR REPLACE FUNCTION public.restore_kit_contents_on_deployment_delete()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $func$
BEGIN
 UPDATE public.inventory_items i SET location=m.prior_location,
  current_container_item_id=m.prior_current_container_item_id,
  current_compartment_id=m.prior_current_compartment_id
 FROM public.inventory_container_movements m
 WHERE m.deployment_id=OLD.id AND m.user_id=OLD.user_id AND m.item_id=i.id AND m.restored_at IS NULL;
 RETURN OLD;
END;
$func$;
