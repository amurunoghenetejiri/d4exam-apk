-- Enable realtime for integrity_events so students receive officer warnings in-exam
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'integrity_events'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.integrity_events;
  END IF;
END $$;
