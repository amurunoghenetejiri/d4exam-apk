-- Run in Supabase SQL Editor. Safe to re-run.

CREATE TABLE IF NOT EXISTS public.exam_questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  exam_id uuid NOT NULL REFERENCES public.examinations(id) ON DELETE CASCADE,
  question_id uuid NOT NULL REFERENCES public.questions(id) ON DELETE CASCADE,
  question_order int DEFAULT 1,
  marks numeric DEFAULT 1,
  UNIQUE (exam_id, question_id)
);

ALTER TABLE public.exam_questions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Students can read exam_questions" ON public.exam_questions;
CREATE POLICY "Students can read exam_questions"
  ON public.exam_questions FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Authenticated manage exam_questions" ON public.exam_questions;
CREATE POLICY "Authenticated manage exam_questions"
  ON public.exam_questions FOR ALL TO authenticated USING (true) WITH CHECK (true);

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

DROP POLICY IF EXISTS "Authenticated read questions same school" ON public.questions;
CREATE POLICY "Authenticated read questions same school"
  ON public.questions
  FOR SELECT
  TO authenticated
  USING (true);

CREATE OR REPLACE FUNCTION public.get_cbt_exam_questions(
  p_exam_id uuid,
  p_course_id uuid DEFAULT NULL,
  p_school_id uuid DEFAULT NULL
)
RETURNS SETOF json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_course uuid;
  v_school uuid;
  v_count int;
BEGIN
  SELECT e.course_id, e.school_id INTO v_course, v_school
  FROM public.examinations e
  WHERE e.id = p_exam_id;

  IF v_course IS NULL THEN v_course := p_course_id; END IF;
  IF v_school IS NULL THEN v_school := p_school_id; END IF;

  SELECT COUNT(*) INTO v_count FROM public.exam_questions eq WHERE eq.exam_id = p_exam_id;

  IF v_count > 0 THEN
    RETURN QUERY
    SELECT json_build_object(
      'id', q.id,
      'question_text', q.question_text,
      'question_type', q.question_type,
      'marks', COALESCE(eq.marks, q.marks, 1),
      'correct_answer', q.correct_answer,
      'status', q.status
    )
    FROM public.exam_questions eq
    JOIN public.questions q ON q.id = eq.question_id
    WHERE eq.exam_id = p_exam_id
    ORDER BY eq.question_order NULLS LAST;
    RETURN;
  END IF;

  IF v_course IS NOT NULL THEN
    RETURN QUERY
    SELECT json_build_object(
      'id', q.id,
      'question_text', q.question_text,
      'question_type', q.question_type,
      'marks', COALESCE(q.marks, 1),
      'correct_answer', q.correct_answer,
      'status', q.status
    )
    FROM public.questions q
    WHERE q.course_id = v_course
      AND (v_school IS NULL OR q.school_id IS NULL OR q.school_id = v_school)
    ORDER BY q.created_at
    LIMIT 300;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_cbt_exam_questions(uuid, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_cbt_exam_questions(uuid, uuid, uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.get_cbt_exam_questions(uuid, uuid, uuid) TO service_role;

NOTIFY pgrst, 'reload schema';
