-- DEV-only after an approved reset: Auth users survive outside public.
-- Recreate missing app profiles without changing existing profiles or Auth.
DO $outer$
BEGIN
  IF to_regclass('auth.users') IS NOT NULL THEN
    EXECUTE $sql$
      INSERT INTO public.users (id,email,full_name,avatar_url)
      SELECT id::text,email,
        coalesce(nullif(raw_user_meta_data ->> 'full_name',''), nullif(split_part(email,'@',1),''),''),
        nullif(raw_user_meta_data ->> 'avatar_url','')
      FROM auth.users WHERE email IS NOT NULL
      ON CONFLICT (id) DO NOTHING
    $sql$;
  END IF;
END $outer$;
