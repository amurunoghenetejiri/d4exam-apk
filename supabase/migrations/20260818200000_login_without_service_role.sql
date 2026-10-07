-- Login helpers callable by anon (no service role required).
-- SECURITY DEFINER bypasses schools RLS for code lookup only.

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
  IF v_code = '' THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT s.id, s.school_code::text, s.status::text
  FROM public.schools s
  WHERE upper(trim(s.school_code)) = v_code
  LIMIT 1;
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_school_for_login(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_school_for_login(text) TO anon, authenticated, service_role;

-- Ensure login identity resolver stays available to anon
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'resolve_login_identity'
  ) THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.resolve_login_identity(text, text) TO anon, authenticated, service_role';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'is_super_admin'
  ) THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.is_super_admin() TO anon, authenticated, service_role';
  END IF;
END;
$$;
