-- D4EXAM: complete notifications schema, RLS, RPC, realtime

-- Core table (safe if already exists)
CREATE TABLE IF NOT EXISTS public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_user_id uuid NOT NULL,
  school_id uuid REFERENCES public.schools(id) ON DELETE CASCADE,
  title text NOT NULL,
  message text NOT NULL,
  type text NOT NULL DEFAULT 'info',
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Optional columns used by the app
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS link text;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS action_url text;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS entity_type text;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS entity_id uuid;

CREATE INDEX IF NOT EXISTS idx_notifications_recipient
  ON public.notifications (recipient_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_unread
  ON public.notifications (recipient_user_id)
  WHERE read_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_notifications_entity
  ON public.notifications (entity_type, entity_id);

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.notifications TO authenticated;
GRANT ALL ON public.notifications TO service_role;

-- Drop old policies so we can recreate cleanly
DROP POLICY IF EXISTS "notifications_own_select" ON public.notifications;
DROP POLICY IF EXISTS "notifications_own_update" ON public.notifications;
DROP POLICY IF EXISTS "notifications_own_delete" ON public.notifications;
DROP POLICY IF EXISTS "notifications_admin_write" ON public.notifications;
DROP POLICY IF EXISTS "notifications_authenticated_insert" ON public.notifications;

-- Recipient reads own notifications
CREATE POLICY "notifications_own_select"
  ON public.notifications FOR SELECT TO authenticated
  USING (recipient_user_id = auth.uid() OR public.can_manage_school(school_id) OR public.is_super_admin());

-- Recipient marks read
CREATE POLICY "notifications_own_update"
  ON public.notifications FOR UPDATE TO authenticated
  USING (recipient_user_id = auth.uid())
  WITH CHECK (recipient_user_id = auth.uid());

-- Recipient dismisses
CREATE POLICY "notifications_own_delete"
  ON public.notifications FOR DELETE TO authenticated
  USING (recipient_user_id = auth.uid());

-- Any signed-in user may create a notification for someone (teacher→officer, officer→teacher/student)
CREATE POLICY "notifications_authenticated_insert"
  ON public.notifications FOR INSERT TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL AND recipient_user_id IS NOT NULL);

-- Admin full access in their school
CREATE POLICY "notifications_admin_write"
  ON public.notifications FOR ALL TO authenticated
  USING (public.can_manage_school(school_id) OR public.is_super_admin())
  WITH CHECK (public.can_manage_school(school_id) OR public.is_super_admin());

-- Reliable insert helper (SECURITY DEFINER) so cross-role alerts always land
CREATE OR REPLACE FUNCTION public.insert_notification(
  _recipient uuid,
  _title text,
  _message text,
  _type text DEFAULT 'info',
  _school_id uuid DEFAULT NULL,
  _link text DEFAULT NULL,
  _entity_type text DEFAULT NULL,
  _entity_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF _recipient IS NULL THEN
    RAISE EXCEPTION 'recipient required';
  END IF;

  INSERT INTO public.notifications (
    recipient_user_id,
    school_id,
    title,
    message,
    type,
    link,
    action_url,
    entity_type,
    entity_id
  ) VALUES (
    _recipient,
    _school_id,
    coalesce(nullif(trim(_title), ''), 'Notification'),
    coalesce(_message, ''),
    coalesce(nullif(trim(_type), ''), 'info'),
    _link,
    _link,
    _entity_type,
    _entity_id
  )
  RETURNING id INTO new_id;

  RETURN new_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.insert_notification(
  uuid, text, text, text, uuid, text, text, uuid
) TO authenticated;

-- Realtime so the bell updates live
ALTER TABLE public.notifications REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'notifications'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
  END IF;
END $$;

COMMENT ON COLUMN public.notifications.recipient_user_id IS 'Must be auth.users.id (auth.uid()), not profiles.id';
COMMENT ON COLUMN public.notifications.link IS 'In-app path e.g. /officer/approvals';
