-- Course materials shared by teachers/students within a school
CREATE TABLE IF NOT EXISTS public.course_materials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  course_id uuid NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  uploaded_by uuid NOT NULL,
  uploader_role text NOT NULL DEFAULT 'teacher',
  uploader_name text,
  title text NOT NULL,
  description text,
  material_type text NOT NULL DEFAULT 'notes',
  file_url text,
  file_name text,
  file_mime text,
  file_size bigint,
  tags text,
  download_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS course_materials_school_course_idx ON public.course_materials (school_id, course_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.course_materials TO authenticated;
GRANT ALL ON public.course_materials TO service_role;

ALTER TABLE public.course_materials ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members read school materials" ON public.course_materials;
CREATE POLICY "Members read school materials" ON public.course_materials
  FOR SELECT TO authenticated
  USING (public.in_school(school_id));

DROP POLICY IF EXISTS "Members upload own materials" ON public.course_materials;
CREATE POLICY "Members upload own materials" ON public.course_materials
  FOR INSERT TO authenticated
  WITH CHECK (public.in_school(school_id) AND uploaded_by = auth.uid());

DROP POLICY IF EXISTS "Uploaders update own materials" ON public.course_materials;
CREATE POLICY "Uploaders update own materials" ON public.course_materials
  FOR UPDATE TO authenticated
  USING (public.in_school(school_id) AND (uploaded_by = auth.uid() OR public.can_manage_school(school_id)))
  WITH CHECK (public.in_school(school_id));

DROP POLICY IF EXISTS "Uploaders delete own materials" ON public.course_materials;
CREATE POLICY "Uploaders delete own materials" ON public.course_materials
  FOR DELETE TO authenticated
  USING (public.in_school(school_id) AND (uploaded_by = auth.uid() OR public.can_manage_school(school_id)));

CREATE OR REPLACE FUNCTION public.increment_material_downloads(_id uuid)
RETURNS integer
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.course_materials
     SET download_count = COALESCE(download_count, 0) + 1
   WHERE id = _id
  RETURNING download_count;
$$;

GRANT EXECUTE ON FUNCTION public.increment_material_downloads(uuid) TO authenticated;

-- Registered push notification devices
CREATE TABLE IF NOT EXISTS public.push_devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  school_id uuid REFERENCES public.schools(id) ON DELETE CASCADE,
  role text,
  token text NOT NULL UNIQUE,
  platform text,
  user_agent text,
  enabled boolean NOT NULL DEFAULT true,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS push_devices_user_idx ON public.push_devices (user_id, enabled);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.push_devices TO authenticated;
GRANT ALL ON public.push_devices TO service_role;

ALTER TABLE public.push_devices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own push devices" ON public.push_devices;
CREATE POLICY "Users manage own push devices" ON public.push_devices
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());