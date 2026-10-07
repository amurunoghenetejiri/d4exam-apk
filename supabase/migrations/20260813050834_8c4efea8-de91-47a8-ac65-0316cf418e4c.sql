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
  v_ident text := lower(regexp_replace(trim(coalesce(_identifier,'')), '\s+', ' ', 'g'));
  v_code text := upper(trim(coalesce(_school_code,'')));
BEGIN
  IF v_ident = '' THEN RETURN; END IF;

  IF v_code <> '' THEN
    SELECT s.id, s.status::text INTO v_school_id, v_school_status
    FROM public.schools s WHERE upper(s.school_code) = v_code LIMIT 1;
    IF v_school_id IS NULL THEN RETURN; END IF;
    IF v_school_status <> 'active' THEN
      RETURN QUERY SELECT NULL::text, NULL::text, 'school_inactive'::text, false;
      RETURN;
    END IF;
  END IF;

  -- direct email match
  RETURN QUERY
  SELECT p.email, p.status::text, 'profile'::text, true
  FROM public.profiles p
  WHERE lower(p.email) = v_ident
    AND (v_school_id IS NULL OR p.school_id = v_school_id)
  LIMIT 1;
  IF FOUND THEN RETURN; END IF;

  IF v_school_id IS NULL THEN RETURN; END IF;

  -- student: exact matric / student id / admission no / full name
  RETURN QUERY
  SELECT p.email, COALESCE(p.status::text, st.status::text), 'student'::text, true
  FROM public.students st
  LEFT JOIN public.profiles p ON p.id = st.profile_id
  WHERE st.school_id = v_school_id
    AND (
      lower(trim(coalesce(st.matric_number,''))) = v_ident
      OR lower(trim(coalesce(st.student_id,''))) = v_ident
      OR lower(trim(coalesce(st.admission_number,''))) = v_ident
      OR lower(regexp_replace(trim(coalesce(st.full_name,'')), '\s+', ' ', 'g')) = v_ident
    )
    AND p.email IS NOT NULL
  LIMIT 1;
  IF FOUND THEN RETURN; END IF;

  -- teacher
  RETURN QUERY
  SELECT p.email, p.status::text, 'teacher'::text, true
  FROM public.teachers t
  JOIN public.profiles p ON p.id = t.profile_id
  WHERE t.school_id = v_school_id
    AND lower(trim(coalesce(t.staff_id,''))) = v_ident
  LIMIT 1;
  IF FOUND THEN RETURN; END IF;

  -- examination officer
  RETURN QUERY
  SELECT p.email, p.status::text, 'officer'::text, true
  FROM public.examination_officers eo
  JOIN public.profiles p ON p.id = eo.profile_id
  WHERE eo.school_id = v_school_id
    AND lower(trim(coalesce(eo.officer_id,''))) = v_ident
  LIMIT 1;
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_login_identity(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_login_identity(text, text) TO anon, authenticated, service_role;