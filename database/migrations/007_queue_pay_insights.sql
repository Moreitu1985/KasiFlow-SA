-- KasiFlow SA — walk-in queue, barber pay terms and payouts, and booking sources for walk-ins and the shop's
-- imported appointment history. Additive only.

BEGIN;

-- Walk-ins finish as completed bookings ('walkin'). 'history' = visits the shop copied in from its paper book:
-- they count for insights and barber statements but carry no linked payment, so payment-mismatch checks skip them.
ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_source_check;
ALTER TABLE bookings ADD CONSTRAINT bookings_source_check CHECK (source IN ('public','staff','walkin','history'));

ALTER TABLE business_settings
    ADD COLUMN IF NOT EXISTS queue_enabled       BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS queue_max_waiting   INT NOT NULL DEFAULT 30 CHECK (queue_max_waiting BETWEEN 1 AND 200);

-- ---------------------------------------------------------------------------
-- Walk-in queue: one numbered ticket per person per day
-- ---------------------------------------------------------------------------
CREATE TABLE walkin_tickets (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id         UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    branch_id           UUID NULL REFERENCES branches(id) ON DELETE SET NULL,
    ticket_date         DATE NOT NULL,
    number              INT NOT NULL CHECK (number > 0),
    customer_name       TEXT NOT NULL CHECK (char_length(customer_name) BETWEEN 1 AND 80),
    customer_phone      TEXT NULL CHECK (customer_phone IS NULL OR char_length(customer_phone) <= 20),
    customer_user_id    UUID NULL,
    service_ids         UUID[] NOT NULL DEFAULT '{}',
    services_summary    TEXT NOT NULL DEFAULT '',
    est_minutes         INT NOT NULL CHECK (est_minutes BETWEEN 5 AND 480),
    preferred_staff_id  UUID NULL,
    staff_id            UUID NULL,
    status              TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting','called','in_chair','done','left','no_show')),
    joined_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    called_at           TIMESTAMPTZ NULL,
    started_at          TIMESTAMPTZ NULL,
    finished_at         TIMESTAMPTZ NULL,
    booking_id          UUID NULL REFERENCES bookings(id) ON DELETE SET NULL,
    token_hash          TEXT NULL,
    source              TEXT NOT NULL CHECK (source IN ('desk','customer')),
    created_by          UUID NULL,
    UNIQUE (business_id, ticket_date, number)
);
CREATE INDEX ix_walkin_tickets_day ON walkin_tickets(business_id, ticket_date, status);

-- ---------------------------------------------------------------------------
-- Barber pay: how each person is paid, and payouts the owner records (KasiFlow never moves money)
-- ---------------------------------------------------------------------------
CREATE TABLE staff_pay_terms (
    staff_id                UUID PRIMARY KEY,
    business_id             UUID NOT NULL,
    mode                    TEXT NOT NULL CHECK (mode IN ('commission','chair_rent','wage')),
    commission_percent      NUMERIC(5,2) NULL CHECK (commission_percent IS NULL OR commission_percent BETWEEN 0 AND 100),
    chair_rent_weekly_cents BIGINT NULL CHECK (chair_rent_weekly_cents IS NULL OR chair_rent_weekly_cents >= 0),
    wage_weekly_cents       BIGINT NULL CHECK (wage_weekly_cents IS NULL OR wage_weekly_cents >= 0),
    updated_by              UUID NULL,
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    FOREIGN KEY (staff_id, business_id) REFERENCES staff_profiles(id, business_id) ON DELETE CASCADE
);

CREATE TABLE staff_payouts (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id     UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    staff_id        UUID NOT NULL,
    period_from     DATE NOT NULL,
    period_to       DATE NOT NULL CHECK (period_to >= period_from),
    amount_cents    BIGINT NOT NULL CHECK (amount_cents > 0),
    direction       TEXT NOT NULL DEFAULT 'to_barber' CHECK (direction IN ('to_barber','from_barber')),
    payment_method  TEXT NOT NULL,
    transaction_id  UUID NULL REFERENCES transactions(id) ON DELETE SET NULL,
    note            TEXT NULL CHECK (note IS NULL OR char_length(note) <= 300),
    created_by      UUID NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    FOREIGN KEY (staff_id, business_id) REFERENCES staff_profiles(id, business_id) ON DELETE CASCADE
);
CREATE INDEX ix_staff_payouts ON staff_payouts(business_id, staff_id, period_to DESC);

DO $$
DECLARE
    t TEXT;
    tables TEXT[] := ARRAY['walkin_tickets','staff_pay_terms','staff_payouts'];
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

INSERT INTO schema_migrations(version) VALUES ('007_queue_pay_insights');

COMMIT;
