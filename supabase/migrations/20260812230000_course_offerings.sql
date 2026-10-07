-- Shared courses: one course (school_id + code) can be offered by many departments/levels
CREATE TABLE IF NOT EXISTS public.course_offerings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  course_id uuid NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  department_id uuid NOT NULL REFERENCES public.departments(id) ON DELETE CASCADE,
  level_id uuid NOT NULL REFERENCES public.levels(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (course_id, department_id, level_id)
);

CREATE INDEX IF NOT EXISTS idx_course_offerings_dept_level
  ON public.course_offerings (school_id, department_id, level_id);

CREATE INDEX IF NOT EXISTS idx_course_offerings_course
  ON public.course_offerings (course_id);

ALTER TABLE public.course_offerings ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.course_offerings TO authenticated;
GRANT ALL ON public.course_offerings TO service_role;

DROP POLICY IF EXISTS "course_offerings_select" ON public.course_offerings;
CREATE POLICY "course_offerings_select" ON public.course_offerings
  FOR SELECT TO authenticated USING (public.in_school(school_id));

DROP POLICY IF EXISTS "course_offerings_write" ON public.course_offerings;
CREATE POLICY "course_offerings_write" ON public.course_offerings
  FOR ALL TO authenticated
  USING (public.can_manage_school(school_id))
  WITH CHECK (public.can_manage_school(school_id));

-- Backfill: existing courses that already have department + level become offerings
INSERT INTO public.course_offerings (school_id, course_id, department_id, level_id, status)
SELECT c.school_id, c.id, c.department_id, c.level_id, coalesce(c.status, 'active')
FROM public.courses c
WHERE c.department_id IS NOT NULL
  AND c.level_id IS NOT NULL
ON CONFLICT (course_id, department_id, level_id) DO NOTHING;
