ALTER TABLE public.electrical_field_observations
  ADD COLUMN IF NOT EXISTS photo_bucket text,
  ADD COLUMN IF NOT EXISTS photo_path text,
  ADD COLUMN IF NOT EXISTS photo_name text,
  ADD COLUMN IF NOT EXISTS photo_mime text,
  ADD COLUMN IF NOT EXISTS photo_size integer,
  ADD COLUMN IF NOT EXISTS photo_uploaded_at timestamptz;

CREATE POLICY "Users read own field observation photos"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'field-observations' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "Users upload own field observation photos"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'field-observations' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "Users update own field observation photos"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'field-observations' AND (storage.foldername(name))[1] = auth.uid()::text)
  WITH CHECK (bucket_id = 'field-observations' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "Users delete own field observation photos"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'field-observations' AND (storage.foldername(name))[1] = auth.uid()::text);