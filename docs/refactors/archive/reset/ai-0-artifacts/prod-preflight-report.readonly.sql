-- Supabase SQL Editor: ejecutar en el proyecto PROD identificado.
-- Solo SELECT de metadatos: no contiene credenciales ni datos de usuarios.
-- Exportar la columna preflight como JSON y guardar fuera del repo en
-- C:/dev/personal/personal-os/.tmp/prod-preflight.json
SELECT jsonb_build_object(
  'capturedAt', clock_timestamp(),
  'database', current_database(),
  'role', current_user,
  'serverVersion', current_setting('server_version'),
  'migrations', (SELECT jsonb_agg(row_to_json(r) ORDER BY r.migration_name)
    FROM (SELECT migration_name,checksum,started_at,finished_at,rolled_back_at,
      applied_steps_count,(logs IS NOT NULL) AS has_logs FROM public._prisma_migrations) r),
  'extensions', (SELECT jsonb_agg(row_to_json(r) ORDER BY r.name)
    FROM (SELECT e.extname AS name,e.extversion AS version,n.nspname AS schema
      FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace) r),
  'tables', (SELECT jsonb_agg(row_to_json(r) ORDER BY r.name)
    FROM (SELECT c.relname AS name,c.relrowsecurity AS rls
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relkind='r') r),
  'checks', (SELECT jsonb_agg(row_to_json(r) ORDER BY r.table_name,r.name)
    FROM (SELECT c.relname AS table_name,con.conname AS name,pg_get_constraintdef(con.oid) AS definition
      FROM pg_constraint con JOIN pg_class c ON c.oid=con.conrelid
      JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND con.contype='c') r),
  'indexes', (SELECT jsonb_agg(row_to_json(r) ORDER BY r.tablename,r.indexname)
    FROM (SELECT tablename,indexname,indexdef FROM pg_indexes WHERE schemaname='public') r),
  'policies', (SELECT jsonb_agg(row_to_json(r) ORDER BY r.tablename,r.policyname)
    FROM (SELECT schemaname,tablename,policyname,roles,cmd,qual,with_check
      FROM pg_policies WHERE schemaname='public') r),
  'grants', (SELECT jsonb_agg(row_to_json(r) ORDER BY r.grantee,r.table_name,r.privilege_type)
    FROM (SELECT grantee,table_name,privilege_type FROM information_schema.table_privileges
      WHERE table_schema='public' AND grantee IN ('anon','authenticated')) r),
  'functions', (SELECT jsonb_agg(row_to_json(r) ORDER BY r.schema,r.name,r.identity_arguments)
    FROM (SELECT n.nspname AS schema,p.proname AS name,p.prosecdef AS security_definer,
      pg_get_function_identity_arguments(p.oid) AS identity_arguments,p.proconfig,
      CASE WHEN p.proname IN ('handle_new_user','update_updated_at','rls_auto_enable')
        THEN pg_get_functiondef(p.oid) ELSE NULL END AS reviewed_definition
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname IN ('public','app_private') AND p.prokind='f') r),
  'triggers', (SELECT jsonb_agg(row_to_json(r) ORDER BY r.schema,r.table_name,r.name)
    FROM (SELECT n.nspname AS schema,c.relname AS table_name,t.tgname AS name,
      pg_get_triggerdef(t.oid) AS definition FROM pg_trigger t
      JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE NOT t.tgisinternal AND (n.nspname='public' OR t.tgrelid=to_regclass('auth.users'))) r),
  'eventTriggers', (SELECT jsonb_agg(row_to_json(r) ORDER BY r.evtname)
    FROM (SELECT evtname,evtevent,evtenabled,evtfoid::regprocedure::text AS function_name,evttags
      FROM pg_event_trigger) r)
) AS preflight;
