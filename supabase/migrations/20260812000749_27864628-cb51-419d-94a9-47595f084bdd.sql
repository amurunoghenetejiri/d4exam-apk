
-- ENUMS
CREATE TYPE public.app_role AS ENUM ('student','teacher','school_admin','examination_officer','super_admin');
CREATE TYPE public.account_status AS ENUM ('pending','invited','active','suspended','deactivated','locked');
CREATE TYPE public.application_status AS ENUM ('pending','under_review','approved','rejected','more_information_required');

CREATE OR REPLACE FUNCTION public.set_updated_at() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

-- CORE TABLES
CREATE TABLE public.schools (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  school_code text NOT NULL UNIQUE,
  school_type text,
  country text, state text, city text, address text,
  official_email text, official_phone text, website text, logo_url text,
  status text NOT NULL DEFAULT 'active',
  subscription_plan text NOT NULL DEFAULT 'starter',
  subscription_status text NOT NULL DEFAULT 'trial',
  approved_at timestamptz, approved_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.school_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_name text NOT NULL, school_type text,
  country text, state text, city text, address text,
  official_email text NOT NULL, official_phone text,
  applicant_name text NOT NULL, applicant_email text NOT NULL, applicant_phone text,
  documents jsonb NOT NULL DEFAULT '[]'::jsonb,
  status public.application_status NOT NULL DEFAULT 'pending',
  review_notes text, reviewed_by uuid, reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id uuid NOT NULL UNIQUE,
  school_id uuid REFERENCES public.schools(id) ON DELETE CASCADE,
  first_name text, middle_name text, last_name text,
  full_name text NOT NULL DEFAULT '',
  email text NOT NULL, phone text, profile_photo_url text,
  status public.account_status NOT NULL DEFAULT 'invited',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  school_id uuid REFERENCES public.schools(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role, school_id)
);

CREATE TABLE public.faculties (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  name text NOT NULL, code text, description text,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (school_id, name)
);

CREATE TABLE public.departments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  faculty_id uuid REFERENCES public.faculties(id) ON DELETE SET NULL,
  name text NOT NULL, code text, description text,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (school_id, name)
);

CREATE TABLE public.levels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  name text NOT NULL, code text, description text,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (school_id, name)
);

CREATE TABLE public.academic_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  name text NOT NULL, start_date date, end_date date,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (school_id, name)
);

CREATE TABLE public.semesters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  academic_session_id uuid REFERENCES public.academic_sessions(id) ON DELETE CASCADE,
  name text NOT NULL, start_date date, end_date date,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.courses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  department_id uuid REFERENCES public.departments(id) ON DELETE SET NULL,
  level_id uuid REFERENCES public.levels(id) ON DELETE SET NULL,
  code text NOT NULL, name text NOT NULL, description text,
  credit_units integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (school_id, code)
);

CREATE TABLE public.students (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  student_id text NOT NULL,
  matric_number text,
  faculty_id uuid REFERENCES public.faculties(id) ON DELETE SET NULL,
  department_id uuid REFERENCES public.departments(id) ON DELETE SET NULL,
  level_id uuid REFERENCES public.levels(id) ON DELETE SET NULL,
  academic_session_id uuid REFERENCES public.academic_sessions(id) ON DELETE SET NULL,
  admission_number text, profile_photo_url text,
  status public.account_status NOT NULL DEFAULT 'invited',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (school_id, student_id)
);

CREATE TABLE public.teachers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  staff_id text NOT NULL,
  faculty_id uuid REFERENCES public.faculties(id) ON DELETE SET NULL,
  department_id uuid REFERENCES public.departments(id) ON DELETE SET NULL,
  employment_status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (school_id, staff_id)
);

CREATE TABLE public.examination_officers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  officer_id text NOT NULL,
  status public.account_status NOT NULL DEFAULT 'invited',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (school_id, officer_id)
);

CREATE TABLE public.teacher_courses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  teacher_id uuid NOT NULL REFERENCES public.teachers(id) ON DELETE CASCADE,
  course_id uuid NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  academic_session_id uuid REFERENCES public.academic_sessions(id) ON DELETE SET NULL,
  semester_id uuid REFERENCES public.semesters(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (teacher_id, course_id, academic_session_id, semester_id)
);

