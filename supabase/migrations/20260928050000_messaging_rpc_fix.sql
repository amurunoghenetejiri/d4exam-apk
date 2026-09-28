-- D4EXAM messaging: RPCs that fix create-group RLS and empty student lists
-- Run entire script in Supabase SQL Editor. No dollar-signs used.

-- Ensure tables exist
CREATE TABLE IF NOT EXISTS public.conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  type text NOT NULL DEFAULT 'direct'
    CHECK (type IN ('direct', 'group')),
  title text,
  description text,
  avatar_url text,
  group_kind text
    CHECK (group_kind IS NULL OR group_kind IN (
      'study', 'course', 'class', 'project', 'general'
    )),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_message_at timestamptz,
  last_message_preview text,
  last_message_sender_id uuid
);

CREATE TABLE IF NOT EXISTS public.conversation_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  profile_id uuid,
  role text NOT NULL DEFAULT 'member'
    CHECK (role IN ('member', 'admin', 'owner')),
  joined_at timestamptz NOT NULL DEFAULT now(),
  last_read_at timestamptz,
  muted boolean NOT NULL DEFAULT false,
  left_at timestamptz,
  UNIQUE (conversation_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.campus_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL,
  body text,
  attachment_url text,
  attachment_type text,
  reply_to_id uuid,
  forwarded_from_id uuid,
  client_id text,
  duration_sec numeric,
  created_at timestamptz NOT NULL DEFAULT now(),
  edited_at timestamptz,
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_conv_school_updated
  ON public.conversations (school_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_cm_user
  ON public.conversation_members (user_id, left_at);
CREATE INDEX IF NOT EXISTS idx_cm_conv_created
  ON public.campus_messages (conversation_id, created_at DESC);

ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campus_messages ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE ON public.conversations TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.conversation_members TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.campus_messages TO authenticated;
GRANT ALL ON public.conversations TO service_role;
GRANT ALL ON public.conversation_members TO service_role;
GRANT ALL ON public.campus_messages TO service_role;

-- Helper: school ids for current user
CREATE OR REPLACE FUNCTION public.my_school_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS '
  SELECT DISTINCT sid FROM (
    SELECT p.school_id AS sid
    FROM public.profiles p
    WHERE p.auth_user_id = auth.uid() AND p.school_id IS NOT NULL
    UNION ALL
    SELECT s.school_id AS sid
    FROM public.students s
    INNER JOIN public.profiles p ON p.id = s.profile_id
    WHERE p.auth_user_id = auth.uid() AND s.school_id IS NOT NULL
    UNION ALL
    SELECT s.school_id AS sid
    FROM public.students s
    WHERE s.profile_id = auth.uid() AND s.school_id IS NOT NULL
  ) x
  WHERE sid IS NOT NULL;
';

CREATE OR REPLACE FUNCTION public.is_conversation_member(cid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS '
  SELECT EXISTS (
    SELECT 1 FROM public.conversation_members m
    WHERE m.conversation_id = cid
      AND m.user_id = auth.uid()
      AND m.left_at IS NULL
  );
';

CREATE OR REPLACE FUNCTION public.is_conversation_admin(cid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS '
  SELECT EXISTS (
    SELECT 1 FROM public.conversation_members m
    WHERE m.conversation_id = cid
      AND m.user_id = auth.uid()
      AND m.left_at IS NULL
      AND m.role IN (''admin'', ''owner'')
  );
';

-- Policies (permissive, use helpers)
DROP POLICY IF EXISTS "conv_select_member" ON public.conversations;
CREATE POLICY "conv_select_member" ON public.conversations
  FOR SELECT TO authenticated
  USING (public.is_conversation_member(id));

DROP POLICY IF EXISTS "conv_insert_auth" ON public.conversations;
CREATE POLICY "conv_insert_auth" ON public.conversations
  FOR INSERT TO authenticated
  WITH CHECK (
    created_by = auth.uid()
    AND school_id IN (SELECT public.my_school_ids())
  );

DROP POLICY IF EXISTS "conv_update_member" ON public.conversations;
DROP POLICY IF EXISTS "conv_update_admin" ON public.conversations;
CREATE POLICY "conv_update_member" ON public.conversations
  FOR UPDATE TO authenticated
  USING (public.is_conversation_member(id));

DROP POLICY IF EXISTS "cm_select" ON public.conversation_members;
CREATE POLICY "cm_select" ON public.conversation_members
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR public.is_conversation_member(conversation_id)
  );

DROP POLICY IF EXISTS "cm_insert" ON public.conversation_members;
CREATE POLICY "cm_insert" ON public.conversation_members
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    OR public.is_conversation_admin(conversation_id)
    OR EXISTS (
      SELECT 1 FROM public.conversations c
      WHERE c.id = conversation_id AND c.created_by = auth.uid()
    )
  );

DROP POLICY IF EXISTS "cm_update_self" ON public.conversation_members;
CREATE POLICY "cm_update_self" ON public.conversation_members
  FOR UPDATE TO authenticated
  USING (
    user_id = auth.uid()
    OR public.is_conversation_admin(conversation_id)
  );

DROP POLICY IF EXISTS "msg_select" ON public.campus_messages;
CREATE POLICY "msg_select" ON public.campus_messages
  FOR SELECT TO authenticated
  USING (public.is_conversation_member(conversation_id));

DROP POLICY IF EXISTS "msg_insert" ON public.campus_messages;
CREATE POLICY "msg_insert" ON public.campus_messages
  FOR INSERT TO authenticated
  WITH CHECK (
    sender_id = auth.uid()
    AND public.is_conversation_member(conversation_id)
  );

DROP POLICY IF EXISTS "msg_update_own" ON public.campus_messages;
CREATE POLICY "msg_update_own" ON public.campus_messages
  FOR UPDATE TO authenticated
  USING (
    sender_id = auth.uid()
    OR public.is_conversation_admin(conversation_id)
  );

DROP POLICY IF EXISTS "students_same_school_discover" ON public.students;
CREATE POLICY "students_same_school_discover" ON public.students
  FOR SELECT TO authenticated
  USING (school_id IN (SELECT public.my_school_ids()));

DROP POLICY IF EXISTS "profiles_same_school_messaging" ON public.profiles;
CREATE POLICY "profiles_same_school_messaging" ON public.profiles
  FOR SELECT TO authenticated
  USING (
    auth_user_id = auth.uid()
    OR school_id IN (SELECT public.my_school_ids())
    OR id IN (
      SELECT s.profile_id FROM public.students s
      WHERE s.school_id IN (SELECT public.my_school_ids())
        AND s.profile_id IS NOT NULL
    )
  );

GRANT EXECUTE ON FUNCTION public.my_school_ids() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_conversation_member(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_conversation_admin(uuid) TO authenticated;

-- RPC: create conversation (group or direct) as SECURITY DEFINER
-- Bypasses insert RLS while still checking school membership
CREATE OR REPLACE FUNCTION public.create_campus_conversation(
  p_type text,
  p_title text DEFAULT NULL,
  p_description text DEFAULT NULL,
  p_group_kind text DEFAULT 'study',
  p_member_user_ids uuid[] DEFAULT ARRAY[]::uuid[],
  p_school_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS '
DECLARE
  v_uid uuid := auth.uid();
  v_school uuid;
  v_cid uuid;
  v_peer uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION ''Not authenticated'';
  END IF;

  IF p_school_id IS NOT NULL AND p_school_id IN (SELECT public.my_school_ids()) THEN
    v_school := p_school_id;
  ELSE
    SELECT sid INTO v_school FROM public.my_school_ids() AS sid LIMIT 1;
  END IF;

  IF v_school IS NULL THEN
    RAISE EXCEPTION ''No school linked to your account. Ask admin to set school_id on your profile or student record.'';
  END IF;

  IF p_type NOT IN (''direct'', ''group'') THEN
    RAISE EXCEPTION ''Invalid conversation type'';
  END IF;

  INSERT INTO public.conversations (
    school_id, type, title, description, group_kind, created_by, updated_at
  ) VALUES (
    v_school,
    p_type,
    NULLIF(trim(COALESCE(p_title, '''')), ''''),
    NULLIF(trim(COALESCE(p_description, '''')), ''''),
    CASE WHEN p_type = ''group'' THEN COALESCE(p_group_kind, ''study'') ELSE NULL END,
    v_uid,
    now()
  )
  RETURNING id INTO v_cid;

  INSERT INTO public.conversation_members (conversation_id, user_id, role)
  VALUES (
    v_cid,
    v_uid,
    CASE WHEN p_type = ''group'' THEN ''owner'' ELSE ''member'' END
  );

  IF p_member_user_ids IS NOT NULL THEN
    FOREACH v_peer IN ARRAY p_member_user_ids
    LOOP
      IF v_peer IS NOT NULL AND v_peer <> v_uid THEN
        INSERT INTO public.conversation_members (conversation_id, user_id, role)
        VALUES (v_cid, v_peer, ''member'')
        ON CONFLICT (conversation_id, user_id) DO NOTHING;
      END IF;
    END LOOP;
  END IF;

  RETURN v_cid;
END;
';

GRANT EXECUTE ON FUNCTION public.create_campus_conversation(text, text, text, text, uuid[], uuid) TO authenticated;

-- RPC: list same-school students for messaging discovery
CREATE OR REPLACE FUNCTION public.list_school_students_for_messaging(
  p_query text DEFAULT NULL,
  p_department_id uuid DEFAULT NULL,
  p_limit int DEFAULT 60
)
RETURNS TABLE (
  id uuid,
  profile_id uuid,
  auth_user_id uuid,
  full_name text,
  matric_number text,
  department text,
  level text,
  department_id uuid,
  level_id uuid,
  school_id uuid,
  avatar_url text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS '
DECLARE
  v_uid uuid := auth.uid();
  v_q text := lower(trim(COALESCE(p_query, '''')));
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION ''Not authenticated'';
  END IF;

  RETURN QUERY
  SELECT
    s.id,
    s.profile_id,
    p.auth_user_id,
    COALESCE(NULLIF(s.full_name, ''''), NULLIF(p.full_name, ''''), ''Student'')::text AS full_name,
    COALESCE(s.matric_number, s.student_id)::text AS matric_number,
    d.name::text AS department,
    l.name::text AS level,
    s.department_id,
    s.level_id,
    s.school_id,
    p.avatar_url::text AS avatar_url
  FROM public.students s
  LEFT JOIN public.profiles p ON p.id = s.profile_id
  LEFT JOIN public.departments d ON d.id = s.department_id
  LEFT JOIN public.levels l ON l.id = s.level_id
  WHERE s.school_id IN (SELECT public.my_school_ids())
    AND (p_department_id IS NULL OR s.department_id = p_department_id)
    AND (
      v_q = ''''
      OR lower(COALESCE(s.full_name, '''')) LIKE ''%'' || v_q || ''%''
      OR lower(COALESCE(p.full_name, '''')) LIKE ''%'' || v_q || ''%''
      OR lower(COALESCE(s.matric_number, '''')) LIKE ''%'' || v_q || ''%''
      OR lower(COALESCE(s.student_id, '''')) LIKE ''%'' || v_q || ''%''
      OR lower(COALESCE(d.name, '''')) LIKE ''%'' || v_q || ''%''
      OR lower(COALESCE(l.name, '''')) LIKE ''%'' || v_q || ''%''
    )
    AND (p.auth_user_id IS NULL OR p.auth_user_id <> v_uid)
  ORDER BY COALESCE(s.full_name, p.full_name, ''Student'')
  LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 60), 100));
END;
';

GRANT EXECUTE ON FUNCTION public.list_school_students_for_messaging(text, uuid, int) TO authenticated;

-- Realtime
DO '
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.campus_messages;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.conversations;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END;
';
