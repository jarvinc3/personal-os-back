-- Created on 2026-10-24. Keep the timestamp after the AI-0 baseline already
-- applied in DEV; never edit that applied migration.

CREATE SCHEMA IF NOT EXISTS app_private;
REVOKE ALL ON SCHEMA app_private FROM PUBLIC;

CREATE OR REPLACE FUNCTION app_private.handle_deleted_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
BEGIN
  DELETE FROM public.users WHERE id = OLD.id::text;
  RETURN OLD;
END;
$$;

REVOKE ALL ON FUNCTION app_private.handle_deleted_user() FROM PUBLIC;

DO $$
DECLARE
  r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format(
        'REVOKE ALL ON FUNCTION app_private.handle_deleted_user() FROM %I',
        r
      );
    END IF;
  END LOOP;
END;
$$;

DO $$
BEGIN
  IF to_regclass('auth.users') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS on_auth_user_deleted ON auth.users;
    CREATE TRIGGER on_auth_user_deleted
      AFTER DELETE ON auth.users
      FOR EACH ROW
      EXECUTE FUNCTION app_private.handle_deleted_user();
  END IF;
END;
$$;
