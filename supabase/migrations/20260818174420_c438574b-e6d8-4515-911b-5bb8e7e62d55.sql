ALTER TABLE public.school_applications
  ADD COLUMN IF NOT EXISTS tracking_code text,
  ADD COLUMN IF NOT EXISTS issued_school_code text,
  ADD COLUMN IF NOT EXISTS issued_admin_email text,
  ADD COLUMN IF NOT EXISTS issued_admin_password text;

CREATE UNIQUE INDEX IF NOT EXISTS school_applications_tracking_code_key
  ON public.school_applications (tracking_code)
  WHERE tracking_code IS NOT NULL;