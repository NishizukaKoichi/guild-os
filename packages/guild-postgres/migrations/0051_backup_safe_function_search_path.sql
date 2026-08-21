-- pg_dump deliberately clears the session search_path. Keep every runtime
-- function deterministic under that boundary without granting CREATE on public.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;

DO $migration$
DECLARE
  runtime_function record;
BEGIN
  FOR runtime_function IN
    SELECT procedure.oid
      FROM pg_proc procedure
      JOIN pg_namespace namespace ON namespace.oid = procedure.pronamespace
     WHERE namespace.nspname = 'guild_runtime'
     ORDER BY procedure.oid
  LOOP
    EXECUTE format(
      'ALTER FUNCTION %s SET search_path TO pg_catalog, public',
      runtime_function.oid::regprocedure
    );
  END LOOP;
END;
$migration$;

DO $validation$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM pg_proc procedure
      JOIN pg_namespace namespace ON namespace.oid = procedure.pronamespace
     WHERE namespace.nspname = 'guild_runtime'
       AND NOT EXISTS (
         SELECT 1
           FROM unnest(COALESCE(procedure.proconfig, '{}'::text[])) configuration
          WHERE configuration = 'search_path=pg_catalog, public'
       )
  ) THEN
    RAISE EXCEPTION 'Every guild_runtime function requires a backup-safe search_path';
  END IF;
END;
$validation$;
