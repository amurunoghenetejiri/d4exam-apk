-- Performance indexes for common filters (school isolation + lists)

CREATE INDEX IF NOT EXISTS idx_students_school_status ON public.students (school_id, status);
CREATE INDEX IF NOT EXISTS idx_students_matric_lower ON public.students (school_id, lower(matric_number));
CREATE INDEX IF NOT EXISTS idx_students_student_id_lower ON public.students (school_id, lower(student_id));
CREATE INDEX IF NOT EXISTS idx_students_profile ON public.students (profile_id);
CREATE INDEX IF NOT EXISTS idx_students_dept_level ON public.students (school_id, department_id, level_id);

CREATE INDEX IF NOT EXISTS idx_teachers_profile ON public.teachers (profile_id);
CREATE INDEX IF NOT EXISTS idx_teachers_school ON public.teachers (school_id);

CREATE INDEX IF NOT EXISTS idx_courses_school_dept ON public.courses (school_id, department_id);
CREATE INDEX IF NOT EXISTS idx_courses_school_status ON public.courses (school_id, status);

CREATE INDEX IF NOT EXISTS idx_questions_school_course ON public.questions (school_id, course_id, status);
CREATE INDEX IF NOT EXISTS idx_exam_questions_exam ON public.exam_questions (exam_id, question_order);

CREATE INDEX IF NOT EXISTS idx_examinations_school_status ON public.examinations (school_id, status);
CREATE INDEX IF NOT EXISTS idx_examinations_course ON public.examinations (course_id);

CREATE INDEX IF NOT EXISTS idx_profiles_auth ON public.profiles (auth_user_id);
CREATE INDEX IF NOT EXISTS idx_profiles_email ON public.profiles (lower(email));
CREATE INDEX IF NOT EXISTS idx_profiles_school ON public.profiles (school_id);

CREATE INDEX IF NOT EXISTS idx_user_roles_user ON public.user_roles (user_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_school ON public.user_roles (school_id, role);

CREATE INDEX IF NOT EXISTS idx_teacher_courses_teacher ON public.teacher_courses (teacher_id);
CREATE INDEX IF NOT EXISTS idx_teacher_courses_course ON public.teacher_courses (course_id);

-- exam_attempts / results if present
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='exam_attempts') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_exam_attempts_exam_student ON public.exam_attempts (exam_id, student_id)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_exam_attempts_school_status ON public.exam_attempts (school_id, status)';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='results') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_results_exam_student ON public.results (exam_id, student_id)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_results_school_status ON public.results (school_id, status)';
  END IF;
END $$;
