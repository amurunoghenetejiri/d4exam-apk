-- D4EXAM: make notifications fully usable for all roles (insert + delete + optional link)

-- Optional deep-link column (safe if already present)
ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS link text;

-- Allow any authenticated user to INSERT notifications (teachers → officers, officers → teachers, system flows)
DROP POLICY IF EXISTS "notifications_authenticated_insert" ON public.notifications;
CREATE POLICY "notifications_authenticated_insert"
  ON public.notifications
  FOR INSERT
  TO authenticated
  WITH CHECK (
    recipient_user_id IS NOT NULL
    AND auth.uid() IS NOT NULL
  );

-- Recipient can delete their own notifications (dismiss)
DROP POLICY IF EXISTS "notifications_own_delete" ON public.notifications;
CREATE POLICY "notifications_own_delete"
  ON public.notifications
  FOR DELETE
  TO authenticated
  USING (recipient_user_id = auth.uid());

COMMENT ON COLUMN public.notifications.link IS 'In-app path to open when notification is clicked, e.g. /officer/approvals';
