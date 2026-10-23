-- Cierra la API de datos de Supabase (PostgREST) al cliente. Toda la lectura y
-- escritura de `public` pasa por el back con el rol `postgres`, así que `anon`
-- y `authenticated` no necesitan ningún privilegio sobre ese esquema.
-- Protegido: el shadow DB de Prisma no tiene los roles ni los esquemas de Supabase.
DO $outer$
DECLARE
  r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM %I', r);
      EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM %I', r);
      EXECUTE format('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM %I', r);
      EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM %I', r);
      EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM %I', r);
      EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM %I', r);
    END IF;
  END LOOP;
END $outer$;

-- Las funciones SECURITY DEFINER no deben poder invocarse por RPC desde el cliente.
DO $outer$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
             WHERE n.nspname = 'public' AND p.proname = 'handle_new_user')
     AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
             WHERE n.nspname = 'public' AND p.proname = 'rls_auto_enable')
     AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM PUBLIC, anon, authenticated;
  END IF;
END $outer$;

-- Bucket de logos: el back acepta logos de hasta 1 MB y solo estos formatos.
DO $outer$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'storage' AND table_name = 'buckets') THEN
    UPDATE storage.buckets
    SET file_size_limit = 1048576,
        allowed_mime_types = ARRAY['image/png', 'image/svg+xml', 'image/webp', 'image/jpeg']
    WHERE id = 'logos';
  END IF;
END $outer$;
