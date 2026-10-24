-- Design artifact: only apply to a new, explicitly selected empty database.
CREATE SCHEMA IF NOT EXISTS public;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA public;
