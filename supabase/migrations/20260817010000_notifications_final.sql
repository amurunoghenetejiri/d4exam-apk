-- =============================================================================
-- D4EXAM — NOTIFICATIONS (FINAL)
-- Run this entire script in Supabase → SQL Editor → New query → Run
-- Safe to re-run (idempotent).
-- =============================================================================

-- 1) Table
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

-- 2) Extra columns used by the app
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS link text;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS action_url text;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS entity_type text;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS entity_id uuid;

-- 3) Indexes
CREATE INDEX IF NOT EXISTS idx_notifications_recipient
  ON public.notifications (recipient_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notifications_unread
  ON public.notifications (recipient_user_id)
  WHERE read_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_notifications_school
  ON public.notifications (school_id, created_at DESC);

-- 4) RLS + grants
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.notifications TO authenticated;
GRANT ALL ON public.notifications TO service_role;

-- Drop old policies so we can recreate cleanly
DROP POLICY IF EXISTS "notifications_own_select" ON public.notifications;
DROP POLICY IF EXISTS "notifications_own_update" ON public.notifications;
DROP POLICY IF EXISTS "notifications_own_delete" ON public.notifications;
DROP POLICY IF EXISTS "notifications_admin_write" ON public.notifications;
DROP POLICY IF EXISTS "notifications_authenticated_insert" ON public.notifications;
DROP POLICY IF EXISTS "notifications_select" ON public.notifications;
DROP POLICY IF EXISTS "notifications_update" ON public.notifications;
DROP POLICY IF EXISTS "notifications_delete" ON public.notifications;
DROP POLICY IF EXISTS "notifications_insert" ON public.notifications;

-- SELECT: own rows (plus school admin / super admin for support)
CREATE POLICY "notifications_own_select"
  ON public.notifications FOR SELECT TO authenticated
  USING (
    recipient_user_id = auth.uid()
    OR public.is_super_admin()
    OR (school_id IS NOT NULL AND public.can_manage_school(school_id))
  );

-- UPDATE: recipient marks as read
CREATE POLICY "notifications_own_update"
  ON public.notifications FOR UPDATE TO authenticated
  USING (recipient_user_id = auth.uid())
  WITH CHECK (recipient_user_id = auth.uid());

-- DELETE: recipient dismisses
CREATE POLICY "notifications_own_delete"
  ON public.notifications FOR DELETE TO authenticated
  USING (recipient_user_id = auth.uid());

-- INSERT: any signed-in user may notify another user
CREATE POLICY "notifications_authenticated_insert"
  ON public.notifications FOR INSERT TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL AND recipient_user_id IS NOT NULL);

-- 5) Reliable insert RPC (SECURITY DEFINER)
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

GRANT EXECUTE ON FUNCTION public.insert_notification(
  uuid, text, text, text, uuid, text, text, uuid
) TO service_role;

-- 6) Realtime (bell updates live)
ALTER TABLE public.notifications REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'notifications'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
  END IF;
EXCEPTION
  WHEN undefined_object THEN
    NULL;
END $$;

COMMENT ON COLUMN public.notifications.recipient_user_id IS
  'Must be auth.users.id (= auth.uid()), NEVER profiles.id';
COMMENT ON COLUMN public.notifications.link IS
  'In-app path e.g. /officer/approvals';

-- =============================================================================
-- OPTIONAL TEST (run while logged in as a user in the SQL Editor via service role,
-- or insert from the app). Example with a known auth user id:
--
-- INSERT INTO public.notifications (recipient_user_id, title, message, type)
-- VALUES ('PASTE-AUTH-USER-UUID-HERE', 'Test notification', 'Notifications are working.', 'success');
-- =============================================================================