CREATE TABLE public.student_courses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  course_id uuid NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  academic_session_id uuid REFERENCES public.academic_sessions(id) ON DELETE SET NULL,
  semester_id uuid REFERENCES public.semesters(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'enrolled',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (student_id, course_id, academic_session_id, semester_id)
);

CREATE TABLE public.examinations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  course_id uuid REFERENCES public.courses(id) ON DELETE SET NULL,
  created_by uuid,
  title text NOT NULL, description text,
  status text NOT NULL DEFAULT 'draft',
  duration_minutes integer NOT NULL DEFAULT 60,
  scheduled_start timestamptz, scheduled_end timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  course_id uuid REFERENCES public.courses(id) ON DELETE SET NULL,
  created_by uuid,
  question_text text NOT NULL,
  question_type text NOT NULL DEFAULT 'mcq',
  marks integer NOT NULL DEFAULT 1,
  difficulty text NOT NULL DEFAULT 'easy',
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.exam_questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  exam_id uuid NOT NULL REFERENCES public.examinations(id) ON DELETE CASCADE,
  question_id uuid NOT NULL REFERENCES public.questions(id) ON DELETE CASCADE,
  question_order integer NOT NULL DEFAULT 1,
  marks integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (exam_id, question_id)
);

CREATE TABLE public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_user_id uuid NOT NULL,
  school_id uuid REFERENCES public.schools(id) ON DELETE CASCADE,
  title text NOT NULL, message text NOT NULL,
  type text NOT NULL DEFAULT 'info',
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid REFERENCES public.schools(id) ON DELETE CASCADE,
  actor_user_id uuid, actor_role text,
  action text NOT NULL, entity_type text, entity_id uuid,
  description text, metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  ip_address text, user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- INDEXES
CREATE INDEX idx_profiles_school ON public.profiles(school_id);
CREATE INDEX idx_user_roles_user ON public.user_roles(user_id);
CREATE INDEX idx_students_school ON public.students(school_id);
CREATE INDEX idx_teachers_school ON public.teachers(school_id);
CREATE INDEX idx_courses_school ON public.courses(school_id);
CREATE INDEX idx_examinations_school ON public.examinations(school_id);
CREATE INDEX idx_questions_school ON public.questions(school_id);
CREATE INDEX idx_notifications_recipient ON public.notifications(recipient_user_id, created_at DESC);
CREATE INDEX idx_audit_school ON public.audit_logs(school_id, created_at DESC);

-- HELPER FUNCTIONS
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role);
$$;

CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.has_role(auth.uid(), 'super_admin');
$$;

CREATE OR REPLACE FUNCTION public.current_school_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT school_id FROM public.profiles WHERE auth_user_id = auth.uid() LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.current_account_active()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE auth_user_id = auth.uid() AND status = 'active');
$$;

CREATE OR REPLACE FUNCTION public.in_school(_school uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_super_admin() OR (_school IS NOT NULL AND _school = public.current_school_id() AND public.current_account_active());
$$;

CREATE OR REPLACE FUNCTION public.can_manage_school(_school uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_super_admin() OR EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = auth.uid() AND ur.role = 'school_admin' AND ur.school_id = _school
  );
$$;

CREATE OR REPLACE FUNCTION public.is_school_teacher(_school uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = auth.uid() AND ur.role IN ('teacher','examination_officer','school_admin') AND ur.school_id = _school
  ) OR public.is_super_admin();
$$;

CREATE OR REPLACE FUNCTION public.generate_school_code(_name text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE base text; candidate text; n int := 0;
BEGIN
  base := upper(regexp_replace(coalesce(_name,'SCH'), '[^a-zA-Z]', '', 'g'));
  base := left(coalesce(nullif(base,''),'SCH'), 4);
  LOOP
    candidate := base || lpad((floor(random()*9999)::int)::text, 4, '0');
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.schools WHERE school_code = candidate);
    n := n + 1;
    IF n > 50 THEN candidate := base || to_char(clock_timestamp(),'SSMS'); EXIT; END IF;
  END LOOP;
  RETURN candidate;
END; $$;

-- TIMESTAMP TRIGGERS
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['schools','school_applications','profiles','faculties','departments','levels','academic_sessions','semesters','courses','students','teachers','examination_officers','examinations','questions'] LOOP
    EXECUTE format('CREATE TRIGGER set_updated_at_%1$s BEFORE UPDATE ON public.%1$I FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()', t);
  END LOOP;
END; $$;

-- GRANTS + RLS
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['schools','school_applications','profiles','user_roles','faculties','departments','levels','academic_sessions','semesters','courses','students','teachers','examination_officers','teacher_courses','student_courses','examinations','questions','exam_questions','notifications','audit_logs'] LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;
END; $$;

-- school-scoped generic policies
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['faculties','departments','levels','academic_sessions','semesters','courses','students','teachers','examination_officers','teacher_courses','student_courses'] LOOP
    EXECUTE format('CREATE POLICY "%1$s_select" ON public.%1$I FOR SELECT TO authenticated USING (public.in_school(school_id))', t);
    EXECUTE format('CREATE POLICY "%1$s_write" ON public.%1$I FOR ALL TO authenticated USING (public.can_manage_school(school_id)) WITH CHECK (public.can_manage_school(school_id))', t);
  END LOOP;
END; $$;

-- schools
CREATE POLICY "schools_select" ON public.schools FOR SELECT TO authenticated
  USING (public.is_super_admin() OR id = public.current_school_id());
CREATE POLICY "schools_admin_update" ON public.schools FOR UPDATE TO authenticated
  USING (public.can_manage_school(id)) WITH CHECK (public.can_manage_school(id));
CREATE POLICY "schools_superadmin_all" ON public.schools FOR ALL TO authenticated
  USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());

