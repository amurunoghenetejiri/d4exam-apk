-- Public profile RPC for messaging / call UI (SECURITY DEFINER, same-school only)
CREATE OR REPLACE FUNCTION public.get_user_public_profile(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_result jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT jsonb_build_object(
    'auth_user_id', p.auth_user_id,
    'profile_id', p.id,
    'full_name', COALESCE(NULLIF(p.full_name, ''), NULLIF(s.full_name, ''), 'Student'),
    'first_name', p.first_name,
    'last_name', p.last_name,
    'avatar_url', COALESCE(p.profile_photo_url, p.avatar_url),
    'profile_photo_url', COALESCE(p.profile_photo_url, p.avatar_url),
    'phone', p.phone,
    'school_id', COALESCE(p.school_id, s.school_id),
    'status', COALESCE(s.status, p.status),
    'matric_number', COALESCE(s.matric_number, s.student_id),
    'department_id', s.department_id,
    'level_id', s.level_id,
    'department_name', d.name,
    'level_name', l.name,
    'student_id', s.id
  )
  INTO v_result
  FROM public.profiles p
  LEFT JOIN public.students s ON s.profile_id = p.id
  LEFT JOIN public.departments d ON d.id = s.department_id
  LEFT JOIN public.levels l ON l.id = s.level_id
  WHERE (p.auth_user_id = p_user_id OR p.id = p_user_id)
    AND (
      p.auth_user_id = v_uid
      OR p.school_id IN (SELECT public.my_school_ids())
      OR s.school_id IN (SELECT public.my_school_ids())
    )
  ORDER BY s.id NULLS LAST
  LIMIT 1;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_user_public_profile(uuid) TO authenticated;
