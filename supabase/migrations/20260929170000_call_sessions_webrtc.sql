-- Call sessions + participants for WebRTC voice/video calling
CREATE TABLE IF NOT EXISTS public.call_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    call_type TEXT NOT NULL CHECK (call_type IN ('voice', 'video')),
    status TEXT NOT NULL DEFAULT 'calling' CHECK (status IN ('calling', 'ringing', 'active', 'ended', 'declined', 'missed', 'failed', 'cancelled')),
    caller_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    conversation_id UUID NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    ended_at TIMESTAMPTZ NULL
);

-- Align with existing fallback insert shape (initiator_id used by client)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'call_sessions' AND column_name = 'initiator_id'
  ) THEN
    ALTER TABLE public.call_sessions ADD COLUMN initiator_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'call_sessions' AND column_name = 'answered_at'
  ) THEN
    ALTER TABLE public.call_sessions ADD COLUMN answered_at TIMESTAMPTZ NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'call_sessions' AND column_name = 'end_reason'
  ) THEN
    ALTER TABLE public.call_sessions ADD COLUMN end_reason TEXT NULL;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.call_participants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    call_id UUID NOT NULL REFERENCES public.call_sessions(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'callee' CHECK (role IN ('caller', 'callee')),
    status TEXT NOT NULL DEFAULT 'invited' CHECK (status IN ('invited', 'ringing', 'joined', 'left', 'declined')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (call_id, user_id)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'call_participants' AND column_name = 'joined_at'
  ) THEN
    ALTER TABLE public.call_participants ADD COLUMN joined_at TIMESTAMPTZ NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'call_participants' AND column_name = 'left_at'
  ) THEN
    ALTER TABLE public.call_participants ADD COLUMN left_at TIMESTAMPTZ NULL;
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE ON public.call_sessions TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.call_participants TO authenticated;
GRANT ALL ON public.call_sessions TO service_role;
GRANT ALL ON public.call_participants TO service_role;

ALTER TABLE public.call_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.call_participants ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow authenticated read/write call_sessions" ON public.call_sessions;
CREATE POLICY "Allow authenticated read/write call_sessions"
    ON public.call_sessions FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow authenticated read/write call_participants" ON public.call_participants;
CREATE POLICY "Allow authenticated read/write call_participants"
    ON public.call_participants FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Enable Realtime publication (ignore if already added)
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.call_participants;
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN undefined_object THEN NULL;
END $$;
