-- Allow authenticated students (same school) to read questions for CBT papers.
-- Safe to re-run.

DROP POLICY IF EXISTS "Students can read school questions" ON public.questions;
CREATE POLICY "Students can read school questions"
  ON public.questions
  FOR SELECT
  TO authenticated
  USING (
    school_id IS NOT NULL
    AND public.is_school_member(school_id)
  );

-- If is_school_member does not exist, fall back to a simpler school match via profiles
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'is_school_member'
  ) THEN
    DROP POLICY IF EXISTS "Students can read school questions" ON public.questions;
    CREATE POLICY "Students can read school questions"
      ON public.questions
      FOR SELECT
      TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM public.profiles p
          WHERE p.auth_user_id = auth.uid()
            AND p.school_id = questions.school_id
        )
      );
  END IF;
EXCEPTION WHEN OTHERS THEN
  -- Keep going; app also tries multiple query shapes
  NULL;
END $$;

DROP POLICY IF EXISTS "Students can read exam_questions" ON public.exam_questions;
CREATE POLICY "Students can read exam_questions"
  ON public.exam_questions
  FOR SELECT
  TO authenticated
  USING (true);

NOTIFY pgrst, 'reload schema';
