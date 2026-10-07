-- Fixes: Could not find the 'semester_id' column of 'courses' in the schema cache
-- Safe to re-run on any Supabase project

ALTER TABLE public.courses
  ADD COLUMN IF NOT EXISTS semester_id uuid REFERENCES public.semesters(id) ON DELETE SET NULL;

ALTER TABLE public.course_offerings
  ADD COLUMN IF NOT EXISTS semester_id uuid REFERENCES public.semesters(id) ON DELETE SET NULL;

ALTER TABLE public.courses
  ADD COLUMN IF NOT EXISTS level_id uuid REFERENCES public.levels(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_courses_semester ON public.courses(semester_id);
CREATE INDEX IF NOT EXISTS idx_course_offerings_semester ON public.course_offerings(semester_id);

NOTIFY pgrst, 'reload schema';
