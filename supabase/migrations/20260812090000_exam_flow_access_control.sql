-- D4EXAM Phase: Exam flow, eligibility, integrity, results
-- Aligns with platform roles & access-control document.

-- Extra enums
DO $$ BEGIN
  CREATE TYPE public.exam_status AS ENUM (
    'draft','pending_approval','changes_requested','rejected',
    'approved','scheduled','published','ongoing','closed','completed','archived'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.question_type AS ENUM (
    'mcq','true_false','short_answer','essay','numerical','theory'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.result_visibility AS ENUM (
    'immediate','after_marking','after_exam_closes','after_officer_release'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.attempt_status AS ENUM (
    'not_started','in_progress','submitted','terminated','flagged'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Question options (MCQ / True-False)
CREATE TABLE IF NOT EXISTS public.question_options (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id uuid NOT NULL REFERENCES public.questions(id) ON DELETE CASCADE,
  option_text text NOT NULL,
  is_correct boolean NOT NULL DEFAULT false,
  option_order integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Exam security / delivery settings
CREATE TABLE IF NOT EXISTS public.exam_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  exam_id uuid NOT NULL UNIQUE REFERENCES public.examinations(id) ON DELETE CASCADE,
  fullscreen boolean NOT NULL DEFAULT true,
  tab_monitoring boolean NOT NULL DEFAULT true,
  max_tab_switches integer NOT NULL DEFAULT 5,
  block_copy_paste boolean NOT NULL DEFAULT true,
  randomize_questions boolean NOT NULL DEFAULT true,
  randomize_options boolean NOT NULL DEFAULT true,
  require_camera boolean NOT NULL DEFAULT false,
  require_microphone boolean NOT NULL DEFAULT false,
  threshold_action text NOT NULL DEFAULT 'flag',
  result_visibility public.result_visibility NOT NULL DEFAULT 'after_officer_release',
  instructions text,
  total_marks integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Student exam attempts
CREATE TABLE IF NOT EXISTS public.exam_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  exam_id uuid NOT NULL REFERENCES public.examinations(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  status public.attempt_status NOT NULL DEFAULT 'not_started',
  started_at timestamptz,
  submitted_at timestamptz,
  terminated_at timestamptz,
  tab_switch_count integer NOT NULL DEFAULT 0,
  objective_score numeric,
  subjective_score numeric,
  total_score numeric,
  answers jsonb NOT NULL DEFAULT '{}'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (exam_id, student_id)
);

-- Integrity / cheating events
CREATE TABLE IF NOT EXISTS public.integrity_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  exam_id uuid NOT NULL REFERENCES public.examinations(id) ON DELETE CASCADE,
  attempt_id uuid REFERENCES public.exam_attempts(id) ON DELETE SET NULL,
  student_id uuid REFERENCES public.students(id) ON DELETE SET NULL,
  event_type text NOT NULL,
  severity text NOT NULL DEFAULT 'low',
  description text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Published results (privacy: student sees own only)
CREATE TABLE IF NOT EXISTS public.results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  exam_id uuid NOT NULL REFERENCES public.examinations(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  attempt_id uuid REFERENCES public.exam_attempts(id) ON DELETE SET NULL,
  objective_score numeric,
  subjective_score numeric,
  total_score numeric,
  grade text,
  status text NOT NULL DEFAULT 'pending',
  released_at timestamptz,
  released_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (exam_id, student_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_exam_attempts_exam ON public.exam_attempts(exam_id);
CREATE INDEX IF NOT EXISTS idx_exam_attempts_student ON public.exam_attempts(student_id);
CREATE INDEX IF NOT EXISTS idx_integrity_exam ON public.integrity_events(exam_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_results_student ON public.results(student_id);
CREATE INDEX IF NOT EXISTS idx_results_exam ON public.results(exam_id);
CREATE INDEX IF NOT EXISTS idx_question_options_q ON public.question_options(question_id);

-- updated_at triggers
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['exam_settings','exam_attempts','results'] LOOP
    EXECUTE format(
      'DROP TRIGGER IF EXISTS set_updated_at_%1$s ON public.%1$I; CREATE TRIGGER set_updated_at_%1$s BEFORE UPDATE ON public.%1$I FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()',
      t
    );
  END LOOP;
END $$;

-- Grants + RLS
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['question_options','exam_settings','exam_attempts','integrity_events','results'] LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;

-- Helper: current student row id for auth user
CREATE OR REPLACE FUNCTION public.current_student_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT s.id FROM public.students s
  JOIN public.profiles p ON p.id = s.profile_id
  WHERE p.auth_user_id = auth.uid()
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.current_teacher_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT t.id FROM public.teachers t
  JOIN public.profiles p ON p.id = t.profile_id
  WHERE p.auth_user_id = auth.uid()
  LIMIT 1;
$$;

-- question_options: school teachers / officers
DROP POLICY IF EXISTS "question_options_select" ON public.question_options;
CREATE POLICY "question_options_select" ON public.question_options FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.questions q WHERE q.id = question_id AND public.is_school_teacher(q.school_id)
  ));
DROP POLICY IF EXISTS "question_options_write" ON public.question_options;
CREATE POLICY "question_options_write" ON public.question_options FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.questions q WHERE q.id = question_id AND public.is_school_teacher(q.school_id)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.questions q WHERE q.id = question_id AND public.is_school_teacher(q.school_id)
  ));

-- exam_settings
DROP POLICY IF EXISTS "exam_settings_select" ON public.exam_settings;
CREATE POLICY "exam_settings_select" ON public.exam_settings FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.examinations e WHERE e.id = exam_id AND public.in_school(e.school_id)
  ));
DROP POLICY IF EXISTS "exam_settings_write" ON public.exam_settings;
CREATE POLICY "exam_settings_write" ON public.exam_settings FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.examinations e WHERE e.id = exam_id AND public.is_school_teacher(e.school_id)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.examinations e WHERE e.id = exam_id AND public.is_school_teacher(e.school_id)
  ));

