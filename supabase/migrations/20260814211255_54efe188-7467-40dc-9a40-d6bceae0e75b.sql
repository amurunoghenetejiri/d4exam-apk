-- 1. Semester linkage
ALTER TABLE public.courses ADD COLUMN IF NOT EXISTS semester_id uuid REFERENCES public.semesters(id) ON DELETE SET NULL;
ALTER TABLE public.course_offerings ADD COLUMN IF NOT EXISTS semester_id uuid REFERENCES public.semesters(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_courses_semester ON public.courses(semester_id);
CREATE INDEX IF NOT EXISTS idx_course_offerings_semester ON public.course_offerings(semester_id);

-- 2. Data integrity: unique constraints
CREATE UNIQUE INDEX IF NOT EXISTS uq_courses_school_code ON public.courses(school_id, upper(code));
CREATE UNIQUE INDEX IF NOT EXISTS uq_departments_school_name ON public.departments(school_id, lower(name));
CREATE UNIQUE INDEX IF NOT EXISTS uq_levels_school_name ON public.levels(school_id, lower(name));
CREATE UNIQUE INDEX IF NOT EXISTS uq_semesters_school_session_name ON public.semesters(school_id, coalesce(academic_session_id::text,''), lower(name));
CREATE UNIQUE INDEX IF NOT EXISTS uq_course_offerings_combo ON public.course_offerings(course_id, department_id, level_id, coalesce(semester_id::text,''));
CREATE UNIQUE INDEX IF NOT EXISTS uq_student_courses_combo ON public.student_courses(student_id, course_id, coalesce(semester_id::text,''));

-- 3. Student history (audit of admin changes to a student)
CREATE TABLE IF NOT EXISTS public.student_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  actor_user_id uuid,
  action text NOT NULL,
  description text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.student_history TO authenticated;
GRANT ALL ON public.student_history TO service_role;

ALTER TABLE public.student_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "School staff can read student history"
  ON public.student_history FOR SELECT TO authenticated
  USING (public.is_school_teacher(school_id) OR public.current_student_id() = student_id);

CREATE POLICY "School admins can write student history"
  ON public.student_history FOR INSERT TO authenticated
  WITH CHECK (public.can_manage_school(school_id));

CREATE INDEX IF NOT EXISTS idx_student_history_student ON public.student_history(student_id, created_at DESC);

-- 4. Allow school admins to manage student records and enrolments
DROP POLICY IF EXISTS "School admins manage students" ON public.students;
CREATE POLICY "School admins manage students"
  ON public.students FOR ALL TO authenticated
  USING (public.can_manage_school(school_id))
  WITH CHECK (public.can_manage_school(school_id));

DROP POLICY IF EXISTS "School admins manage student courses" ON public.student_courses;
CREATE POLICY "School admins manage student courses"
  ON public.student_courses FOR ALL TO authenticated
  USING (public.can_manage_school(school_id))
  WITH CHECK (public.can_manage_school(school_id));

DROP POLICY IF EXISTS "School admins manage profiles in school" ON public.profiles;
CREATE POLICY "School admins manage profiles in school"
  ON public.profiles FOR UPDATE TO authenticated
  USING (public.can_manage_school(school_id))
  WITH CHECK (public.can_manage_school(school_id));