-- Course materials: notes, assignments, guides shared by teachers and students

CREATE TABLE IF NOT EXISTS public.course_materials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  course_id uuid NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  uploaded_by uuid NOT NULL,
  uploader_role text NOT NULL DEFAULT 'teacher',
  uploader_name text,
  title text NOT NULL,
  description text,
  material_type text NOT NULL DEFAULT 'notes',
  file_url text,
  file_name text,
  file_mime text,
  file_size integer,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_course_materials_course
  ON public.course_materials (course_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_course_materials_school
  ON public.course_materials (school_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_course_materials_uploader
  ON public.course_materials (uploaded_by);

ALTER TABLE public.course_materials ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.course_materials TO authenticated;
GRANT ALL ON public.course_materials TO service_role;

DROP POLICY IF EXISTS "course_materials_select" ON public.course_materials;
DROP POLICY IF EXISTS "course_materials_insert" ON public.course_materials;
DROP POLICY IF EXISTS "course_materials_delete" ON public.course_materials;

CREATE POLICY "course_materials_select"
  ON public.course_materials FOR SELECT TO authenticated
  USING (
    school_id IN (SELECT school_id FROM public.profiles WHERE auth_user_id = auth.uid())
    OR public.is_super_admin()
  );

CREATE POLICY "course_materials_insert"
  ON public.course_materials FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND uploaded_by = auth.uid()
    AND school_id IN (SELECT school_id FROM public.profiles WHERE auth_user_id = auth.uid())
  );

CREATE POLICY "course_materials_delete"
  ON public.course_materials FOR DELETE TO authenticated
  USING (
    uploaded_by = auth.uid()
    OR public.is_super_admin()
  );

INSERT INTO storage.buckets (id, name, public)
VALUES ('course-materials', 'course-materials', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "course_materials_storage_read" ON storage.objects;
DROP POLICY IF EXISTS "course_materials_storage_write" ON storage.objects;

CREATE POLICY "course_materials_storage_read"
  ON storage.objects FOR SELECT TO public
  USING (bucket_id = 'course-materials');

CREATE POLICY "course_materials_storage_write"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'course-materials');
