ALTER TABLE public.student_officer_reports ADD COLUMN IF NOT EXISTS officer_read_at timestamptz;
ALTER TABLE public.student_officer_reports ADD COLUMN IF NOT EXISTS student_read_at timestamptz;
ALTER TABLE public.student_officer_reports ADD COLUMN IF NOT EXISTS attachment_url text;
ALTER TABLE public.student_officer_reports ADD COLUMN IF NOT EXISTS attachment_type text;
ALTER TABLE public.student_officer_reports ADD COLUMN IF NOT EXISTS reply_to_id uuid;