-- exam_attempts: student sees own; teachers/officers/admin in school
DROP POLICY IF EXISTS "exam_attempts_select" ON public.exam_attempts;
CREATE POLICY "exam_attempts_select" ON public.exam_attempts FOR SELECT TO authenticated
  USING (
    public.is_super_admin()
    OR student_id = public.current_student_id()
    OR public.is_school_teacher(school_id)
    OR public.can_manage_school(school_id)
  );
DROP POLICY IF EXISTS "exam_attempts_student_insert" ON public.exam_attempts;
CREATE POLICY "exam_attempts_student_insert" ON public.exam_attempts FOR INSERT TO authenticated
  WITH CHECK (student_id = public.current_student_id() AND public.in_school(school_id));
DROP POLICY IF EXISTS "exam_attempts_student_update" ON public.exam_attempts;
CREATE POLICY "exam_attempts_student_update" ON public.exam_attempts FOR UPDATE TO authenticated
  USING (student_id = public.current_student_id())
  WITH CHECK (student_id = public.current_student_id());
DROP POLICY IF EXISTS "exam_attempts_staff_all" ON public.exam_attempts;
CREATE POLICY "exam_attempts_staff_all" ON public.exam_attempts FOR ALL TO authenticated
  USING (public.is_school_teacher(school_id) OR public.can_manage_school(school_id))
  WITH CHECK (public.is_school_teacher(school_id) OR public.can_manage_school(school_id));

-- integrity_events
DROP POLICY IF EXISTS "integrity_select" ON public.integrity_events;
CREATE POLICY "integrity_select" ON public.integrity_events FOR SELECT TO authenticated
  USING (public.is_school_teacher(school_id) OR public.can_manage_school(school_id) OR public.is_super_admin());
DROP POLICY IF EXISTS "integrity_write" ON public.integrity_events;
CREATE POLICY "integrity_write" ON public.integrity_events FOR ALL TO authenticated
  USING (public.is_school_teacher(school_id) OR public.can_manage_school(school_id))
  WITH CHECK (public.is_school_teacher(school_id) OR public.can_manage_school(school_id));

-- results: student only own published; staff school-scoped
DROP POLICY IF EXISTS "results_student_select" ON public.results;
CREATE POLICY "results_student_select" ON public.results FOR SELECT TO authenticated
  USING (
    (student_id = public.current_student_id() AND status = 'published')
    OR public.is_school_teacher(school_id)
    OR public.can_manage_school(school_id)
    OR public.is_super_admin()
  );
DROP POLICY IF EXISTS "results_staff_write" ON public.results;
CREATE POLICY "results_staff_write" ON public.results FOR ALL TO authenticated
  USING (public.is_school_teacher(school_id) OR public.can_manage_school(school_id))
  WITH CHECK (public.is_school_teacher(school_id) OR public.can_manage_school(school_id));
