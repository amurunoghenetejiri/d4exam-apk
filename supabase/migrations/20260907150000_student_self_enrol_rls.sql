-- Student self-enrol RLS for student_courses / course_enrollments
CREATE OR REPLACE FUNCTION public.student_owns_row(_student_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.students s
    JOIN public.profiles p ON p.id = s.profile_id
    WHERE s.id = _student_id
      AND p.auth_user_id = auth.uid()
  );
$$;

DROP POLICY IF EXISTS "student_courses_self_insert" ON public.student_courses;
CREATE POLICY "student_courses_self_insert" ON public.student_courses
  FOR INSERT TO authenticated
  WITH CHECK (
    public.student_owns_row(student_id)
    AND public.in_school(school_id)
  );

DROP POLICY IF EXISTS "student_courses_self_delete" ON public.student_courses;
CREATE POLICY "student_courses_self_delete" ON public.student_courses
  FOR DELETE TO authenticated
  USING (public.student_owns_row(student_id));

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'course_enrollments'
  ) THEN
    EXECUTE 'ALTER TABLE public.course_enrollments ENABLE ROW LEVEL SECURITY';
    EXECUTE 'GRANT SELECT, INSERT, DELETE ON public.course_enrollments TO authenticated';
    EXECUTE 'DROP POLICY IF EXISTS "course_enrollments_self_insert" ON public.course_enrollments';
    EXECUTE $p$
      CREATE POLICY "course_enrollments_self_insert" ON public.course_enrollments
        FOR INSERT TO authenticated
        WITH CHECK (public.student_owns_row(student_id))
    $p$;
    EXECUTE 'DROP POLICY IF EXISTS "course_enrollments_self_select" ON public.course_enrollments';
    EXECUTE $p$
      CREATE POLICY "course_enrollments_self_select" ON public.course_enrollments
        FOR SELECT TO authenticated
        USING (public.student_owns_row(student_id) OR public.in_school(school_id))
    $p$;
  END IF;
END $$;
