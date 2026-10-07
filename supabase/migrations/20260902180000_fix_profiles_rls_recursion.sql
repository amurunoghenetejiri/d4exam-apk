-- Fix: infinite recursion in profiles RLS
-- Cause: profiles policies call in_school() → current_school_id() → SELECT profiles
--        (and staff policies that touch students can re-enter the same cycle).
-- Safe fix: helpers run SECURITY DEFINER with row_security = off; profiles SELECT
--           no longer depends on in_school()/current_school_id().
-- Data-preserving: no DROP TABLE, no TRUNCATE, no UUID changes.

-- ---------------------------------------------------------------------------
-- 1) Helper functions: bypass RLS when resolving the caller's school/roles
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles ur
    WHERE ur.user_id = auth.uid()
      AND ur.role = 'super_admin'
  );
$$;

CREATE OR REPLACE FUNCTION public.current_school_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
  SELECT COALESCE(
    (SELECT p.school_id
       FROM public.profiles p
      WHERE p.auth_user_id = auth.uid()
        AND p.school_id IS NOT NULL
      LIMIT 1),
    (SELECT ur.school_id
       FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.school_id IS NOT NULL
      LIMIT 1),
    (SELECT eo.school_id
       FROM public.examination_officers eo
       JOIN public.profiles p ON p.id = eo.profile_id
      WHERE p.auth_user_id = auth.uid()
      LIMIT 1),
    (SELECT t.school_id
       FROM public.teachers t
       JOIN public.profiles p ON p.id = t.profile_id
      WHERE p.auth_user_id = auth.uid()
      LIMIT 1),
    (SELECT st.school_id
       FROM public.students st
       JOIN public.profiles p ON p.id = st.profile_id
      WHERE p.auth_user_id = auth.uid()
      LIMIT 1)
  );
$$;

CREATE OR REPLACE FUNCTION public.current_account_active()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
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

-- Staff/admin may read profiles in a school (user_roles only — no profiles re-entry)
CREATE OR REPLACE FUNCTION public.can_read_school_profiles(_school uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
  SELECT
    _school IS NOT NULL
    AND (
      public.is_super_admin()
      OR EXISTS (
        SELECT 1
        FROM public.user_roles ur
        WHERE ur.user_id = auth.uid()
          AND ur.school_id = _school
          AND ur.role IN ('school_admin', 'examination_officer', 'teacher')
      )
    );
$$;

CREATE OR REPLACE FUNCTION public.can_manage_school(_school uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
  SELECT public.is_super_admin()
    OR EXISTS (
      SELECT 1
      FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.role = 'school_admin'
        AND ur.school_id = _school
    );
$$;

CREATE OR REPLACE FUNCTION public.is_school_teacher(_school uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
  SELECT public.is_super_admin()
    OR EXISTS (
      SELECT 1
      FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.role IN ('teacher', 'examination_officer', 'school_admin')
        AND ur.school_id = _school
    );
$$;

CREATE OR REPLACE FUNCTION public.in_school(_school uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
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

-- ---------------------------------------------------------------------------
-- 2) Profiles policies — break recursion (no in_school on profiles SELECT)
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "profiles_self_select" ON public.profiles;
DROP POLICY IF EXISTS "profiles_self_update" ON public.profiles;
DROP POLICY IF EXISTS "profiles_admin_all" ON public.profiles;
DROP POLICY IF EXISTS "School admins manage profiles in school" ON public.profiles;
DROP POLICY IF EXISTS "profiles_school_staff_read_students" ON public.profiles;
DROP POLICY IF EXISTS "profiles_school_staff_read" ON public.profiles;
DROP POLICY IF EXISTS "profiles_select" ON public.profiles;
DROP POLICY IF EXISTS "profiles_staff_select" ON public.profiles;

-- Own profile always readable
CREATE POLICY "profiles_select_own"
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (auth_user_id = auth.uid());

-- Super admin + school staff read same-school profiles (no profiles→students cycle)
CREATE POLICY "profiles_select_school_staff"
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (
    public.is_super_admin()
    OR public.can_read_school_profiles(school_id)
  );

-- Self update
CREATE POLICY "profiles_update_own"
  ON public.profiles
  FOR UPDATE
  TO authenticated
  USING (auth_user_id = auth.uid())
  WITH CHECK (auth_user_id = auth.uid());

-- School admin manage profiles in their school
CREATE POLICY "profiles_manage_school_admin"
  ON public.profiles
  FOR ALL
  TO authenticated
  USING (public.can_manage_school(school_id) OR public.is_super_admin())
  WITH CHECK (public.can_manage_school(school_id) OR public.is_super_admin());

-- ---------------------------------------------------------------------------
-- 3) Restore get_my_roles (frontend still calls it; production had 404)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_my_roles()
RETURNS TABLE(role text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
  SELECT ur.role::text
  FROM public.user_roles ur
  WHERE ur.user_id = auth.uid();
$$;

REVOKE ALL ON FUNCTION public.get_my_roles() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_roles() TO authenticated, anon, service_role;

-- ---------------------------------------------------------------------------
-- 4) Harden other session helpers used by the app
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_my_session_context()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
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

-- Grants for helpers
GRANT EXECUTE ON FUNCTION public.is_super_admin() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.current_school_id() TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.current_account_active() TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.in_school(uuid) TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.can_manage_school(uuid) TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.is_school_teacher(uuid) TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.can_read_school_profiles(uuid) TO authenticated, service_role;

-- Reload PostgREST schema cache so get_my_roles is visible
NOTIFY pgrst, 'reload schema';
