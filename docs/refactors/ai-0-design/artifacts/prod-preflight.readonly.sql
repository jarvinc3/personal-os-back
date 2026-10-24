-- Read-only evidence collection; supply a verified PROD read-only connection.
-- This file is NOT executed by the design validation or against an implicit URL.
BEGIN READ ONLY;
SET LOCAL statement_timeout = '5s';
SET LOCAL lock_timeout = '1s';
SELECT current_database(), current_user, current_setting('server_version') AS server_version;
SELECT migration_name, checksum, started_at, finished_at, rolled_back_at,
       applied_steps_count, (logs IS NOT NULL) AS has_logs
FROM public._prisma_migrations ORDER BY migration_name;
SELECT n.nspname AS schema_name, c.relname AS table_name, c.relrowsecurity
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND c.relkind='r' ORDER BY c.relname;
SELECT e.extname, e.extversion, n.nspname AS schema_name
FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace ORDER BY e.extname;
SELECT n.nspname AS schema_name, p.proname, p.prosecdef AS security_definer, p.proconfig
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname IN ('public','app_private') AND p.proname IN ('handle_new_user','update_updated_at','rls_auto_enable');
SELECT pg_get_triggerdef(t.oid) AS auth_trigger_ddl
FROM pg_trigger t WHERE NOT t.tgisinternal AND t.tgrelid=to_regclass('auth.users');
SELECT schemaname,tablename,policyname,roles,cmd,qual,with_check
FROM pg_policies WHERE schemaname='public' ORDER BY tablename,policyname;
SELECT grantee,table_name,privilege_type FROM information_schema.table_privileges
WHERE table_schema='public' AND grantee IN ('anon','authenticated') ORDER BY grantee,table_name,privilege_type;
SELECT c.relname AS table_name, con.conname, pg_get_constraintdef(con.oid) AS definition
FROM pg_constraint con JOIN pg_class c ON c.oid=con.conrelid
JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND con.contype='c' ORDER BY c.relname,con.conname;
SELECT tablename,indexname,indexdef FROM pg_indexes
WHERE schemaname='public' ORDER BY tablename,indexname;
SELECT n.nspname AS schema_name,c.relname AS table_name,pg_get_triggerdef(t.oid) AS definition
FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND NOT t.tgisinternal ORDER BY c.relname,t.tgname;
SELECT evtname,evtevent,evtenabled,evtfoid::regprocedure AS function_name,evttags
FROM pg_event_trigger ORDER BY evtname;
ROLLBACK;
