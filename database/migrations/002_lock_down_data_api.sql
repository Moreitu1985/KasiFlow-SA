-- KasiFlow SA — lock down Supabase's auto-generated Data API.
--
-- Supabase exposes the public schema through PostgREST to the `anon` and
-- `authenticated` roles. KasiFlow's browser client only uses Supabase for
-- authentication; ALL data access goes through the ASP.NET Core API, which
-- connects with a server-side role and enforces ownership in code.
--
-- We therefore enable row-level security with NO policies (deny-all for the
-- Data API roles) and revoke their table privileges. The API's connection role
-- (the table owner, e.g. `postgres`) is not affected because table owners bypass
-- RLS unless FORCE ROW LEVEL SECURITY is set.

BEGIN;

DO $$
DECLARE
    t TEXT;
    tables TEXT[] := ARRAY[
        'schema_migrations','businesses','business_members','business_settings',
        'customers','receivables','suppliers','payables','transactions',
        'receivable_payments','payable_payments','growth_recommendations',
        'registration_checklist_items','funding_profiles','funding_readiness_items',
        'public_profiles','opportunities','saved_opportunities','fraud_incidents','audit_events'];
BEGIN
    FOREACH t IN ARRAY tables LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    END LOOP;

    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        FOREACH t IN ARRAY tables LOOP
            EXECUTE format('REVOKE ALL ON TABLE %I FROM anon', t);
        END LOOP;
    END IF;

    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        FOREACH t IN ARRAY tables LOOP
            EXECUTE format('REVOKE ALL ON TABLE %I FROM authenticated', t);
        END LOOP;
    END IF;
END $$;

INSERT INTO schema_migrations(version) VALUES ('002_lock_down_data_api');

COMMIT;
