-- Map departmental officers to a department (school admin)
ALTER TABLE public.examination_officers
  ADD COLUMN IF NOT EXISTS department_id uuid REFERENCES public.departments(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS examination_officers_department_id_idx
  ON public.examination_officers (department_id);

COMMENT ON COLUMN public.examination_officers.department_id IS
  'Department this officer is mapped to by school admin';
