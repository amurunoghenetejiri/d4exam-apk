-- Allow examination officers / teachers / school admins to insert their own audit rows
-- (select remains school_admin / super_admin only)

DROP POLICY IF EXISTS "audit_insert_staff" ON public.audit_logs;
CREATE POLICY "audit_insert_staff" ON public.audit_logs
  FOR INSERT TO authenticated
  WITH CHECK (
    actor_user_id = auth.uid()
    AND (
      public.is_school_teacher(school_id)
      OR public.can_manage_school(school_id)
      OR public.is_super_admin()
    )
  );
