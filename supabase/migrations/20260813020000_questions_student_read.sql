-- Students need to read questions during CBT.
-- Previously only teachers could SELECT from questions, so bank always returned 0 for students.

DROP POLICY IF EXISTS questions_select ON public.questions;

CREATE POLICY questions_select ON public.questions
FOR SELECT TO authenticated
USING (
  public.is_school_teacher(school_id)
  OR (
    public.current_student_id() IS NOT NULL
    AND public.in_school(school_id)
    AND COALESCE(status, 'active') IN ('active', 'approved')
    AND (
      EXISTS (
        SELECT 1 FROM public.examinations e
        WHERE e.school_id = questions.school_id
          AND e.course_id IS NOT DISTINCT FROM questions.course_id
          AND e.status IN ('approved', 'scheduled', 'published', 'ongoing')
      )
      OR EXISTS (
        SELECT 1
        FROM public.exam_questions eq
        JOIN public.examinations e ON e.id = eq.exam_id
        WHERE eq.question_id = questions.id
          AND e.status IN ('approved', 'scheduled', 'published', 'ongoing')
          AND public.in_school(e.school_id)
      )
    )
  )
);
