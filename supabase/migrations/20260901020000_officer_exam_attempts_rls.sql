-- Officer access to exam_attempts / integrity_events must match school scope.
-- is_school_teacher already includes examination_officer in user_roles, but
-- user_roles.user_id may be profile.id (not auth.uid()). Also grant via in_school.

CREATE OR REPLACE FUNCTION public.is_school_teacher(_school uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_super_admin()
    OR EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.role IN ('teacher', 'examination_officer', 'school_admin')
        AND ur.school_id = _school
        AND (
          ur.user_id = auth.uid()
          OR ur.user_id = (SELECT p.id FROM public.profiles p WHERE p.auth_user_id = auth.uid() LIMIT 1)
        )
    )
    OR EXISTS (
      SELECT 1
      FROM public.examination_officers eo
      JOIN public.profiles p ON p.id = eo.profile_id
      WHERE p.auth_user_id = auth.uid()
        AND eo.school_id = _school
    )
    OR EXISTS (
      SELECT 1
      FROM public.teachers t
      JOIN public.profiles p ON p.id = t.profile_id
      WHERE p.auth_user_id = auth.uid()
        AND t.school_id = _school
    );
$$;

GRANT EXECUTE ON FUNCTION public.is_school_teacher(uuid) TO authenticated, anon, service_role;

DROP POLICY IF EXISTS "exam_attempts_select" ON public.exam_attempts;
CREATE POLICY "exam_attempts_select" ON public.exam_attempts
  FOR SELECT TO authenticated
  USING (
    public.is_super_admin()
    OR student_id = public.current_student_id()
    OR public.is_school_teacher(school_id)
    OR public.can_manage_school(school_id)
    OR public.in_school(school_id)
  );

DROP POLICY IF EXISTS "exam_attempts_staff_all" ON public.exam_attempts;
CREATE POLICY "exam_attempts_staff_all" ON public.exam_attempts
  FOR ALL TO authenticated
  USING (
    public.is_school_teacher(school_id)
    OR public.can_manage_school(school_id)
    OR public.is_super_admin()
  )
  WITH CHECK (
    public.is_school_teacher(school_id)
    OR public.can_manage_school(school_id)
    OR public.is_super_admin()
  );

DROP POLICY IF EXISTS "integrity_select" ON public.integrity_events;
CREATE POLICY "integrity_select" ON public.integrity_events
  FOR SELECT TO authenticated
  USING (
    public.is_super_admin()
    OR public.is_school_teacher(school_id)
    OR public.can_manage_school(school_id)
    OR public.in_school(school_id)
  );

DROP POLICY IF EXISTS "integrity_write" ON public.integrity_events;
CREATE POLICY "integrity_write" ON public.integrity_events
  FOR ALL TO authenticated
  USING (
    public.is_school_teacher(school_id)
    OR public.can_manage_school(school_id)
    OR public.is_super_admin()
    -- students may log their own integrity events during CBT
    OR student_id = public.current_student_id()
  )
  WITH CHECK (
    public.is_school_teacher(school_id)
    OR public.can_manage_school(school_id)
    OR public.is_super_admin()
    OR student_id = public.current_student_id()
  );
