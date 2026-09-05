CREATE TABLE public.cameras (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  camera_id text NOT NULL,
  name text NOT NULL DEFAULT '',
  area text,
  building text,
  mount text,
  stream_kind text NOT NULL DEFAULT 'none',
  stream_url text,
  snapshot_url text,
  x_feet numeric,
  y_feet numeric,
  heading_degrees numeric,
  fov_degrees numeric NOT NULL DEFAULT 90,
  range_feet numeric NOT NULL DEFAULT 40,
  electrical_load_ref text,
  status text NOT NULL DEFAULT 'unknown',
  last_seen_at timestamptz,
  last_check_at timestamptz,
  last_check_detail text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, camera_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.cameras TO authenticated;
GRANT ALL ON public.cameras TO service_role;
ALTER TABLE public.cameras ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cameras_select_own" ON public.cameras FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "cameras_insert_own" ON public.cameras FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "cameras_update_own" ON public.cameras FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "cameras_delete_own" ON public.cameras FOR DELETE TO authenticated USING (user_id = auth.uid());
CREATE TRIGGER cameras_set_updated_at BEFORE UPDATE ON public.cameras FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.cameras_validate()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.camera_id IS NULL OR btrim(NEW.camera_id) = '' THEN
    RAISE EXCEPTION 'A camera needs a stable camera ID.';
  END IF;
  IF NEW.stream_kind NOT IN ('none','hls','mp4','mjpeg','embed') THEN
    RAISE EXCEPTION 'invalid stream_kind %, must be none|hls|mp4|mjpeg|embed', NEW.stream_kind;
  END IF;
  IF NEW.status NOT IN ('online','offline','unknown') THEN
    RAISE EXCEPTION 'invalid status %, must be online|offline|unknown', NEW.status;
  END IF;
  IF NEW.fov_degrees <= 0 OR NEW.fov_degrees > 360 THEN
    RAISE EXCEPTION 'view angle must be between 0 and 360 degrees';
  END IF;
  IF NEW.range_feet <= 0 THEN
    RAISE EXCEPTION 'view distance must be greater than zero';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER cameras_validate_trg BEFORE INSERT OR UPDATE ON public.cameras FOR EACH ROW EXECUTE FUNCTION public.cameras_validate();

CREATE TABLE public.camera_status_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  camera_uuid uuid NOT NULL REFERENCES public.cameras(id) ON DELETE CASCADE,
  checked_at timestamptz NOT NULL DEFAULT now(),
  ok boolean NOT NULL DEFAULT false,
  http_status integer,
  latency_ms integer,
  detail text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, DELETE ON public.camera_status_checks TO authenticated;
GRANT ALL ON public.camera_status_checks TO service_role;
ALTER TABLE public.camera_status_checks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "camera_checks_select_own" ON public.camera_status_checks FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "camera_checks_insert_own" ON public.camera_status_checks FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "camera_checks_delete_own" ON public.camera_status_checks FOR DELETE TO authenticated USING (user_id = auth.uid());
CREATE TRIGGER camera_status_checks_set_updated_at BEFORE UPDATE ON public.camera_status_checks FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX cameras_user_idx ON public.cameras (user_id, camera_id);
CREATE INDEX camera_status_checks_camera_idx ON public.camera_status_checks (camera_uuid, checked_at DESC);

INSERT INTO public.app_addons (key, name, description)
VALUES ('cameras', 'Cameras', 'Live camera feeds, coverage map and reachability status.')
ON CONFLICT (key) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description;