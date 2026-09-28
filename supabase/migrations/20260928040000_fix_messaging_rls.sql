-- Fix campus messaging RLS so create group / direct chat / student discovery work.
-- Safe to re-run.

-- Resolve school ids for the current auth user (profiles + students)
CREATE OR REPLACE FUNCTION public.my_school_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
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
$$;

CREATE OR REPLACE FUNCTION public.is_conversation_member(cid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.conversation_members m
    WHERE m.conversation_id = cid
      AND m.user_id = auth.uid()
      AND m.left_at IS NULL
  );
$$;

CREATE OR REPLACE FUNCTION public.is_conversation_admin(cid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.conversation_members m
    WHERE m.conversation_id = cid
      AND m.user_id = auth.uid()
      AND m.left_at IS NULL
      AND m.role IN ('admin', 'owner')
  );
$$;

-- conversations policies
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

DROP POLICY IF EXISTS "conv_update_admin" ON public.conversations;
CREATE POLICY "conv_update_admin" ON public.conversations
  FOR UPDATE TO authenticated
  USING (public.is_conversation_member(id));

-- members
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

-- messages
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

-- Student discovery: same school (permissive, does not block existing policies)
DROP POLICY IF EXISTS "students_same_school_discover" ON public.students;
CREATE POLICY "students_same_school_discover" ON public.students
  FOR SELECT TO authenticated
  USING (
    school_id IN (SELECT public.my_school_ids())
  );

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

-- Ensure grants
GRANT SELECT, INSERT, UPDATE ON public.conversations TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.conversation_members TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.campus_messages TO authenticated;
GRANT EXECUTE ON FUNCTION public.my_school_ids() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_conversation_member(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_conversation_admin(uuid) TO authenticated;
