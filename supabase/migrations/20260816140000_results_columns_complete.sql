-- Ensure results has every column used by CBT submit + officer release + student view.
-- Idempotent; does not change existing data or RLS policies.

ALTER TABLE public.results
  ADD COLUMN IF NOT EXISTS attempt_id uuid;

ALTER TABLE public.results
  ADD COLUMN IF NOT EXISTS objective_score numeric;

ALTER TABLE public.results
  ADD COLUMN IF NOT EXISTS subjective_score numeric;

ALTER TABLE public.results
  ADD COLUMN IF NOT EXISTS total_score numeric NOT NULL DEFAULT 0;

ALTER TABLE public.results
  ADD COLUMN IF NOT EXISTS max_score numeric;

ALTER TABLE public.results
  ADD COLUMN IF NOT EXISTS percentage numeric;

ALTER TABLE public.results
  ADD COLUMN IF NOT EXISTS grade text;

ALTER TABLE public.results
  ADD COLUMN IF NOT EXISTS pass_fail text;

ALTER TABLE public.results
  ADD COLUMN IF NOT EXISTS correct_count integer DEFAULT 0;

ALTER TABLE public.results
  ADD COLUMN IF NOT EXISTS wrong_count integer DEFAULT 0;

ALTER TABLE public.results
  ADD COLUMN IF NOT EXISTS unanswered_count integer DEFAULT 0;

ALTER TABLE public.results
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pending';

ALTER TABLE public.results
  ADD COLUMN IF NOT EXISTS security_review_status text DEFAULT 'pending';

ALTER TABLE public.results
  ADD COLUMN IF NOT EXISTS released_at timestamptz;

ALTER TABLE public.results
  ADD COLUMN IF NOT EXISTS released_by uuid;

ALTER TABLE public.results
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_results_exam_status ON public.results (exam_id, status);
CREATE INDEX IF NOT EXISTS idx_results_student_status ON public.results (student_id, status);
