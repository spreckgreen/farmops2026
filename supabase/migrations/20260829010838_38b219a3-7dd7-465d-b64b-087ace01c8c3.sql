CREATE TABLE public.app_addons (
  key text PRIMARY KEY,
  name text NOT NULL,
  description text,
  active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.app_addons TO authenticated;
GRANT ALL ON public.app_addons TO service_role;

ALTER TABLE public.app_addons ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read add-on catalog"
  ON public.app_addons FOR SELECT TO authenticated USING (true);

CREATE TRIGGER app_addons_set_updated_at
  BEFORE UPDATE ON public.app_addons
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

INSERT INTO public.app_addons (key, name, description, sort_order) VALUES
  ('electrical', 'Electrical Infrastructure', 'Panels, raceways, junction boxes, branch runs, loads/circuits, installation progress and ODS import.', 10);

CREATE TABLE public.app_entitlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  addon_key text NOT NULL REFERENCES public.app_addons(key) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'active',
  expires_at timestamptz,
  notes text,
  granted_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, addon_key)
);

CREATE INDEX app_entitlements_user_idx ON public.app_entitlements (user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.app_entitlements TO authenticated;
GRANT ALL ON public.app_entitlements TO service_role;

ALTER TABLE public.app_entitlements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own entitlements"
  ON public.app_entitlements FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR private.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY "Admins can insert entitlements"
  ON public.app_entitlements FOR INSERT TO authenticated
  WITH CHECK (private.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY "Admins can update entitlements"
  ON public.app_entitlements FOR UPDATE TO authenticated
  USING (private.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (private.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY "Admins can delete entitlements"
  ON public.app_entitlements FOR DELETE TO authenticated
  USING (private.has_role(auth.uid(), 'admin'::public.app_role));

CREATE TRIGGER app_entitlements_set_updated_at
  BEFORE UPDATE ON public.app_entitlements
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.app_entitlements
  ADD CONSTRAINT app_entitlements_status_check
  CHECK (status IN ('active', 'trialing', 'expired', 'disabled'));

CREATE OR REPLACE FUNCTION public.has_addon(_user_id uuid, _addon_key text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.app_entitlements e
    JOIN public.app_addons a ON a.key = e.addon_key
    WHERE e.user_id = _user_id
      AND e.addon_key = _addon_key
      AND a.active
      AND e.status IN ('active', 'trialing')
      AND (e.expires_at IS NULL OR e.expires_at > now())
  )
$$;

REVOKE ALL ON FUNCTION public.has_addon(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_addon(uuid, text) TO authenticated, service_role;