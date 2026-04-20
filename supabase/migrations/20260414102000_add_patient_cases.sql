/*
  # Add Patient Cases for Villager Create Case Flow

  ## Adds
  1. patient_cases table for villager-submitted medical cases
  2. RLS policies for patient and staff visibility
  3. case-images storage bucket + upload policies
*/

CREATE TABLE IF NOT EXISTS public.patient_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id text NOT NULL,
  case_title text NOT NULL DEFAULT '',
  case_description text NOT NULL DEFAULT '',
  image_url text DEFAULT '',
  symptoms jsonb NOT NULL DEFAULT '[]'::jsonb,
  emergency_score integer NOT NULL DEFAULT 1 CHECK (emergency_score >= 0 AND emergency_score <= 10),
  status text NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted', 'in_review', 'resolved')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.patient_cases ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own cases" ON public.patient_cases;
DROP POLICY IF EXISTS "Users can insert cases" ON public.patient_cases;
DROP POLICY IF EXISTS "Users can update own cases" ON public.patient_cases;
DROP POLICY IF EXISTS "Staff can view all cases" ON public.patient_cases;
DROP POLICY IF EXISTS "Staff can update all cases" ON public.patient_cases;

CREATE POLICY "Users can view own cases"
  ON public.patient_cases FOR SELECT
  TO public
  USING (true);

CREATE POLICY "Users can insert cases"
  ON public.patient_cases FOR INSERT
  TO public
  WITH CHECK (true);

CREATE POLICY "Users can update own cases"
  ON public.patient_cases FOR UPDATE
  TO public
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Staff can view all cases"
  ON public.patient_cases FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles p WHERE p.user_id = auth.uid() AND p.role IN ('doctor', 'admin', 'asha_worker')
    )
  );

CREATE POLICY "Staff can update all cases"
  ON public.patient_cases FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles p WHERE p.user_id = auth.uid() AND p.role IN ('doctor', 'admin', 'asha_worker')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles p WHERE p.user_id = auth.uid() AND p.role IN ('doctor', 'admin', 'asha_worker')
    )
  );

GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.patient_cases TO anon, authenticated;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'case-images',
  'case-images',
  true,
  5242880,
  ARRAY['image/png', 'image/jpeg', 'image/jpg', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Public can view case images" ON storage.objects;
DROP POLICY IF EXISTS "Public can upload case images" ON storage.objects;
DROP POLICY IF EXISTS "Public can update case images" ON storage.objects;
DROP POLICY IF EXISTS "Public can delete case images" ON storage.objects;

CREATE POLICY "Public can view case images"
  ON storage.objects FOR SELECT
  TO public
  USING (bucket_id = 'case-images');

CREATE POLICY "Public can upload case images"
  ON storage.objects FOR INSERT
  TO public
  WITH CHECK (bucket_id = 'case-images');

CREATE POLICY "Public can update case images"
  ON storage.objects FOR UPDATE
  TO public
  USING (bucket_id = 'case-images')
  WITH CHECK (bucket_id = 'case-images');

CREATE POLICY "Public can delete case images"
  ON storage.objects FOR DELETE
  TO public
  USING (bucket_id = 'case-images');

NOTIFY pgrst, 'reload schema';
