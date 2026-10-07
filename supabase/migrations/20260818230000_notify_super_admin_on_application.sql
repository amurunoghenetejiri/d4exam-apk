-- Live notifications for super admins when a school applies

CREATE OR REPLACE FUNCTION public.notify_super_admins_new_application()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
  v_title text := 'New school application';
  v_msg text;
  v_link text := '/super-admin/applications';
BEGIN
  v_msg := coalesce(NEW.school_name, 'A school')
    || ' submitted an application'
    || CASE WHEN NEW.tracking_code IS NOT NULL AND length(trim(NEW.tracking_code)) > 0
         THEN ' (ref ' || trim(NEW.tracking_code) || ')'
         ELSE '' END
    || '. Open Applications to review.';

  FOR r IN
    SELECT DISTINCT ur.user_id
    FROM public.user_roles ur
    WHERE ur.role = 'super_admin'
      AND ur.user_id IS NOT NULL
  LOOP
    INSERT INTO public.notifications (
      recipient_user_id,
      title,
      message,
      type,
      link,
      entity_type,
      entity_id
    )
    VALUES (
      r.user_id,
      v_title,
      v_msg,
      'info',
      v_link,
      'school_application',
      NEW.id
    );
  END LOOP;

  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    -- Never block application insert
    RAISE WARNING 'notify_super_admins_new_application: %', SQLERRM;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_super_admins_new_application ON public.school_applications;

CREATE TRIGGER trg_notify_super_admins_new_application
  AFTER INSERT ON public.school_applications
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_super_admins_new_application();

-- Ensure notifications table is in realtime publication when possible
DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
  EXCEPTION
    WHEN duplicate_object THEN NULL;
    WHEN undefined_object THEN NULL;
    WHEN OTHERS THEN NULL;
  END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.school_applications;
  EXCEPTION
    WHEN duplicate_object THEN NULL;
    WHEN undefined_object THEN NULL;
    WHEN OTHERS THEN NULL;
  END;
END;
$$;
