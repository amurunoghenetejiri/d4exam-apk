-- Carryover students: higher-level student retaking a lower-level course
CREATE TABLE IF NOT EXISTS public.course_carryovers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  course_id uuid NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  original_level_id uuid NULL REFERENCES public.levels(id) ON DELETE SET NULL,
  reason text NULL,
  status text NOT NULL DEFAULT 'active',
  created_by uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (school_id, student_id, course_id)
);

CREATE INDEX IF NOT EXISTS course_carryovers_school_idx ON public.course_carryovers (school_id);
CREATE INDEX IF NOT EXISTS course_carryovers_course_idx ON public.course_carryovers (course_id);
CREATE INDEX IF NOT EXISTS course_carryovers_student_idx ON public.course_carryovers (student_id);

ALTER TABLE public.course_carryovers ENABLE ROW LEVEL SECURITY;

-- Staff in same school can manage; students can read own
DROP POLICY IF EXISTS course_carryovers_select_school ON public.course_carryovers;
CREATE POLICY course_carryovers_select_school ON public.course_carryovers
  FOR SELECT TO authenticated
  USING (
    school_id IN (
      SELECT school_id FROM public.user_roles WHERE user_id = auth.uid()
      UNION
      SELECT school_id FROM public.profiles WHERE auth_user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS course_carryovers_write_staff ON public.course_carryovers;
CREATE POLICY course_carryovers_write_staff ON public.course_carryovers
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.school_id = course_carryovers.school_id
        AND ur.role IN ('school_admin', 'examination_officer', 'super_admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.school_id = course_carryovers.school_id
        AND ur.role IN ('school_admin', 'examination_officer', 'super_admin')
    )
  );

COMMENT ON TABLE public.course_carryovers IS
  'Approved carryover: student in higher level may retake this course exam';
