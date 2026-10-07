-- Authoritative columns for face detection & screen share on exam_settings
ALTER TABLE public.exam_settings
  ADD COLUMN IF NOT EXISTS face_detection boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS max_face_warnings integer NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS face_violation_action text NOT NULL DEFAULT 'flag',
  ADD COLUMN IF NOT EXISTS require_screen_share boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS screen_share_mode text NOT NULL DEFAULT 'disabled';

-- Backfill from description JSON where present
DO $$
DECLARE
  r RECORD;
  blob text;
  j jsonb;
BEGIN
  FOR r IN
    SELECT e.id AS exam_id, e.description
    FROM public.examinations e
    WHERE e.description IS NOT NULL
      AND e.description LIKE '%[[D4_SECURITY_JSON]]%'
  LOOP
    BEGIN
      blob := split_part(r.description, '[[D4_SECURITY_JSON]]', 2);
      blob := split_part(blob, '[[D4_EXAM_META]]', 1);
      blob := substring(blob from '\{.*\}');
      IF blob IS NULL OR blob = '' THEN CONTINUE; END IF;
      j := blob::jsonb;
      UPDATE public.exam_settings es SET
        face_detection = COALESCE((j->>'faceDetection')::boolean, es.face_detection),
        max_face_warnings = COALESCE((j->>'maxFaceWarnings')::integer, es.max_face_warnings),
        face_violation_action = COALESCE(j->>'faceViolationAction', es.face_violation_action),
        require_camera = (COALESCE((j->>'requireCamera')::boolean, es.require_camera)
          OR COALESCE((j->>'faceDetection')::boolean, false)),
        require_microphone = COALESCE((j->>'requireMicrophone')::boolean, es.require_microphone),
        require_screen_share = COALESCE((j->>'requireScreenShare')::boolean, es.require_screen_share),
        screen_share_mode = COALESCE(j->>'screenShareMode', es.screen_share_mode),
        fullscreen = COALESCE((j->>'fullscreen')::boolean, es.fullscreen),
        tab_monitoring = COALESCE((j->>'tabMonitoring')::boolean, es.tab_monitoring),
        block_copy_paste = COALESCE((j->>'blockCopyPaste')::boolean, es.block_copy_paste),
        updated_at = now()
      WHERE es.exam_id = r.exam_id;
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END LOOP;
END $$;

-- School members (teachers, officers, admins, students in school) can read
DROP POLICY IF EXISTS "exam_settings_select" ON public.exam_settings;
CREATE POLICY "exam_settings_select" ON public.exam_settings FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.examinations e
    WHERE e.id = exam_id AND public.in_school(e.school_id)
  ));

-- Teachers + school managers write (is_school_teacher includes examination_officer)
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

NOTIFY pgrst, 'reload schema';
