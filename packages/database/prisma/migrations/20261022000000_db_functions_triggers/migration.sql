-- Funciones y triggers que existían solo en prod (creados a mano).
CREATE OR REPLACE FUNCTION public.update_updated_at()
 RETURNS trigger LANGUAGE plpgsql SET search_path TO ''
AS $function$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$function$;

-- Trigger updated_at en TODAS las tablas de public que tengan esa columna.
DO $$
DECLARE r record; trg text;
BEGIN
  FOR r IN
    SELECT c.table_name FROM information_schema.columns c
    JOIN information_schema.tables t ON t.table_schema=c.table_schema AND t.table_name=c.table_name
    WHERE c.table_schema='public' AND c.column_name='updated_at' AND t.table_type='BASE TABLE'
  LOOP
    trg := CASE WHEN r.table_name='fin_recurring_patterns' THEN 'trg_fin_recurring_updated_at' ELSE 'trg_' || r.table_name || '_updated_at' END;
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', trg, r.table_name);
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.update_updated_at()', trg, r.table_name);
  END LOOP;
END $$;

-- Alta automática en public.users al registrarse en Supabase Auth.
-- Protegido: el shadow DB de Prisma no tiene el esquema auth.
DO $outer$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'auth') THEN
    EXECUTE $f$
      CREATE OR REPLACE FUNCTION public.handle_new_user()
       RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
      AS $function$
      begin
        insert into public.users (id, email, full_name, avatar_url)
        values (
          new.id::text,
          new.email,
          coalesce(
            nullif(new.raw_user_meta_data ->> 'full_name', ''),
            nullif(split_part(new.email, '@', 1), ''),
            ''
          ),
          nullif(new.raw_user_meta_data ->> 'avatar_url', '')
        )
        on conflict (id) do nothing;
        return new;
      end;
      $function$
    $f$;
    DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
    CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
      FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
  END IF;
END $outer$;
