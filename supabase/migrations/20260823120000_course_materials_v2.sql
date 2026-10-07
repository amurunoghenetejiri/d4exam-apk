-- Materials v2: downloads, tags, update policy, increment RPC

ALTER TABLE public.course_materials ADD COLUMN IF NOT EXISTS download_count integer NOT NULL DEFAULT 0;
ALTER TABLE public.course_materials ADD COLUMN IF NOT EXISTS tags text;
ALTER TABLE public.course_materials ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

DROP POLICY IF EXISTS "course_materials_update" ON public.course_materials;
CREATE POLICY "course_materials_update"
  ON public.course_materials FOR UPDATE TO authenticated
  USING (
    uploaded_by = auth.uid()
    OR public.is_super_admin()
    OR school_id IN (SELECT school_id FROM public.profiles WHERE auth_user_id = auth.uid())
  )
  WITH CHECK (
    uploaded_by = auth.uid()
    OR public.is_super_admin()
    OR school_id IN (SELECT school_id FROM public.profiles WHERE auth_user_id = auth.uid())
  );

CREATE OR REPLACE FUNCTION public.increment_material_downloads(_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS '
DECLARE
  new_count integer;
BEGIN
  UPDATE public.course_materials
  SET download_count = coalesce(download_count, 0) + 1,
      updated_at = now()
  WHERE id = _id
  RETURNING download_count INTO new_count;
  RETURN coalesce(new_count, 0);
END;
';

GRANT EXECUTE ON FUNCTION public.increment_material_downloads(uuid) TO authenticated;
