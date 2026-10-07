-- D4EXAM: Departmental Officer is the display name for role examination_officer.
-- Machine value stays examination_officer so existing users, RLS, and auth keep working.
-- No data rewrite required.

COMMENT ON TABLE public.examination_officers IS
  'Departmental officers (DB role examination_officer). Head/assigned officer for departmental examination operations.';

-- Optional priority for filtering / heads-up (FCM already sends Android HIGH priority)
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS priority text DEFAULT 'normal';
