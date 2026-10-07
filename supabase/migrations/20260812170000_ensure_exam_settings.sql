-- Run this in Supabase SQL Editor if exam_settings is missing.
-- Fixes: Could not find the table 'public.exam_settings' in the schema cache

CREATE TABLE IF NOT EXISTS public.exam_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  exam_id uuid NOT NULL UNIQUE REFERENCES public.examinations(id) ON DELETE CASCADE,
  fullscreen boolean NOT NULL DEFAULT true,
  tab_monitoring boolean NOT NULL DEFAULT true,
  max_tab_switches integer NOT NULL DEFAULT 5,
  block_copy_paste boolean NOT NULL DEFAULT true,
  randomize_questions boolean NOT NULL DEFAULT true,
  randomize_options boolean NOT NULL DEFAULT true,
  require_camera boolean NOT NULL DEFAULT false,
  require_microphone boolean NOT NULL DEFAULT false,
  threshold_action text NOT NULL DEFAULT 'flag',
  result_visibility text NOT NULL DEFAULT 'after_officer_release',
  instructions text,
  total_marks integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_exam_settings_exam ON public.exam_settings(exam_id);

ALTER TABLE public.exam_settings ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.exam_settings TO authenticated;
GRANT ALL ON public.exam_settings TO service_role;

DROP POLICY IF EXISTS "exam_settings_select" ON public.exam_settings;
CREATE POLICY "exam_settings_select" ON public.exam_settings FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.examinations e WHERE e.id = exam_id AND public.in_school(e.school_id)
  ));

DROP POLICY IF EXISTS "exam_settings_write" ON public.exam_settings;
CREATE POLICY "exam_settings_write" ON public.exam_settings FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.examinations e WHERE e.id = exam_id AND (
      public.is_school_teacher(e.school_id) OR public.can_manage_school(e.school_id)
    )
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.examinations e WHERE e.id = exam_id AND (
      public.is_school_teacher(e.school_id) OR public.can_manage_school(e.school_id)
    )
  ));

-- Refresh PostgREST schema cache
NOTIFY pgrst, 'reload schema';
