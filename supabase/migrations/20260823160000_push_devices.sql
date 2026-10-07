CREATE TABLE IF NOT EXISTS public.push_devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token text NOT NULL,
  role text NULL,
  user_agent text NULL,
  enabled boolean NOT NULL DEFAULT true,
  last_seen_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (token)
);

CREATE INDEX IF NOT EXISTS idx_push_devices_user ON public.push_devices (user_id) WHERE enabled = true;

ALTER TABLE public.push_devices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS push_devices_own_select ON public.push_devices;
DROP POLICY IF EXISTS push_devices_own_insert ON public.push_devices;
DROP POLICY IF EXISTS push_devices_own_update ON public.push_devices;
DROP POLICY IF EXISTS push_devices_own_delete ON public.push_devices;

CREATE POLICY push_devices_own_select ON public.push_devices
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY push_devices_own_insert ON public.push_devices
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY push_devices_own_update ON public.push_devices
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY push_devices_own_delete ON public.push_devices
  FOR DELETE TO authenticated
  USING (user_id = auth.uid());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.push_devices TO authenticated;
GRANT ALL ON public.push_devices TO service_role;
