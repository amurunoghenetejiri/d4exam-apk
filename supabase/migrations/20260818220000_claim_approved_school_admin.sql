-- Applicant account setup without service role

CREATE OR REPLACE FUNCTION public.lookup_school_application_for_setup(_email text, _tracking_code text)
RETURNS TABLE (
  id uuid,
  status text,
  applicant_email text,
  issued_school_code text,
  issued_admin_email text,
  school_name text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    a.id,
    a.status::text,
    a.applicant_email::text,
    a.issued_school_code::text,
    a.issued_admin_email::text,
    a.school_name::text
  FROM public.school_applications a
  WHERE a.tracking_code = trim(_tracking_code)
    AND lower(trim(a.applicant_email)) = lower(trim(_email))
  ORDER BY a.created_at DESC
  LIMIT 1;
END;
$$;

REVOKE ALL ON FUNCTION public.lookup_school_application_for_setup(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lookup_school_application_for_setup(text, text) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.claim_approved_school_admin(
  _tracking_code text,
  _email text,
  _user_id uuid
)
RETURNS TABLE (ok boolean, error text, school_code text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_app public.school_applications%ROWTYPE;
  v_school_id uuid;
  v_code text;
  v_email text := lower(trim(_email));
BEGIN
  IF _user_id IS NULL THEN
    RETURN QUERY SELECT false, 'Missing user id'::text, NULL::text;
    RETURN;
  END IF;

  SELECT * INTO v_app
  FROM public.school_applications a
  WHERE a.tracking_code = trim(_tracking_code)
    AND lower(trim(a.applicant_email)) = v_email
  ORDER BY a.created_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'Application not found'::text, NULL::text;
    RETURN;
  END IF;

  IF lower(coalesce(v_app.status::text, '')) <> 'approved' THEN
    RETURN QUERY SELECT false, 'Application is not approved yet'::text, NULL::text;
    RETURN;
  END IF;

  v_code := nullif(trim(coalesce(v_app.issued_school_code, '')), '');
  IF v_code IS NULL THEN
    RETURN QUERY SELECT false, 'School code not ready'::text, NULL::text;
    RETURN;
  END IF;

  SELECT s.id INTO v_school_id
  FROM public.schools s
  WHERE upper(trim(s.school_code)) = upper(v_code)
  LIMIT 1;

  IF v_school_id IS NULL THEN
    RETURN QUERY SELECT false, 'School not found'::text, v_code;
    RETURN;
  END IF;

  -- Profile
  IF EXISTS (SELECT 1 FROM public.profiles p WHERE p.auth_user_id = _user_id) THEN
    UPDATE public.profiles
    SET
      school_id = v_school_id,
      email = coalesce(nullif(trim(email), ''), v_email),
      full_name = coalesce(nullif(trim(full_name), ''), v_app.applicant_name, v_app.school_name),
      status = 'active'
    WHERE auth_user_id = _user_id;
  ELSIF EXISTS (SELECT 1 FROM public.profiles p WHERE lower(trim(p.email)) = v_email) THEN
    UPDATE public.profiles
    SET
      auth_user_id = _user_id,
      school_id = v_school_id,
      status = 'active'
    WHERE lower(trim(email)) = v_email;
  ELSE
    INSERT INTO public.profiles (auth_user_id, school_id, email, full_name, status)
    VALUES (
      _user_id,
      v_school_id,
      v_email,
      coalesce(v_app.applicant_name, v_app.school_name, 'School Admin'),
      'active'
    );
  END IF;

  -- Role
  IF NOT EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = _user_id
      AND ur.role = 'school_admin'
      AND ur.school_id = v_school_id
  ) THEN
    INSERT INTO public.user_roles (user_id, school_id, role)
    VALUES (_user_id, v_school_id, 'school_admin');
  END IF;

  UPDATE public.school_applications
  SET issued_admin_password = NULL,
      issued_admin_email = coalesce(issued_admin_email, v_email)
  WHERE id = v_app.id;

  RETURN QUERY SELECT true, NULL::text, v_code;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_approved_school_admin(text, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_approved_school_admin(text, text, uuid) TO anon, authenticated, service_role;
