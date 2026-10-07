-- Optional calculator settings on exam_settings (defaults: disabled)
ALTER TABLE public.exam_settings
  ADD COLUMN IF NOT EXISTS allow_calculator boolean NOT NULL DEFAULT false;

ALTER TABLE public.exam_settings
  ADD COLUMN IF NOT EXISTS calculator_type text NOT NULL DEFAULT 'basic';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'exam_settings_calculator_type_check'
  ) THEN
    ALTER TABLE public.exam_settings
      ADD CONSTRAINT exam_settings_calculator_type_check
      CHECK (calculator_type IN ('basic', 'scientific'));
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