-- school applications: public may apply, super admin reviews
GRANT INSERT ON public.school_applications TO anon;
CREATE POLICY "applications_public_insert" ON public.school_applications FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "applications_superadmin_all" ON public.school_applications FOR ALL TO authenticated
  USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());

-- profiles
CREATE POLICY "profiles_self_select" ON public.profiles FOR SELECT TO authenticated
  USING (auth_user_id = auth.uid() OR public.in_school(school_id));
CREATE POLICY "profiles_self_update" ON public.profiles FOR UPDATE TO authenticated
  USING (auth_user_id = auth.uid()) WITH CHECK (auth_user_id = auth.uid());
CREATE POLICY "profiles_admin_all" ON public.profiles FOR ALL TO authenticated
  USING (public.can_manage_school(school_id)) WITH CHECK (public.can_manage_school(school_id));

-- user_roles
CREATE POLICY "user_roles_select" ON public.user_roles FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.can_manage_school(school_id));
CREATE POLICY "user_roles_admin_all" ON public.user_roles FOR ALL TO authenticated
  USING (public.can_manage_school(school_id)) WITH CHECK (public.can_manage_school(school_id));

-- examinations / questions
CREATE POLICY "examinations_select" ON public.examinations FOR SELECT TO authenticated USING (public.in_school(school_id));
CREATE POLICY "examinations_write" ON public.examinations FOR ALL TO authenticated
  USING (public.is_school_teacher(school_id)) WITH CHECK (public.is_school_teacher(school_id));
CREATE POLICY "questions_select" ON public.questions FOR SELECT TO authenticated USING (public.is_school_teacher(school_id));
CREATE POLICY "questions_write" ON public.questions FOR ALL TO authenticated
  USING (public.is_school_teacher(school_id)) WITH CHECK (public.is_school_teacher(school_id));
CREATE POLICY "exam_questions_select" ON public.exam_questions FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.examinations e WHERE e.id = exam_id AND public.in_school(e.school_id)));
CREATE POLICY "exam_questions_write" ON public.exam_questions FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.examinations e WHERE e.id = exam_id AND public.is_school_teacher(e.school_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.examinations e WHERE e.id = exam_id AND public.is_school_teacher(e.school_id)));

-- notifications
CREATE POLICY "notifications_own_select" ON public.notifications FOR SELECT TO authenticated
  USING (recipient_user_id = auth.uid() OR public.can_manage_school(school_id));
CREATE POLICY "notifications_own_update" ON public.notifications FOR UPDATE TO authenticated
  USING (recipient_user_id = auth.uid()) WITH CHECK (recipient_user_id = auth.uid());
CREATE POLICY "notifications_admin_write" ON public.notifications FOR ALL TO authenticated
  USING (public.can_manage_school(school_id)) WITH CHECK (public.can_manage_school(school_id));

-- audit logs (read-only for admins; writes via service role)
CREATE POLICY "audit_select" ON public.audit_logs FOR SELECT TO authenticated
  USING (public.can_manage_school(school_id) OR public.is_super_admin());

-- REALTIME
ALTER TABLE public.notifications REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;

