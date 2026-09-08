-- Site-defined grid geometry: grid lines, posts and intervals the owner maintains
-- in FarmOps. Records plot from the ACTIVE definition instead of frozen design
-- constants. Nothing here rewrites canonical records; it only defines geometry.

CREATE TABLE public.electrical_grid_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  definition_id text NOT NULL UNIQUE,
  name text NOT NULL,
  scope_note text,
  envelope_width_ft numeric NOT NULL CHECK (envelope_width_ft > 0),
  envelope_depth_ft numeric NOT NULL CHECK (envelope_depth_ft > 0),
  is_active boolean NOT NULL DEFAULT false,
  notes text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX electrical_grid_definitions_one_active
  ON public.electrical_grid_definitions (is_active) WHERE is_active;

CREATE TABLE public.electrical_grid_definition_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  definition_uuid uuid NOT NULL REFERENCES public.electrical_grid_definitions(id) ON DELETE CASCADE,
  axis text NOT NULL CHECK (axis IN ('COLUMN','ROW')),
  label text NOT NULL,
  offset_ft numeric NOT NULL CHECK (offset_ft >= 0),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (definition_uuid, axis, label)
);

CREATE TABLE public.electrical_grid_definition_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  definition_uuid uuid NOT NULL REFERENCES public.electrical_grid_definitions(id) ON DELETE CASCADE,
  post_ref text NOT NULL,
  wall text CHECK (wall IN ('north','east','south','west')),
  is_corner boolean NOT NULL DEFAULT false,
  x_ft numeric NOT NULL,
  y_ft numeric NOT NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (definition_uuid, post_ref)
);

CREATE TABLE public.electrical_grid_definition_intervals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  definition_uuid uuid NOT NULL REFERENCES public.electrical_grid_definitions(id) ON DELETE CASCADE,
  interval_ref text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('POST_SPAN','LINE_SPAN')),
  from_ref text NOT NULL,
  to_ref text NOT NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (definition_uuid, interval_ref)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.electrical_grid_definitions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.electrical_grid_definition_lines TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.electrical_grid_definition_posts TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.electrical_grid_definition_intervals TO authenticated;
GRANT ALL ON public.electrical_grid_definitions TO service_role;
GRANT ALL ON public.electrical_grid_definition_lines TO service_role;
GRANT ALL ON public.electrical_grid_definition_posts TO service_role;
GRANT ALL ON public.electrical_grid_definition_intervals TO service_role;

ALTER TABLE public.electrical_grid_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.electrical_grid_definition_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.electrical_grid_definition_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.electrical_grid_definition_intervals ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'electrical_grid_definitions',
    'electrical_grid_definition_lines',
    'electrical_grid_definition_posts',
    'electrical_grid_definition_intervals'
  ] LOOP
    EXECUTE format($f$
      CREATE POLICY "Authenticated can read %1$s"
      ON public.%1$I FOR SELECT TO authenticated USING (true);
    $f$, t);
    EXECUTE format($f$
      CREATE POLICY "Editors can insert %1$s"
      ON public.%1$I FOR INSERT TO authenticated WITH CHECK (
        private.has_role(auth.uid(), 'admin'::public.app_role)
        OR private.has_role(auth.uid(), 'editor'::public.app_role)
        OR private.has_role(auth.uid(), 'electrician'::public.app_role));
    $f$, t);
    EXECUTE format($f$
      CREATE POLICY "Editors can update %1$s"
      ON public.%1$I FOR UPDATE TO authenticated USING (
        private.has_role(auth.uid(), 'admin'::public.app_role)
        OR private.has_role(auth.uid(), 'editor'::public.app_role)
        OR private.has_role(auth.uid(), 'electrician'::public.app_role))
      WITH CHECK (
        private.has_role(auth.uid(), 'admin'::public.app_role)
        OR private.has_role(auth.uid(), 'editor'::public.app_role)
        OR private.has_role(auth.uid(), 'electrician'::public.app_role));
    $f$, t);
    EXECUTE format($f$
      CREATE POLICY "Editors can delete %1$s"
      ON public.%1$I FOR DELETE TO authenticated USING (
        private.has_role(auth.uid(), 'admin'::public.app_role)
        OR private.has_role(auth.uid(), 'editor'::public.app_role)
        OR private.has_role(auth.uid(), 'electrician'::public.app_role));
    $f$, t);
    EXECUTE format('CREATE TRIGGER %1$I_set_updated_at BEFORE UPDATE ON public.%1$I FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()', t);
  END LOOP;
END $$;

-- Seed the current Farm Shop geometry so the page opens on real data.
INSERT INTO public.electrical_grid_definitions
  (definition_id, name, scope_note, envelope_width_ft, envelope_depth_ft, is_active, notes)
VALUES ('GRID-FS-01', 'Farm Shop corrected grid', 'Farm Shop building envelope', 60, 40, true,
  'Seeded from the corrected 60 x 40 ft Farm Shop drawing. Edit here to change how records plot.');

INSERT INTO public.electrical_grid_definition_lines (definition_uuid, axis, label, offset_ft)
SELECT d.id, v.axis, v.label, v.offset_ft
FROM public.electrical_grid_definitions d,
  (VALUES
    ('ROW','A',0),('ROW','B',8),('ROW','C',16),('ROW','D',24),('ROW','E',32),('ROW','F',40),
    ('COLUMN','1',0),('COLUMN','2',8),('COLUMN','3',16),('COLUMN','4',24),('COLUMN','5',32),
    ('COLUMN','6',40),('COLUMN','7',48),('COLUMN','8',56),('COLUMN','9',60)
  ) AS v(axis,label,offset_ft)
WHERE d.definition_id = 'GRID-FS-01';

INSERT INTO public.electrical_grid_definition_posts (definition_uuid, post_ref, wall, is_corner, x_ft, y_ft)
SELECT d.id, v.post_ref, v.wall, v.is_corner, v.x_ft, v.y_ft
FROM public.electrical_grid_definitions d,
  (VALUES
('01NE','east',true,60,0),
('02NE','east',false,60,8),
('03NE','east',false,60,16),
('04SE','east',false,60,24),
('05SE','east',false,60,32),
('06SE','east',true,60,40),
('07SE','south',false,52.5,40),
('08SE','south',false,45,40),
('09SE','south',false,37.5,40),
('10S','south',false,30,40),
('11S','south',false,22.5,40),
('12SW','south',false,15,40),
('13SW','south',false,7.5,40),
('14SW','south',true,0,40),
('15SW','west',false,0,32),
('16SW','west',false,0,24),
('17NW','west',false,0,16),
('18NW','west',false,0,8),
('19NW','west',true,0,0),
('20NW','north',false,7.5,0),
('21NW','north',false,15,0),
('22N','north',false,22.5,0),
('23N','north',false,30,0),
('24NE','north',false,37.5,0),
('25NE','north',false,45,0),
('26NE','north',false,52.5,0)
  ) AS v(post_ref,wall,is_corner,x_ft,y_ft)
WHERE d.definition_id = 'GRID-FS-01';