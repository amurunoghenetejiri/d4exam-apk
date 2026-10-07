-- Optional explanation / review note on questions (production may already have options jsonb)
ALTER TABLE public.questions
  ADD COLUMN IF NOT EXISTS explanation text;

COMMENT ON COLUMN public.questions.explanation IS 'Optional explanation shown after marking / review';
