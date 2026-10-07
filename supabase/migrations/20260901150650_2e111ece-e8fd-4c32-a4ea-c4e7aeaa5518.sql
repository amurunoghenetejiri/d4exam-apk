REVOKE ALL ON FUNCTION public.increment_material_downloads(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.increment_material_downloads(uuid) TO authenticated, service_role;