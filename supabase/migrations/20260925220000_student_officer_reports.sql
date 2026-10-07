-- Student ↔ Departmental Officer exam reports / messages
-- students use profile_id (not user_id); profiles use auth_user_id

CREATE TABLE IF NOT EXISTS public.student_officer_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  student_id uuid,
  student_user_id uuid,
  student_name text,
  student_matric text,
  exam_id uuid,
  exam_title text,
  exam_ids uuid[] DEFAULT '{}',
  exam_titles text[] DEFAULT '{}',
  subject text,
  body text NOT NULL,
  status text NOT NULL DEFAULT 'open',
  officer_user_id uuid,
  officer_reply text,
  replied_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Add columns if table already exists without them
ALTER TABLE public.student_officer_reports ADD COLUMN IF NOT EXISTS exam_ids uuid[] DEFAULT '{}';
ALTER TABLE public.student_officer_reports ADD COLUMN IF NOT EXISTS exam_titles text[] DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_sor_school_created
  ON public.student_officer_reports (school_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sor_student
  ON public.student_officer_reports (student_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sor_user
  ON public.student_officer_reports (student_user_id, created_at DESC);

ALTER TABLE public.student_officer_reports ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE ON public.student_officer_reports TO authenticated;
GRANT ALL ON public.student_officer_reports TO service_role;

DROP POLICY IF EXISTS "sor_student_select" ON public.student_officer_reports;
DROP POLICY IF EXISTS "sor_student_insert" ON public.student_officer_reports;
DROP POLICY IF EXISTS "sor_officer_select" ON public.student_officer_reports;
DROP POLICY IF EXISTS "sor_officer_update" ON public.student_officer_reports;

-- Student can read own rows (by auth uid or via students.profile_id → profiles.auth_user_id)
CREATE POLICY "sor_student_select" ON public.student_officer_reports
  FOR SELECT TO authenticated
  USING (
    student_user_id = auth.uid()
    OR student_id IN (
      SELECT s.id
      FROM public.students s
      INNER JOIN public.profiles p ON p.id = s.profile_id
      WHERE p.auth_user_id = auth.uid()
    )
  );

CREATE POLICY "sor_student_insert" ON public.student_officer_reports
  FOR INSERT TO authenticated
  WITH CHECK (
    student_user_id = auth.uid()
    OR student_id IN (
      SELECT s.id
      FROM public.students s
      INNER JOIN public.profiles p ON p.id = s.profile_id
      WHERE p.auth_user_id = auth.uid()
    )
  );

-- Officers / school staff: same school via profiles.school_id
CREATE POLICY "sor_officer_select" ON public.student_officer_reports
  FOR SELECT TO authenticated
  USING (
    school_id IN (
      SELECT p.school_id FROM public.profiles p
      WHERE p.auth_user_id = auth.uid() AND p.school_id IS NOT NULL
    )
  );

CREATE POLICY "sor_officer_update" ON public.student_officer_reports
  FOR UPDATE TO authenticated
  USING (
    school_id IN (
      SELECT p.school_id FROM public.profiles p
      WHERE p.auth_user_id = auth.uid() AND p.school_id IS NOT NULL
    )
  );
