INSERT INTO public.app_addons (key, name, description, active, sort_order)
VALUES (
  'electrical_scan',
  'Electrical — scanned label access',
  'Auto-granted when a viewer follows a printed panel QR label. Unlocks only the scanned panel sheet and that panel''s local topology; wider system data requires an administrator-approved window.',
  true,
  20
)
ON CONFLICT (key) DO UPDATE
SET name = EXCLUDED.name,
    description = EXCLUDED.description,
    active = true;