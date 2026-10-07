-- Notifications must work for every role (student, teacher, officer, admin, super_admin)

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'notifications' AND column_name = 'entity_id'
      AND data_type = 'uuid'
  ) THEN
    ALTER TABLE public.notifications ALTER COLUMN entity_id TYPE text USING entity_id::text;
  END IF;
EXCEPTION WHEN OTHERS THEN
  ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS entity_id text;
END $$;

ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS link text;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS action_url text;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS entity_type text;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS type text DEFAULT 'info';
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS message text DEFAULT '';
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS read_at timestamptz;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS school_id uuid;

CREATE INDEX IF NOT EXISTS idx_notifications_recipient_created
  ON public.notifications (recipient_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_recipient_unread
  ON public.notifications (recipient_user_id)
  WHERE read_at IS NULL;

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications REPLICA IDENTITY FULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.notifications TO authenticated;
GRANT ALL ON public.notifications TO service_role;

DROP POLICY IF EXISTS "notifications_own_select" ON public.notifications;
DROP POLICY IF EXISTS "notifications_own_update" ON public.notifications;
DROP POLICY IF EXISTS "notifications_own_delete" ON public.notifications;
DROP POLICY IF EXISTS "notifications_authenticated_insert" ON public.notifications;
DROP POLICY IF EXISTS notifications_select_own ON public.notifications;
DROP POLICY IF EXISTS notifications_update_own ON public.notifications;
DROP POLICY IF EXISTS notifications_delete_own ON public.notifications;
DROP POLICY IF EXISTS notifications_insert_self ON public.notifications;

CREATE POLICY "notifications_own_select"
  ON public.notifications FOR SELECT TO authenticated
  USING (recipient_user_id = auth.uid());

CREATE POLICY "notifications_own_update"
  ON public.notifications FOR UPDATE TO authenticated
  USING (recipient_user_id = auth.uid())
  WITH CHECK (recipient_user_id = auth.uid());

CREATE POLICY "notifications_own_delete"
  ON public.notifications FOR DELETE TO authenticated
  USING (recipient_user_id = auth.uid());

CREATE POLICY "notifications_authenticated_insert"
  ON public.notifications FOR INSERT TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE OR REPLACE FUNCTION public.insert_notification(
  _recipient uuid,
  _title text,
  _message text,
  _type text DEFAULT 'info',
  _school_id uuid DEFAULT NULL,
  _link text DEFAULT NULL,
  _entity_type text DEFAULT NULL,
  _entity_id text DEFAULT NULL
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
    recipient_user_id, school_id, title, message, type, link, action_url, entity_type, entity_id
  ) VALUES (
    _recipient,
    _school_id,
    coalesce(nullif(trim(_title), ''), 'Notification'),
    coalesce(_message, ''),
    coalesce(nullif(trim(_type), ''), 'info'),
    _link,
    _link,
    _entity_type,
    nullif(trim(coalesce(_entity_id, '')), '')
  )
  RETURNING id INTO new_id;

  RETURN new_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.insert_notification(
  uuid, text, text, text, uuid, text, text, text
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.insert_notification(
  uuid, text, text, text, uuid, text, text, text
) TO service_role;

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
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;
