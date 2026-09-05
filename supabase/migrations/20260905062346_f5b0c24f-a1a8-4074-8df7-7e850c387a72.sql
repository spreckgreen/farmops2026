CREATE TABLE public.app_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  tier_key text NOT NULL,
  deployment text NOT NULL DEFAULT 'cloud',
  billing text NOT NULL DEFAULT 'monthly',
  status text NOT NULL DEFAULT 'active',
  modules text[] NOT NULL DEFAULT '{}',
  seats integer NOT NULL DEFAULT 1,
  sites integer NOT NULL DEFAULT 1,
  contractor boolean NOT NULL DEFAULT false,
  current_period_end timestamptz,
  provider text NOT NULL DEFAULT 'manual',
  provider_ref text,
  notes text,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT app_subscriptions_deployment_check CHECK (deployment IN ('cloud','selfhost')),
  CONSTRAINT app_subscriptions_billing_check CHECK (billing IN ('monthly','annual')),
  CONSTRAINT app_subscriptions_status_check CHECK (status IN ('active','trialing','past_due','canceled')),
  CONSTRAINT app_subscriptions_provider_check CHECK (provider IN ('manual','stripe')),
  CONSTRAINT app_subscriptions_seats_check CHECK (seats >= 1 AND seats <= 10000),
  CONSTRAINT app_subscriptions_sites_check CHECK (sites >= 1 AND sites <= 10000)
);

CREATE INDEX app_subscriptions_user_idx ON public.app_subscriptions (user_id);
CREATE INDEX app_subscriptions_tier_idx ON public.app_subscriptions (tier_key);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.app_subscriptions TO authenticated;
GRANT ALL ON public.app_subscriptions TO service_role;

ALTER TABLE public.app_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own subscription"
  ON public.app_subscriptions FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR private.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY "Admins can insert subscriptions"
  ON public.app_subscriptions FOR INSERT TO authenticated
  WITH CHECK (private.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY "Admins can update subscriptions"
  ON public.app_subscriptions FOR UPDATE TO authenticated
  USING (private.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (private.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY "Admins can delete subscriptions"
  ON public.app_subscriptions FOR DELETE TO authenticated
  USING (private.has_role(auth.uid(), 'admin'::public.app_role));

CREATE TRIGGER app_subscriptions_set_updated_at
  BEFORE UPDATE ON public.app_subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

INSERT INTO public.app_addons (key, name, description, sort_order) VALUES
  ('maintenance', 'Maintenance', 'Service schedules, forecasts, manuals and diagnosis for equipment.', 20),
  ('inventory', 'Inventory', 'Assets, kits, bills of material, barcode scanning and reconciliation.', 30),
  ('food', 'Food & Growing', 'Crops, livestock, orchard, irrigation, processing and food storage planning.', 40)
ON CONFLICT (key) DO NOTHING;