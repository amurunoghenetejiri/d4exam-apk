CREATE TABLE IF NOT EXISTS public.attempt_marks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  attempt_id uuid NOT NULL REFERENCES public.exam_attempts(id) ON DELETE CASCADE,
  exam_id uuid NOT NULL REFERENCES public.examinations(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  question_id uuid NOT NULL REFERENCES public.questions(id) ON DELETE CASCADE,
  marks_awarded numeric NOT NULL DEFAULT 0,
  max_marks numeric NOT NULL DEFAULT 0,
  feedback text,
  marked_by uuid,
  marked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (attempt_id, question_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.attempt_marks TO authenticated;
GRANT ALL ON public.attempt_marks TO service_role;

ALTER TABLE public.attempt_marks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "School staff manage attempt marks"
  ON public.attempt_marks FOR ALL TO authenticated
  USING (public.is_school_teacher(school_id))
  WITH CHECK (public.is_school_teacher(school_id));

CREATE POLICY "Students read own attempt marks"
  ON public.attempt_marks FOR SELECT TO authenticated
  USING (student_id = public.current_student_id());

CREATE TRIGGER set_updated_at_attempt_marks
  BEFORE UPDATE ON public.attempt_marks
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX IF NOT EXISTS idx_attempt_marks_attempt ON public.attempt_marks(attempt_id);