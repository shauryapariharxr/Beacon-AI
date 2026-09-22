-- Security hardening v2 (Supabase advisor: "RLS Disabled in Public").
--
-- Design: the app server connects with the privileged `postgres` role (table
-- owner); clients never talk to Postgres directly. So the correct posture is:
--   * RLS enabled  — silences the advisor and blocks anon/authenticated roles
--   * RLS forced   — even owner sessions are subject to policies
--   * one explicit policy for the app role — so that if the app is ever
--     migrated to a scoped role, data access keeps working by adding grants,
--     not by re-engineering RLS. Zero policies + FORCE would silently hide
--     all rows from any role RLS applies to (fail-closed, but also a
--     foot-gun); an explicit ALL policy for the app role is equivalent in
--     effect today and safer operationally.
--
-- The `postgres` role is BYPASSRLS / superuser on Supabase, so policies are
-- moot for it; they exist for defense in depth and future-proofing.

DO $$
DECLARE
  t text;
  app_role text := 'postgres';
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'users', 'conversations', 'messages',
    'documents', 'document_chunks', 'memories'
  ]
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
    -- Drop our previous policy if re-run, then create fresh.
    EXECUTE format('DROP POLICY IF EXISTS app_full_access ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY app_full_access ON public.%I FOR ALL TO %I USING (true) WITH CHECK (true)',
      t, app_role
    );
  END LOOP;
END $$;
