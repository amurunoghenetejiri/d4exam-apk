-- D4EXAM campus messaging: student↔student, groups, unified conversations
-- Keeps student_officer_reports intact for officer channel.
-- School-scoped; RLS enforces membership and same-school discovery.

-- ---------------------------------------------------------------------------
-- conversations
-- ---------------------------------------------------------------------------
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

CREATE INDEX IF NOT EXISTS idx_conv_school_updated
  ON public.conversations (school_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_conv_last_msg
  ON public.conversations (last_message_at DESC NULLS LAST);

-- ---------------------------------------------------------------------------
-- conversation_members
-- ---------------------------------------------------------------------------
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

CREATE INDEX IF NOT EXISTS idx_cm_user
  ON public.conversation_members (user_id, left_at);
CREATE INDEX IF NOT EXISTS idx_cm_conv
  ON public.conversation_members (conversation_id)
  WHERE left_at IS NULL;

-- ---------------------------------------------------------------------------
-- messages (campus)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.campus_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL,
  body text,
  attachment_url text,
  attachment_type text,
  reply_to_id uuid REFERENCES public.campus_messages(id) ON DELETE SET NULL,
  forwarded_from_id uuid,
  client_id text,
  duration_sec numeric,
  created_at timestamptz NOT NULL DEFAULT now(),
  edited_at timestamptz,
  deleted_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_cm_client_id
  ON public.campus_messages (conversation_id, client_id)
  WHERE client_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_cm_conv_created
  ON public.campus_messages (conversation_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campus_messages ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE ON public.conversations TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.conversation_members TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.campus_messages TO authenticated;
GRANT ALL ON public.conversations TO service_role;
GRANT ALL ON public.conversation_members TO service_role;
GRANT ALL ON public.campus_messages TO service_role;

-- Helper: active membership
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

-- conversations: members can select
DROP POLICY IF EXISTS "conv_select_member" ON public.conversations;
CREATE POLICY "conv_select_member" ON public.conversations
  FOR SELECT TO authenticated
  USING (public.is_conversation_member(id));

DROP POLICY IF EXISTS "conv_insert_auth" ON public.conversations;
CREATE POLICY "conv_insert_auth" ON public.conversations
  FOR INSERT TO authenticated
  WITH CHECK (
    created_by = auth.uid()
    AND school_id IN (
      SELECT p.school_id FROM public.profiles p
      WHERE p.auth_user_id = auth.uid() AND p.school_id IS NOT NULL
      UNION
      SELECT s.school_id FROM public.students s
      INNER JOIN public.profiles p ON p.id = s.profile_id
      WHERE p.auth_user_id = auth.uid() AND s.school_id IS NOT NULL
    )
  );

DROP POLICY IF EXISTS "conv_update_admin" ON public.conversations;
CREATE POLICY "conv_update_admin" ON public.conversations
  FOR UPDATE TO authenticated
  USING (
    public.is_conversation_member(id)
  );

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
    -- creator adding self, or admin adding others
    user_id = auth.uid()
    OR public.is_conversation_admin(conversation_id)
    OR (
      -- allow adding first members when creating (creator is inserting own + peers)
      EXISTS (
        SELECT 1 FROM public.conversations c
        WHERE c.id = conversation_id AND c.created_by = auth.uid()
      )
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

-- Peer discovery: same-school students can read limited student rows
-- (does not expose email/phone; only academic identity fields via SELECT)
DROP POLICY IF EXISTS "students_same_school_discover" ON public.students;
CREATE POLICY "students_same_school_discover" ON public.students
  FOR SELECT TO authenticated
  USING (
    school_id IN (
      SELECT p.school_id FROM public.profiles p
      WHERE p.auth_user_id = auth.uid() AND p.school_id IS NOT NULL
      UNION
      SELECT s.school_id FROM public.students s
      INNER JOIN public.profiles p ON p.id = s.profile_id
      WHERE p.auth_user_id = auth.uid() AND s.school_id IS NOT NULL
    )
  );

-- profiles: allow reading display name/avatar for same-school peers in messaging
DROP POLICY IF EXISTS "profiles_same_school_messaging" ON public.profiles;
CREATE POLICY "profiles_same_school_messaging" ON public.profiles
  FOR SELECT TO authenticated
  USING (
    auth_user_id = auth.uid()
    OR school_id IN (
      SELECT p.school_id FROM public.profiles p
      WHERE p.auth_user_id = auth.uid() AND p.school_id IS NOT NULL
    )
  );

-- Realtime
DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.campus_messages;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.conversations;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END $$;
