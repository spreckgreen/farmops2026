REVOKE INSERT, UPDATE, DELETE ON public.inventory_item_types FROM authenticated;
REVOKE ALL ON public.inventory_item_types FROM anon;
GRANT SELECT ON public.inventory_item_types TO authenticated;
GRANT ALL ON public.inventory_item_types TO service_role;