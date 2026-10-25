-- KasiFlow SA — customer accounts (one-time-code sign-in), verified bookings, house-call safety check-ins,
-- customer safety notes and house-call blocks, barber registration with a login invitation, and barber
-- portfolios for the public catalogue. Additive only.

BEGIN;

-- ---------------------------------------------------------------------------
-- Customer accounts. One row per Supabase auth user who books as a customer. The verified contact always comes
-- from the validated access token (email or phone claim), never from the request body.
-- ---------------------------------------------------------------------------
CREATE TABLE customer_accounts (
    user_id                      UUID PRIMARY KEY,
    full_name                    TEXT NULL CHECK (full_name IS NULL OR char_length(full_name) BETWEEN 2 AND 100),
    contact_phone                TEXT NULL CHECK (contact_phone IS NULL OR char_length(contact_phone) <= 20),
    verified_email               TEXT NULL CHECK (verified_email IS NULL OR char_length(verified_email) <= 254),
    verified_phone               TEXT NULL CHECK (verified_phone IS NULL OR char_length(verified_phone) <= 20),
    address_line                 TEXT NULL CHECK (address_line IS NULL OR char_length(address_line) BETWEEN 3 AND 200),
    suburb                       TEXT NULL CHECK (suburb IS NULL OR char_length(suburb) <= 80),
    town                         TEXT NULL CHECK (town IS NULL OR char_length(town) <= 80),
    access_notes                 TEXT NULL CHECK (access_notes IS NULL OR char_length(access_notes) <= 300),
    house_call_terms_version     TEXT NULL CHECK (house_call_terms_version IS NULL OR char_length(house_call_terms_version) <= 40),
    house_call_terms_accepted_at TIMESTAMPTZ NULL,
    created_at                   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                   TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE bookings ADD COLUMN IF NOT EXISTS customer_user_id UUID NULL;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS verified_contact TEXT NULL CHECK (verified_contact IS NULL OR char_length(verified_contact) <= 254);
CREATE INDEX IF NOT EXISTS ix_bookings_customer_user ON bookings(customer_user_id, starts_at DESC) WHERE customer_user_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- House-call safety: check-ins by the barber (append-only), alert codes that the growth engine must not auto-close
-- ---------------------------------------------------------------------------
ALTER TABLE business_settings
    ADD COLUMN IF NOT EXISTS house_call_checkin_grace_minutes INT NOT NULL DEFAULT 30 CHECK (house_call_checkin_grace_minutes BETWEEN 10 AND 240);

CREATE TABLE house_call_checkins (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id  UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    booking_id   UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
    staff_id     UUID NULL,
    kind         TEXT NOT NULL CHECK (kind IN ('departed','arrived','finished','returned','help','all_clear')),
    note         TEXT NULL CHECK (note IS NULL OR char_length(note) <= 300),
    -- Only present when the barber chose to share their location with this one check-in.
    latitude     NUMERIC(9,6) NULL CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90),
    longitude    NUMERIC(9,6) NULL CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180),
    accuracy_m   INT NULL CHECK (accuracy_m IS NULL OR accuracy_m BETWEEN 0 AND 100000),
    created_by   UUID NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK ((latitude IS NULL) = (longitude IS NULL))
);
CREATE INDEX ix_house_call_checkins_booking ON house_call_checkins(booking_id, created_at);

CREATE OR REPLACE FUNCTION kasiflow_checkins_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'house_call_checkins is append-only';
END $$;
CREATE TRIGGER trg_house_call_checkins_append_only BEFORE UPDATE OR DELETE ON house_call_checkins
    FOR EACH ROW WHEN (pg_trigger_depth() = 0) EXECUTE FUNCTION kasiflow_checkins_append_only();
-- (Cascade deletes from a removed business/booking run at trigger depth > 0 through the FK and are allowed.)

