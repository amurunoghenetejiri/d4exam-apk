-- Display names for students imported without a full auth profile
ALTER TABLE public.students
  ADD COLUMN IF NOT EXISTS full_name text;

CREATE INDEX IF NOT EXISTS idx_students_full_name ON public.students (school_id, full_name);
