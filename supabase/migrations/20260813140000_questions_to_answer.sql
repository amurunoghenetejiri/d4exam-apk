-- Store teacher question count on exam_settings (reliable; not only in description)
ALTER TABLE public.exam_settings
  ADD COLUMN IF NOT EXISTS questions_to_answer integer;
