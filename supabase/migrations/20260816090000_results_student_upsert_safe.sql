-- Ensure students can save CBT results; officers can release
ALTER TABLE public.results
  ADD COLUMN IF NOT EXISTS released_by uuid;

ALTER TABLE public.results
  ADD COLUMN IF NOT EXISTS max_score numeric;

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

DROP POLICY IF EXISTS "results_officer_manage" ON public.results;
CREATE POLICY "results_officer_manage" ON public.results
  FOR UPDATE TO authenticated
  USING (public.can_manage_school(school_id) OR public.is_school_teacher(school_id))
  WITH CHECK (public.can_manage_school(school_id) OR public.is_school_teacher(school_id));
