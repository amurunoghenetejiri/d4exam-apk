-- Phase 1+2: proper MCQ options storage + result pipeline support
-- Does NOT delete existing questions, attempts, or results.

-- Structured options on questions (JSON array of {key, text, is_correct})
ALTER TABLE public.questions
  ADD COLUMN IF NOT EXISTS options jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.questions
  ADD COLUMN IF NOT EXISTS correct_answer text;

-- Optional normalized options table (preferred for future)
CREATE TABLE IF NOT EXISTS public.question_options (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id uuid NOT NULL REFERENCES public.questions(id) ON DELETE CASCADE,
  school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  option_key text NOT NULL,
  option_text text NOT NULL,
  is_correct boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (question_id, option_key)
);

CREATE INDEX IF NOT EXISTS idx_question_options_qid ON public.question_options(question_id);

ALTER TABLE public.question_options ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'question_options' AND policyname = 'question_options_select'
  ) THEN
    CREATE POLICY "question_options_select" ON public.question_options
      FOR SELECT TO authenticated USING (public.in_school(school_id));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'question_options' AND policyname = 'question_options_write'
  ) THEN
    CREATE POLICY "question_options_write" ON public.question_options
      FOR ALL TO authenticated
      USING (public.is_school_teacher(school_id))
      WITH CHECK (public.is_school_teacher(school_id));
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.question_options TO authenticated;
GRANT ALL ON public.question_options TO service_role;

-- Migrate OPTIONS:: encoded in explanation → options jsonb
DO $$
DECLARE
  r RECORD;
  line text;
  body text;
  part text;
  k text;
  v text;
  arr jsonb;
  ord int;
BEGIN
  FOR r IN
    SELECT id, school_id, explanation, correct_answer
    FROM public.questions
    WHERE explanation IS NOT NULL AND explanation LIKE '%OPTIONS::%'
      AND (options IS NULL OR options = '[]'::jsonb)
  LOOP
    arr := '[]'::jsonb;
    ord := 0;
    FOR line IN SELECT unnest(string_to_array(r.explanation, E'\n'))
    LOOP
      IF line LIKE 'OPTIONS::%' THEN
        body := substr(line, length('OPTIONS::') + 1);
        FOREACH part IN ARRAY string_to_array(body, '|')
        LOOP
          IF position('=' IN part) > 0 THEN
            k := upper(trim(split_part(part, '=', 1)));
            v := trim(substr(part, position('=' IN part) + 1));
            IF k IN ('A','B','C','D','E','F') AND length(v) > 0 THEN
              ord := ord + 1;
              arr := arr || jsonb_build_array(jsonb_build_object(
                'key', k,
                'text', v,
                'is_correct', (upper(coalesce(r.correct_answer,'')) = k)
              ));
              INSERT INTO public.question_options (question_id, school_id, option_key, option_text, is_correct, sort_order)
              VALUES (r.id, r.school_id, k, v, upper(coalesce(r.correct_answer,'')) = k, ord)
              ON CONFLICT (question_id, option_key) DO UPDATE
                SET option_text = EXCLUDED.option_text,
                    is_correct = EXCLUDED.is_correct,
                    sort_order = EXCLUDED.sort_order;
            END IF;
          END IF;
        END LOOP;
      END IF;
    END LOOP;
    IF arr <> '[]'::jsonb THEN
      UPDATE public.questions SET options = arr WHERE id = r.id;
    END IF;
  END LOOP;
END $$;

-- Exam paper settings on examinations
ALTER TABLE public.examinations
  ADD COLUMN IF NOT EXISTS questions_to_answer integer;
ALTER TABLE public.examinations
  ADD COLUMN IF NOT EXISTS total_marks numeric;
ALTER TABLE public.examinations
  ADD COLUMN IF NOT EXISTS paper_sections jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Results table if missing (idempotent)
CREATE TABLE IF NOT EXISTS public.results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  exam_id uuid NOT NULL REFERENCES public.examinations(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  attempt_id uuid,
  total_score numeric NOT NULL DEFAULT 0,
  max_score numeric,
  percentage numeric,
  grade text,
  pass_fail text,
  correct_count integer DEFAULT 0,
  wrong_count integer DEFAULT 0,
  unanswered_count integer DEFAULT 0,
  status text NOT NULL DEFAULT 'pending',
  security_review_status text DEFAULT 'pending',
  teacher_reviewed_at timestamptz,
  officer_approved_at timestamptz,
  released_at timestamptz,
  feedback text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (exam_id, student_id)
);

CREATE INDEX IF NOT EXISTS idx_results_school ON public.results(school_id);
CREATE INDEX IF NOT EXISTS idx_results_student ON public.results(student_id);

ALTER TABLE public.results ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'results' AND policyname = 'results_select') THEN
    CREATE POLICY "results_select" ON public.results FOR SELECT TO authenticated
      USING (public.in_school(school_id));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'results' AND policyname = 'results_write') THEN
    CREATE POLICY "results_write" ON public.results FOR ALL TO authenticated
      USING (public.is_school_teacher(school_id) OR public.can_manage_school(school_id))
      WITH CHECK (public.is_school_teacher(school_id) OR public.can_manage_school(school_id));
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.results TO authenticated;
GRANT ALL ON public.results TO service_role;

-- Manual marks for subjective answers
CREATE TABLE IF NOT EXISTS public.attempt_marks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  attempt_id uuid NOT NULL,
  exam_id uuid NOT NULL REFERENCES public.examinations(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  question_id uuid NOT NULL REFERENCES public.questions(id) ON DELETE CASCADE,
  marks_awarded numeric NOT NULL DEFAULT 0,
  max_marks numeric NOT NULL DEFAULT 0,
  feedback text,
  marked_by uuid,
  marked_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (attempt_id, question_id)
);

CREATE INDEX IF NOT EXISTS idx_attempt_marks_exam ON public.attempt_marks(exam_id);

ALTER TABLE public.attempt_marks ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'attempt_marks' AND policyname = 'attempt_marks_select') THEN
    CREATE POLICY "attempt_marks_select" ON public.attempt_marks FOR SELECT TO authenticated
      USING (public.in_school(school_id));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'attempt_marks' AND policyname = 'attempt_marks_write') THEN
    CREATE POLICY "attempt_marks_write" ON public.attempt_marks FOR ALL TO authenticated
      USING (public.is_school_teacher(school_id))
      WITH CHECK (public.is_school_teacher(school_id));
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.attempt_marks TO authenticated;
GRANT ALL ON public.attempt_marks TO service_role;
