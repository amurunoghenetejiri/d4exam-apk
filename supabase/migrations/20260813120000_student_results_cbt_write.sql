-- Allow students to create/update their own result row on CBT submit
-- and to see their own pending results (scores still gated in UI when not published).

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

-- Ensure integrity student insert exists (idempotent)
DROP POLICY IF EXISTS "integrity_student_insert" ON public.integrity_events;
CREATE POLICY "integrity_student_insert" ON public.integrity_events
  FOR INSERT TO authenticated
  WITH CHECK (
    student_id = public.current_student_id()
    AND public.in_school(school_id)
  );
