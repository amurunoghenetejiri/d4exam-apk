-- Public login helpers for school_admin, teacher, officer, student (no service role required)

CREATE OR REPLACE FUNCTION public.resolve_school_for_login(_school_code text)
RETURNS TABLE(id uuid, school_code text, status text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_code text := upper(trim(coalesce(_school_code, '')));
BEGIN
  IF v_code = '' THEN RETURN; END IF;
  RETURN QUERY
  SELECT s.id, s.school_code::text, s.status::text
  FROM public.schools s
  WHERE upper(trim(s.school_code)) = v_code
  LIMIT 1;
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_school_for_login(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_school_for_login(text) TO anon, authenticated, service_role;

-- Returns auth email + kind for any school user identifier
CREATE OR REPLACE FUNCTION public.resolve_login_identity(_school_code text, _identifier text)
RETURNS TABLE(email text, account_status text, kind text, school_active boolean)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_school_id uuid;
  v_school_status text;
  v_school_code text;
  v_ident text := lower(regexp_replace(trim(coalesce(_identifier,'')), '\s+', ' ', 'g'));
  v_code text := upper(trim(coalesce(_school_code,'')));
  v_safe_code text;
  v_safe_matric text;
BEGIN
  IF v_ident = '' THEN RETURN; END IF;

  IF v_code <> '' THEN
    SELECT s.id, s.status::text, s.school_code::text
      INTO v_school_id, v_school_status, v_school_code
    FROM public.schools s
    WHERE upper(trim(s.school_code)) = v_code
    LIMIT 1;
    IF v_school_id IS NULL THEN RETURN; END IF;
    IF lower(coalesce(v_school_status,'')) <> 'active' THEN
      RETURN QUERY SELECT NULL::text, NULL::text, 'school_inactive'::text, false;
      RETURN;
    END IF;
    v_safe_code := lower(regexp_replace(coalesce(v_school_code,''), '[^a-zA-Z0-9]+', '', 'g'));
  END IF;

  -- Profile email (any role including school_admin)
  RETURN QUERY
  SELECT p.email::text, p.status::text, 'profile'::text, true
  FROM public.profiles p
  WHERE lower(trim(coalesce(p.email,''))) = v_ident
    AND (v_school_id IS NULL OR p.school_id = v_school_id)
  LIMIT 1;
  IF FOUND THEN RETURN; END IF;

  IF v_school_id IS NULL THEN RETURN; END IF;

  -- School admin by full name
  RETURN QUERY
  SELECT p.email::text, p.status::text, 'school_admin'::text, true
  FROM public.user_roles ur
  JOIN public.profiles p ON p.auth_user_id = ur.user_id
  WHERE ur.school_id = v_school_id
    AND ur.role = 'school_admin'
    AND (
      lower(regexp_replace(trim(coalesce(p.full_name,'')), '\s+', ' ', 'g')) = v_ident
      OR lower(trim(coalesce(p.email,''))) = v_ident
    )
    AND p.email IS NOT NULL
  LIMIT 1;
  IF FOUND THEN RETURN; END IF;

  -- Student: matric / student_id / name — prefer real email, else synthetic
  RETURN QUERY
  SELECT
    COALESCE(
      NULLIF(lower(trim(p.email)), ''),
      (
        lower(regexp_replace(trim(coalesce(st.matric_number, st.student_id, '')), '[^a-zA-Z0-9]+', '-', 'g'))
        || '@'
        || COALESCE(NULLIF(v_safe_code,''), 'school')
        || '.student.d4exam.local'
      )
    )::text,
    COALESCE(p.status::text, st.status::text),
    'student'::text,
    true
  FROM public.students st
  LEFT JOIN public.profiles p ON p.id = st.profile_id
  WHERE st.school_id = v_school_id
    AND (
      lower(trim(coalesce(st.matric_number,''))) = v_ident
      OR lower(trim(coalesce(st.student_id,''))) = v_ident
      OR lower(trim(coalesce(st.admission_number,''))) = v_ident
      OR lower(regexp_replace(trim(coalesce(st.full_name,'')), '\s+', ' ', 'g')) = v_ident
    )
  LIMIT 1;
  IF FOUND THEN RETURN; END IF;

  -- Teacher: staff_id / name / email
  RETURN QUERY
  SELECT p.email::text, p.status::text, 'teacher'::text, true
  FROM public.teachers t
  JOIN public.profiles p ON p.id = t.profile_id
  WHERE t.school_id = v_school_id
    AND (
      lower(trim(coalesce(t.staff_id,''))) = v_ident
      OR lower(regexp_replace(trim(coalesce(p.full_name,'')), '\s+', ' ', 'g')) = v_ident
      OR lower(trim(coalesce(p.email,''))) = v_ident
    )
    AND p.email IS NOT NULL
  LIMIT 1;
  IF FOUND THEN RETURN; END IF;

  -- Examination officer
  RETURN QUERY
  SELECT p.email::text, p.status::text, 'officer'::text, true
  FROM public.examination_officers eo
  JOIN public.profiles p ON p.id = eo.profile_id
  WHERE eo.school_id = v_school_id
    AND (
      lower(trim(coalesce(eo.officer_id,''))) = v_ident
      OR lower(regexp_replace(trim(coalesce(p.full_name,'')), '\s+', ' ', 'g')) = v_ident
      OR lower(trim(coalesce(p.email,''))) = v_ident
    )
    AND p.email IS NOT NULL
  LIMIT 1;
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_login_identity(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_login_identity(text, text) TO anon, authenticated, service_role;

-- Role list for the signed-in user (bypasses RLS edge cases)
CREATE OR REPLACE FUNCTION public.get_my_roles()
RETURNS TABLE(role text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT ur.role::text
  FROM public.user_roles ur
  WHERE ur.user_id = auth.uid();
$$;

REVOKE ALL ON FUNCTION public.get_my_roles() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_roles() TO authenticated, anon, service_role;

GRANT EXECUTE ON FUNCTION public.is_super_admin() TO anon, authenticated, service_role;
