-- Physical kits, reusable bags/mini-kits, and exact checkout location restoration.
-- inventory_components remains the many-to-many logical membership graph.

ALTER TABLE public.inventory_items
  ADD COLUMN IF NOT EXISTS container_kind text NOT NULL DEFAULT 'item',
  ADD COLUMN IF NOT EXISTS home_location text,
  ADD COLUMN IF NOT EXISTS primary_container_item_id uuid REFERENCES public.inventory_items(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS current_container_item_id uuid REFERENCES public.inventory_items(id) ON DELETE SET NULL;

UPDATE public.inventory_items
SET container_kind = 'kit'
WHERE lower(coalesce(item_type, '')) IN ('32_kits', 'kit', 'kits', 'field_kit', 'assembly')
  AND container_kind = 'item';

UPDATE public.inventory_items
SET home_location = location
WHERE home_location IS NULL;

-- An unambiguous existing membership is safe to adopt as the primary physical
-- home. Multi-membership rows remain unassigned until the user chooses one.
WITH only_parent AS (
  SELECT c.component_item_id, min(c.parent_item_id::text)::uuid AS parent_item_id
  FROM public.inventory_components c
  JOIN public.inventory_items p ON p.id = c.parent_item_id
  WHERE p.container_kind IN ('kit', 'bag')
  GROUP BY c.component_item_id
  HAVING count(DISTINCT c.parent_item_id) = 1
)
UPDATE public.inventory_items i
SET primary_container_item_id = o.parent_item_id,
    current_container_item_id = o.parent_item_id
FROM only_parent o
WHERE i.id = o.component_item_id
  AND i.primary_container_item_id IS NULL;

ALTER TABLE public.inventory_items
  DROP CONSTRAINT IF EXISTS inventory_items_container_kind_check;
ALTER TABLE public.inventory_items
  ADD CONSTRAINT inventory_items_container_kind_check
  CHECK (container_kind IN ('item', 'kit', 'bag'));

CREATE INDEX IF NOT EXISTS inventory_items_primary_container_idx
  ON public.inventory_items(primary_container_item_id);
CREATE INDEX IF NOT EXISTS inventory_items_current_container_idx
  ON public.inventory_items(current_container_item_id);

CREATE TABLE IF NOT EXISTS public.inventory_container_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  deployment_id uuid NOT NULL REFERENCES public.kit_deployments(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES public.inventory_items(id) ON DELETE CASCADE,
  prior_location text,
  prior_current_container_item_id uuid REFERENCES public.inventory_items(id) ON DELETE SET NULL,
  moved_at timestamptz NOT NULL DEFAULT now(),
  restored_at timestamptz,
  UNIQUE (deployment_id, item_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS inventory_container_one_open_movement_idx
  ON public.inventory_container_movements(item_id)
  WHERE restored_at IS NULL;

ALTER TABLE public.inventory_container_movements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS inventory_container_movements_owner ON public.inventory_container_movements;
CREATE POLICY inventory_container_movements_owner
  ON public.inventory_container_movements FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.move_kit_contents_on_checkout()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  conflict_name text;
  checkout_location text;
BEGIN
  checkout_location := nullif(trim(NEW.label), '');
  IF checkout_location IS NULL THEN
    checkout_location := 'Checked out · ' || NEW.id::text;
  END IF;

  WITH RECURSIVE contents(item_id, immediate_container_id) AS (
    SELECT NEW.kit_item_id, NULL::uuid
    UNION
    SELECT i.id, i.primary_container_item_id
    FROM public.inventory_items i
    JOIN contents p ON i.primary_container_item_id = p.item_id
    WHERE i.user_id = NEW.user_id
  )
  SELECT i.name INTO conflict_name
  FROM contents c
  JOIN public.inventory_items i ON i.id = c.item_id AND i.user_id = NEW.user_id
  JOIN public.inventory_container_movements m
    ON m.item_id = i.id AND m.restored_at IS NULL
  LIMIT 1;

  IF conflict_name IS NOT NULL THEN
    RAISE EXCEPTION '% is already checked out in another kit or rack', conflict_name;
  END IF;

  WITH RECURSIVE contents(item_id, immediate_container_id) AS (
    SELECT NEW.kit_item_id, NULL::uuid
    UNION
    SELECT i.id, i.primary_container_item_id
    FROM public.inventory_items i
    JOIN contents p ON i.primary_container_item_id = p.item_id
    WHERE i.user_id = NEW.user_id
  )
  INSERT INTO public.inventory_container_movements
    (user_id, deployment_id, item_id, prior_location, prior_current_container_item_id)
  SELECT NEW.user_id, NEW.id, i.id, i.location, i.current_container_item_id
  FROM contents c
  JOIN public.inventory_items i ON i.id = c.item_id AND i.user_id = NEW.user_id;

  WITH RECURSIVE contents(item_id, immediate_container_id) AS (
    SELECT NEW.kit_item_id, NULL::uuid
    UNION
    SELECT i.id, i.primary_container_item_id
    FROM public.inventory_items i
    JOIN contents p ON i.primary_container_item_id = p.item_id
    WHERE i.user_id = NEW.user_id
  )
  UPDATE public.inventory_items i
  SET location = checkout_location,
      current_container_item_id = coalesce(c.immediate_container_id, i.current_container_item_id)
  FROM contents c
  WHERE i.id = c.item_id AND i.user_id = NEW.user_id;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.restore_kit_contents_on_checkin()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.status <> 'returned' AND NEW.status = 'returned' THEN
    UPDATE public.inventory_items i
    SET location = m.prior_location,
        current_container_item_id = m.prior_current_container_item_id
    FROM public.inventory_container_movements m
    WHERE m.deployment_id = NEW.id
      AND m.user_id = NEW.user_id
      AND m.item_id = i.id
      AND m.restored_at IS NULL;

    UPDATE public.inventory_container_movements
    SET restored_at = coalesce(NEW.returned_at, now())
    WHERE deployment_id = NEW.id AND user_id = NEW.user_id AND restored_at IS NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS kit_deployment_move_contents ON public.kit_deployments;
CREATE TRIGGER kit_deployment_move_contents
  AFTER INSERT ON public.kit_deployments
  FOR EACH ROW WHEN (NEW.status = 'open')
  EXECUTE FUNCTION public.move_kit_contents_on_checkout();

DROP TRIGGER IF EXISTS kit_deployment_restore_contents ON public.kit_deployments;
CREATE TRIGGER kit_deployment_restore_contents
  AFTER UPDATE OF status ON public.kit_deployments
  FOR EACH ROW
  EXECUTE FUNCTION public.restore_kit_contents_on_checkin();

COMMENT ON COLUMN public.inventory_items.container_kind IS
  'Physical/logical role: ordinary item, kit, or reusable bag/mini-kit.';
COMMENT ON COLUMN public.inventory_items.primary_container_item_id IS
  'The one home/primary assignment; inventory_components may contain additional logical memberships.';
COMMENT ON COLUMN public.inventory_items.current_container_item_id IS
  'Immediate physical container. Parent traversal yields Bag -> Kit -> checked-out destination.';
