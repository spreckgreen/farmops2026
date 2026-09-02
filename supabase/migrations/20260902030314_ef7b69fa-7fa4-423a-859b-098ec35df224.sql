-- 1. New role: electrician (Electrical area only, read-only)
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'electrician';

-- 2. Register the read-only Electrical add-on in the catalog.
INSERT INTO public.app_addons (key, name, description, active, sort_order)
VALUES (
  'electrical_readonly',
  'Electrical (read-only)',
  'Read-only access to the electrician-viewable Electrical screens. Excludes the reconciliation tools (ODS import/export, parallel validation, adjudication, SOR status and field mapping).',
  true,
  20
)
ON CONFLICT (key) DO UPDATE
  SET name = EXCLUDED.name,
      description = EXCLUDED.description,
      active = true;