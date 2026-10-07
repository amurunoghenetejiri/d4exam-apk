-- Fix public school application submissions (anon + authenticated)
-- Error: new row violates row-level security policy for table school_applications
-- Cause: INSERT allowed but RETURNING/SELECT after insert blocked, or policies missing after project transfer.

ALTER TABLE public.school_applications ENABLE ROW LEVEL SECURITY;

-- Grants
GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT INSERT, SELECT ON public.school_applications TO anon, authenticated;
GRANT ALL ON public.school_applications TO service_role;

-- Drop old / conflicting policies (safe if missing)
DROP POLICY IF EXISTS "applications_public_insert" ON public.school_applications;
DROP POLICY IF EXISTS "applications_public_select" ON public.school_applications;
DROP POLICY IF EXISTS "applications_superadmin_all" ON public.school_applications;
DROP POLICY IF EXISTS "school_applications_public_insert" ON public.school_applications;
DROP POLICY IF EXISTS "school_applications_public_select" ON public.school_applications;
DROP POLICY IF EXISTS "school_applications_superadmin_all" ON public.school_applications;
DROP POLICY IF EXISTS "school_applications_insert" ON public.school_applications;
DROP POLICY IF EXISTS "school_applications_select" ON public.school_applications;

-- Anyone (public form) can submit an application
CREATE POLICY "school_applications_public_insert"
  ON public.school_applications
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

-- Needed so .insert(...).select("id") works for the public form
-- (RETURNING requires SELECT privilege under RLS)
CREATE POLICY "school_applications_public_select"
  ON public.school_applications
  FOR SELECT
  TO anon, authenticated
  USING (true);

-- Super admins manage applications fully
CREATE POLICY "school_applications_superadmin_all"
  ON public.school_applications
  FOR ALL
  TO authenticated
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

-- Ensure is_super_admin exists (no-op if already defined)
CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles ur
    WHERE ur.user_id = auth.uid()
      AND ur.role = 'super_admin'
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_super_admin() TO authenticated, anon;

-- Storage: allow public logo upload for applications (bucket may be school-logos or logos)
-- Run these only if the bucket exists; ignore errors in dashboard if bucket name differs.

DO $$
BEGIN
  -- storage.objects policies for application logos
  IF EXISTS (SELECT 1 FROM storage.buckets WHERE id IN ('school-logos', 'logos', 'school_logos')) THEN
    BEGIN
      DROP POLICY IF EXISTS "school_logos_public_upload" ON storage.objects;
      CREATE POLICY "school_logos_public_upload"
        ON storage.objects
        FOR INSERT
        TO anon, authenticated
        WITH CHECK (
          bucket_id IN ('school-logos', 'logos', 'school_logos')
          AND (name LIKE 'applications/%' OR name LIKE 'logos/%')
        );
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'storage upload policy skipped: %', SQLERRM;
    END;

    BEGIN
      DROP POLICY IF EXISTS "school_logos_public_read" ON storage.objects;
      CREATE POLICY "school_logos_public_read"
        ON storage.objects
        FOR SELECT
        TO anon, authenticated
        USING (bucket_id IN ('school-logos', 'logos', 'school_logos'));
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'storage read policy skipped: %', SQLERRM;
    END;
  END IF;
END $$;
