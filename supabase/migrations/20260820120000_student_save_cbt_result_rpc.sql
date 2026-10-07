-- Student CBT submit: RLS policies so students can insert/update/select own results
ALTER TABLE public.results ADD COLUMN IF NOT EXISTS attempt_id uuid;
ALTER TABLE public.results ADD COLUMN IF NOT EXISTS objective_score numeric;
ALTER TABLE public.results ADD COLUMN IF NOT EXISTS total_score numeric;
ALTER TABLE public.results ADD COLUMN IF NOT EXISTS max_score numeric;
ALTER TABLE public.results ADD COLUMN IF NOT EXISTS percentage numeric;
ALTER TABLE public.results ADD COLUMN IF NOT EXISTS grade text;
ALTER TABLE public.results ADD COLUMN IF NOT EXISTS pass_fail text;
ALTER TABLE public.results ADD COLUMN IF NOT EXISTS correct_count integer DEFAULT 0;
ALTER TABLE public.results ADD COLUMN IF NOT EXISTS wrong_count integer DEFAULT 0;
ALTER TABLE public.results ADD COLUMN IF NOT EXISTS unanswered_count integer DEFAULT 0;
ALTER TABLE public.results ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pending';
ALTER TABLE public.results ADD COLUMN IF NOT EXISTS security_review_status text DEFAULT 'pending';
ALTER TABLE public.results ADD COLUMN IF NOT EXISTS released_at timestamptz;
ALTER TABLE public.results ADD COLUMN IF NOT EXISTS released_by uuid;
ALTER TABLE public.results ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

DROP POLICY IF EXISTS "results_student_select" ON public.results;
CREATE POLICY "results_student_select" ON public.results
  FOR SELECT TO authenticated
  USING (
    student_id = public.current_student_id()
    OR public.is_school_teacher(school_id)
    OR public.can_manage_school(school_id)
    OR public.is_super_admin()
  );

DROP POLICY IF EXISTS "results_student_insert" ON public.results;
CREATE POLICY "results_student_insert" ON public.results
  FOR INSERT TO authenticated
  WITH CHECK (
    student_id = public.current_student_id()
    AND public.in_school(school_id)
  );

DROP POLICY IF EXISTS "results_student_update" ON public.results;
CREATE POLICY "results_student_update" ON public.results
  FOR UPDATE TO authenticated
  USING (student_id = public.current_student_id())
  WITH CHECK (student_id = public.current_student_id());

DROP POLICY IF EXISTS "exam_attempts_student_update" ON public.exam_attempts;
CREATE POLICY "exam_attempts_student_update" ON public.exam_attempts
  FOR UPDATE TO authenticated
  USING (student_id = public.current_student_id())
  WITH CHECK (student_id = public.current_student_id());

GRANT SELECT, INSERT, UPDATE ON public.results TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.exam_attempts TO authenticated;
