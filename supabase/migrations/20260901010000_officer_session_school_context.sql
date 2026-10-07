-- Officer / staff session context: school_id must resolve even when
-- profiles.school_id is null or account status is invited/pending.
-- Also let officers read school examinations via is_school_teacher.

CREATE OR REPLACE FUNCTION public.current_school_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT p.school_id FROM public.profiles p
      WHERE p.auth_user_id = auth.uid() AND p.school_id IS NOT NULL LIMIT 1),
    (SELECT ur.school_id FROM public.user_roles ur
      WHERE ur.user_id = auth.uid() AND ur.school_id IS NOT NULL LIMIT 1),
    (SELECT eo.school_id
       FROM public.examination_officers eo
       JOIN public.profiles p ON p.id = eo.profile_id
      WHERE p.auth_user_id = auth.uid() LIMIT 1),
    (SELECT t.school_id
       FROM public.teachers t
       JOIN public.profiles p ON p.id = t.profile_id
      WHERE p.auth_user_id = auth.uid() LIMIT 1),
    (SELECT st.school_id
       FROM public.students st
       JOIN public.profiles p ON p.id = st.profile_id
      WHERE p.auth_user_id = auth.uid() LIMIT 1)
  );
$$;

CREATE OR REPLACE FUNCTION public.current_account_active()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.is_super_admin()
    OR EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.auth_user_id = auth.uid()
        AND p.status IN ('active', 'invited', 'pending')
    )
    OR EXISTS (
      SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid()
    );
$$;

CREATE OR REPLACE FUNCTION public.in_school(_school uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_super_admin()
    OR (
      _school IS NOT NULL
      AND _school = public.current_school_id()
      AND public.current_account_active()
    )
    OR public.is_school_teacher(_school)
    OR public.can_manage_school(_school);
$$;

CREATE OR REPLACE FUNCTION public.get_my_session_context()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  rec jsonb;
BEGIN
  IF uid IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT jsonb_build_object(
    'profile_id', p.id,
    'full_name', COALESCE(
      NULLIF(btrim(p.full_name), ''),
      NULLIF(btrim(concat_ws(' ', p.first_name, p.last_name)), ''),
      p.email
    ),
    'email', p.email,
    'status', p.status,
    'school_id', COALESCE(
      p.school_id,
      (SELECT ur.school_id FROM public.user_roles ur
        WHERE ur.user_id IN (uid, p.id) AND ur.school_id IS NOT NULL LIMIT 1),
      (SELECT eo.school_id FROM public.examination_officers eo WHERE eo.profile_id = p.id LIMIT 1),
      (SELECT t.school_id FROM public.teachers t WHERE t.profile_id = p.id LIMIT 1),
      (SELECT st.school_id FROM public.students st WHERE st.profile_id = p.id LIMIT 1)
    ),
    'roles', COALESCE((
      SELECT jsonb_agg(DISTINCT ur.role::text)
      FROM public.user_roles ur
      WHERE ur.user_id IN (uid, p.id)
    ), '[]'::jsonb),
    'officer_id', (SELECT eo.officer_id FROM public.examination_officers eo WHERE eo.profile_id = p.id LIMIT 1),
    'staff_id', (SELECT t.staff_id FROM public.teachers t WHERE t.profile_id = p.id LIMIT 1),
    'matric', (SELECT COALESCE(st.matric_number, st.student_id) FROM public.students st WHERE st.profile_id = p.id LIMIT 1)
  )
  INTO rec
  FROM public.profiles p
  WHERE p.auth_user_id = uid OR p.id = uid
  LIMIT 1;

  RETURN rec;
END;
$$;

REVOKE ALL ON FUNCTION public.get_my_session_context() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_session_context() TO authenticated, anon, service_role;

GRANT EXECUTE ON FUNCTION public.current_school_id() TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.current_account_active() TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.in_school(uuid) TO authenticated, anon, service_role;

DROP POLICY IF EXISTS "examinations_select" ON public.examinations;
CREATE POLICY "examinations_select" ON public.examinations
  FOR SELECT TO authenticated
  USING (
    public.is_super_admin()
    OR public.in_school(school_id)
    OR public.is_school_teacher(school_id)
    OR public.can_manage_school(school_id)
  );

DROP POLICY IF EXISTS "schools_select" ON public.schools;
CREATE POLICY "schools_select" ON public.schools
  FOR SELECT TO authenticated
  USING (
    public.is_super_admin()
    OR id = public.current_school_id()
    OR public.is_school_teacher(id)
    OR public.can_manage_school(id)
  );