-- ---------------------------------------------------------------------------
-- Customer safety notes (internal, factual) and house-call blocks (a manual owner/manager decision with a reason)
-- ---------------------------------------------------------------------------
CREATE TABLE customer_safety_notes (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id       UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    customer_user_id  UUID NOT NULL,
    booking_id        UUID NULL REFERENCES bookings(id) ON DELETE SET NULL,
    category          TEXT NOT NULL CHECK (category IN ('access','pets','conduct','safety_concern','other')),
    note              TEXT NOT NULL CHECK (char_length(note) BETWEEN 3 AND 500),
    created_by        UUID NOT NULL,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_customer_safety_notes ON customer_safety_notes(business_id, customer_user_id, created_at DESC);

CREATE TABLE customer_house_call_blocks (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id       UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    customer_user_id  UUID NOT NULL,
    reason            TEXT NOT NULL CHECK (char_length(reason) BETWEEN 3 AND 300),
    blocked_by        UUID NOT NULL,
    blocked_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    lifted_by         UUID NULL,
    lifted_at         TIMESTAMPTZ NULL,
    lift_reason       TEXT NULL CHECK (lift_reason IS NULL OR char_length(lift_reason) <= 300)
);
CREATE UNIQUE INDEX ux_house_call_blocks_active ON customer_house_call_blocks(business_id, customer_user_id) WHERE lifted_at IS NULL;

-- ---------------------------------------------------------------------------
-- Barber registration: profile details and login invitations bound to a profile
-- ---------------------------------------------------------------------------
ALTER TABLE staff_profiles
    ADD COLUMN IF NOT EXISTS bio                      TEXT NULL CHECK (bio IS NULL OR char_length(bio) <= 300),
    ADD COLUMN IF NOT EXISTS specialties              TEXT NULL CHECK (specialties IS NULL OR char_length(specialties) <= 120),
    ADD COLUMN IF NOT EXISTS contact_phone            TEXT NULL CHECK (contact_phone IS NULL OR char_length(contact_phone) <= 20),
    ADD COLUMN IF NOT EXISTS emergency_contact_name   TEXT NULL CHECK (emergency_contact_name IS NULL OR char_length(emergency_contact_name) <= 80),
    ADD COLUMN IF NOT EXISTS emergency_contact_phone  TEXT NULL CHECK (emergency_contact_phone IS NULL OR char_length(emergency_contact_phone) <= 20);

ALTER TABLE staff_invitations ADD COLUMN IF NOT EXISTS staff_profile_id UUID NULL REFERENCES staff_profiles(id) ON DELETE SET NULL;

-- ---------------------------------------------------------------------------
-- Barber portfolio photos for the public catalogue
-- ---------------------------------------------------------------------------
CREATE TABLE staff_portfolio_photos (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id        UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    staff_id           UUID NOT NULL,
    service_id         UUID NULL,
    caption            TEXT NULL CHECK (caption IS NULL OR char_length(caption) <= 120),
    content_type       TEXT NOT NULL CHECK (content_type IN ('image/jpeg','image/png','image/webp')),
    size_bytes         INT NOT NULL CHECK (size_bytes BETWEEN 1 AND 3145728),
    sha256             TEXT NOT NULL,
    data               BYTEA NOT NULL,
    consent_confirmed  BOOLEAN NOT NULL CHECK (consent_confirmed),
    is_public          BOOLEAN NOT NULL DEFAULT TRUE,
    sort_order         INT NOT NULL DEFAULT 0,
    uploaded_by        UUID NOT NULL,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    FOREIGN KEY (staff_id, business_id) REFERENCES staff_profiles(id, business_id) ON DELETE CASCADE
);
CREATE INDEX ix_portfolio_staff ON staff_portfolio_photos(business_id, staff_id, sort_order, created_at DESC);

-- ---------------------------------------------------------------------------
-- Lock down the Supabase Data API for the new tables
-- ---------------------------------------------------------------------------
DO $$
DECLARE
    t TEXT;
    tables TEXT[] := ARRAY['customer_accounts','house_call_checkins','customer_safety_notes','customer_house_call_blocks','staff_portfolio_photos'];
BEGIN
    FOREACH t IN ARRAY tables LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
            EXECUTE format('REVOKE ALL ON TABLE %I FROM anon', t);
        END IF;
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
            EXECUTE format('REVOKE ALL ON TABLE %I FROM authenticated', t);
        END IF;
    END LOOP;
END $$;

INSERT INTO schema_migrations(version) VALUES ('006_customers_safety_portfolio');

COMMIT;
