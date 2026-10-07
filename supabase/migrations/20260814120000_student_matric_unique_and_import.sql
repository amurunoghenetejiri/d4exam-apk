-- Enforce one permanent student profile per school + matric number.
-- Existing exam attempts, results, and history are preserved (no DELETE).

-- Normalize empty matric to NULL so unique index can allow multiple nulls if needed
UPDATE public.students
SET matric_number = NULLIF(trim(matric_number), '')
WHERE matric_number IS NOT NULL AND trim(matric_number) = '';

-- Ensure full_name exists (from earlier migration)
ALTER TABLE public.students
  ADD COLUMN IF NOT EXISTS full_name text;

-- Unique student identity within a school: school_id + matric_number
-- Only applies when matric_number is present
CREATE UNIQUE INDEX IF NOT EXISTS idx_students_school_matric_unique
  ON public.students (school_id, lower(trim(matric_number)))
  WHERE matric_number IS NOT NULL AND length(trim(matric_number)) > 0;

-- Also keep student_id unique (already UNIQUE (school_id, student_id) from base schema)
-- Index for name sorting
CREATE INDEX IF NOT EXISTS idx_students_school_full_name
  ON public.students (school_id, full_name);

COMMENT ON INDEX public.idx_students_school_matric_unique IS
  'One student profile per matric within a school. Re-import must UPDATE not INSERT.';
