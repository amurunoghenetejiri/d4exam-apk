-- Question Bank enrichment (no AI)

ALTER TABLE public.questions
  ADD COLUMN IF NOT EXISTS explanation text,
  ADD COLUMN IF NOT EXISTS correct_answer text;

-- Status values used by app: draft | ready_for_review | approved | rejected | archived | active
-- Keep as text for flexibility with existing rows

CREATE INDEX IF NOT EXISTS idx_questions_course ON public.questions(course_id);
CREATE INDEX IF NOT EXISTS idx_questions_status ON public.questions(school_id, status);
CREATE INDEX IF NOT EXISTS idx_questions_created_by ON public.questions(created_by);

COMMENT ON COLUMN public.questions.explanation IS 'Optional explanation shown after marking / review';
COMMENT ON COLUMN public.questions.correct_answer IS 'Correct answer text for short_answer / numerical / essay key';
