-- CBT security enhancements

ALTER TABLE public.exam_settings
  ADD COLUMN IF NOT EXISTS max_fullscreen_exits integer NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS warning_threshold integer NOT NULL DEFAULT 3;

ALTER TABLE public.exam_attempts
  ADD COLUMN IF NOT EXISTS ends_at timestamptz,
  ADD COLUMN IF NOT EXISTS fullscreen_exit_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS security_review_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS question_order jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.results
  ADD COLUMN IF NOT EXISTS percentage numeric,
  ADD COLUMN IF NOT EXISTS pass_fail text,
  ADD COLUMN IF NOT EXISTS correct_count integer,
  ADD COLUMN IF NOT EXISTS wrong_count integer,
  ADD COLUMN IF NOT EXISTS unanswered_count integer,
  ADD COLUMN IF NOT EXISTS security_review_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS security_review_note text;

-- Students must be able to log their own integrity/security events during CBT
DROP POLICY IF EXISTS "integrity_student_insert" ON public.integrity_events;
CREATE POLICY "integrity_student_insert" ON public.integrity_events
  FOR INSERT TO authenticated
  WITH CHECK (
    student_id = public.current_student_id()
    AND public.in_school(school_id)
  );

-- Students can update own in-progress attempt answers (already have update policy)
-- Allow reading own integrity events (optional transparency)
DROP POLICY IF EXISTS "integrity_student_select_own" ON public.integrity_events;
CREATE POLICY "integrity_student_select_own" ON public.integrity_events
  FOR SELECT TO authenticated
  USING (
    student_id = public.current_student_id()
    OR public.is_school_teacher(school_id)
    OR public.can_manage_school(school_id)
    OR public.is_super_admin()
  );
