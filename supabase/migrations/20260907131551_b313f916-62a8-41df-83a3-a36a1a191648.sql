ALTER TABLE public.inventory_items
  ADD COLUMN IF NOT EXISTS rack_face_image_url text,
  ADD COLUMN IF NOT EXISTS rack_face_prompt text,
  ADD COLUMN IF NOT EXISTS rack_face_generated_at timestamptz;