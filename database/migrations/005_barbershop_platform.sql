-- KasiFlow SA — barbershop-first platform: staff profiles and live status, schedules, services, bookings,
-- house calls, debt-charge policy, alerts centre, payment proofs, supplier bank-detail verification and an
-- append-only audit trail. Additive only: existing rows are preserved; new columns have safe defaults.

BEGIN;

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ---------------------------------------------------------------------------
-- Append-only audit trail
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION kasiflow_audit_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    -- The only permitted change: the business reference is cleared when a business is removed (FK SET NULL).
    IF TG_OP = 'UPDATE' AND NEW.business_id IS NULL AND OLD.business_id IS NOT NULL
       AND NEW.id = OLD.id AND NEW.user_id = OLD.user_id AND NEW.action = OLD.action AND NEW.entity_type = OLD.entity_type
       AND NEW.entity_id IS NOT DISTINCT FROM OLD.entity_id AND NEW.details = OLD.details AND NEW.created_at = OLD.created_at THEN
        RETURN NEW;
    END IF;
    RAISE EXCEPTION 'audit_events is append-only';
END $$;
DROP TRIGGER IF EXISTS trg_audit_events_append_only ON audit_events;
CREATE TRIGGER trg_audit_events_append_only BEFORE UPDATE OR DELETE ON audit_events
    FOR EACH ROW EXECUTE FUNCTION kasiflow_audit_append_only();

-- ---------------------------------------------------------------------------
-- Settings: booking, travel-fee and debt-charge policies
-- ---------------------------------------------------------------------------
ALTER TABLE business_settings
    ADD COLUMN IF NOT EXISTS booking_auto_confirm        BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS allow_off_duty_override     BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS slot_interval_minutes       INT NOT NULL DEFAULT 15 CHECK (slot_interval_minutes IN (5,10,15,20,30,60)),
    ADD COLUMN IF NOT EXISTS booking_lead_minutes        INT NOT NULL DEFAULT 30 CHECK (booking_lead_minutes BETWEEN 0 AND 2880),
    ADD COLUMN IF NOT EXISTS booking_horizon_days        INT NOT NULL DEFAULT 30 CHECK (booking_horizon_days BETWEEN 1 AND 120),
    ADD COLUMN IF NOT EXISTS house_calls_enabled         BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS travel_fee_mode             TEXT NOT NULL DEFAULT 'flat' CHECK (travel_fee_mode IN ('none','flat','per_km')),
    ADD COLUMN IF NOT EXISTS travel_fee_flat_cents       BIGINT NOT NULL DEFAULT 0 CHECK (travel_fee_flat_cents >= 0),
    ADD COLUMN IF NOT EXISTS travel_fee_per_km_cents     BIGINT NOT NULL DEFAULT 0 CHECK (travel_fee_per_km_cents >= 0),
    ADD COLUMN IF NOT EXISTS min_travel_fee_cents        BIGINT NOT NULL DEFAULT 0 CHECK (min_travel_fee_cents >= 0),
    ADD COLUMN IF NOT EXISTS max_travel_km               NUMERIC(6,1) NULL CHECK (max_travel_km IS NULL OR max_travel_km > 0),
    ADD COLUMN IF NOT EXISTS debt_charge_enabled         BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS debt_charge_cents           BIGINT NOT NULL DEFAULT 500 CHECK (debt_charge_cents BETWEEN 0 AND 100000),
    ADD COLUMN IF NOT EXISTS debt_charge_overdue_days    INT NOT NULL DEFAULT 7 CHECK (debt_charge_overdue_days BETWEEN 1 AND 365),
    ADD COLUMN IF NOT EXISTS debt_charge_legal_reviewed  BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS debt_charge_reviewed_note   TEXT NULL CHECK (debt_charge_reviewed_note IS NULL OR char_length(debt_charge_reviewed_note) <= 500),
    ADD COLUMN IF NOT EXISTS debt_charge_terms           TEXT NULL CHECK (debt_charge_terms IS NULL OR char_length(debt_charge_terms) <= 1000),
    ADD COLUMN IF NOT EXISTS debt_charge_policy_version  INT NOT NULL DEFAULT 0;

-- ---------------------------------------------------------------------------
-- Staff profiles (a person on the team; optionally linked to a login), live status, schedules
-- ---------------------------------------------------------------------------
CREATE TABLE staff_profiles (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id          UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    user_id              UUID NULL,
    display_name         TEXT NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 80),
    role_title           TEXT NOT NULL DEFAULT 'Barber' CHECK (char_length(role_title) BETWEEN 1 AND 60),
    branch_id            UUID NULL REFERENCES branches(id) ON DELETE SET NULL,
    is_bookable          BOOLEAN NOT NULL DEFAULT TRUE,
    accepts_house_calls  BOOLEAN NOT NULL DEFAULT FALSE,
    is_active            BOOLEAN NOT NULL DEFAULT TRUE,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (id, business_id)
);
CREATE UNIQUE INDEX ux_staff_profiles_user ON staff_profiles(business_id, user_id) WHERE user_id IS NOT NULL;
CREATE INDEX ix_staff_profiles_business ON staff_profiles(business_id);

CREATE TABLE staff_status (
    staff_id     UUID PRIMARY KEY,
    business_id  UUID NOT NULL,
    status       TEXT NOT NULL DEFAULT 'off_duty' CHECK (status IN ('available','busy','house_call','on_break','unavailable','off_duty')),
    note         TEXT NULL CHECK (note IS NULL OR char_length(note) <= 120),
    expires_at   TIMESTAMPTZ NULL,
    revert_to    TEXT NULL CHECK (revert_to IS NULL OR revert_to IN ('available','busy','house_call','on_break','unavailable','off_duty')),
    updated_by   UUID NULL,
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    FOREIGN KEY (staff_id, business_id) REFERENCES staff_profiles(id, business_id) ON DELETE CASCADE
);

CREATE TABLE staff_status_history (
    id          BIGSERIAL PRIMARY KEY,
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    staff_id    UUID NOT NULL REFERENCES staff_profiles(id) ON DELETE CASCADE,
    status      TEXT NOT NULL,
    note        TEXT NULL,
    expires_at  TIMESTAMPTZ NULL,
    source      TEXT NOT NULL CHECK (source IN ('manual','expiry','booking','system')),
    changed_by  UUID NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_staff_status_history ON staff_status_history(staff_id, created_at DESC);

CREATE TABLE staff_working_hours (
    business_id UUID NOT NULL,
    staff_id    UUID NOT NULL,
    weekday     SMALLINT NOT NULL CHECK (weekday BETWEEN 0 AND 6),  -- 0 = Sunday
    start_time  TIME NOT NULL,
    end_time    TIME NOT NULL,
    PRIMARY KEY (staff_id, weekday, start_time),
    FOREIGN KEY (staff_id, business_id) REFERENCES staff_profiles(id, business_id) ON DELETE CASCADE,
    CHECK (end_time > start_time)
);

CREATE TABLE staff_time_off (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL,
    staff_id    UUID NOT NULL,
    starts_at   TIMESTAMPTZ NOT NULL,
    ends_at     TIMESTAMPTZ NOT NULL,
    kind        TEXT NOT NULL DEFAULT 'personal' CHECK (kind IN ('leave','class','exam','personal','other')),
    note        TEXT NULL CHECK (note IS NULL OR char_length(note) <= 200),
    created_by  UUID NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    FOREIGN KEY (staff_id, business_id) REFERENCES staff_profiles(id, business_id) ON DELETE CASCADE,
    CHECK (ends_at > starts_at)
);
CREATE INDEX ix_staff_time_off ON staff_time_off(staff_id, starts_at);

-- ---------------------------------------------------------------------------
-- Service catalogue
-- ---------------------------------------------------------------------------
CREATE TABLE services (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id       UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    name              TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
    description       TEXT NULL CHECK (description IS NULL OR char_length(description) <= 300),
    category          TEXT NULL CHECK (category IS NULL OR char_length(category) <= 40),
    price_cents       BIGINT NOT NULL CHECK (price_cents >= 0),
    duration_minutes  INT NOT NULL CHECK (duration_minutes BETWEEN 5 AND 480),
    is_active         BOOLEAN NOT NULL DEFAULT TRUE,
    is_public         BOOLEAN NOT NULL DEFAULT TRUE,
    allows_house_call BOOLEAN NOT NULL DEFAULT TRUE,
    sort_order        INT NOT NULL DEFAULT 0,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (id, business_id)
);
CREATE UNIQUE INDEX ux_services_name ON services(business_id, lower(name));

CREATE TABLE staff_services (
    business_id UUID NOT NULL,
    staff_id    UUID NOT NULL,
    service_id  UUID NOT NULL,
    price_cents BIGINT NULL CHECK (price_cents IS NULL OR price_cents >= 0),  -- individual price; NULL = catalogue price
    PRIMARY KEY (staff_id, service_id),
    FOREIGN KEY (staff_id, business_id) REFERENCES staff_profiles(id, business_id) ON DELETE CASCADE,
    FOREIGN KEY (service_id, business_id) REFERENCES services(id, business_id) ON DELETE CASCADE
);

-- ---------------------------------------------------------------------------
-- Bookings and house calls
-- ---------------------------------------------------------------------------
CREATE TABLE bookings (
    id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id                UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    reference                  TEXT NOT NULL UNIQUE CHECK (reference ~ '^BK-[A-Z0-9]{6,10}$'),
    customer_id                UUID NULL REFERENCES customers(id) ON DELETE SET NULL,
    customer_name              TEXT NOT NULL CHECK (char_length(customer_name) BETWEEN 1 AND 120),
    customer_phone             TEXT NULL CHECK (customer_phone IS NULL OR char_length(customer_phone) <= 20),
    customer_email             TEXT NULL CHECK (customer_email IS NULL OR char_length(customer_email) <= 254),
    staff_id                   UUID NULL,
    branch_id                  UUID NULL REFERENCES branches(id) ON DELETE SET NULL,
    location_type              TEXT NOT NULL DEFAULT 'in_shop' CHECK (location_type IN ('in_shop','house_call')),
    starts_at                  TIMESTAMPTZ NOT NULL,
    ends_at                    TIMESTAMPTZ NOT NULL,
    status                     TEXT NOT NULL DEFAULT 'requested'
                                  CHECK (status IN ('requested','confirmed','reschedule_proposed','completed','cancelled','no_show')),
    proposed_starts_at         TIMESTAMPTZ NULL,
    proposed_ends_at           TIMESTAMPTZ NULL,
    proposed_staff_id          UUID NULL,
    proposed_travel_fee_cents  BIGINT NULL CHECK (proposed_travel_fee_cents IS NULL OR proposed_travel_fee_cents >= 0),
    proposed_by                TEXT NULL CHECK (proposed_by IS NULL OR proposed_by IN ('business','customer')),
    proposal_note              TEXT NULL CHECK (proposal_note IS NULL OR char_length(proposal_note) <= 300),
    people_count               INT NOT NULL DEFAULT 1 CHECK (people_count BETWEEN 1 AND 20),
    services_total_cents       BIGINT NOT NULL CHECK (services_total_cents >= 0),
    travel_fee_cents           BIGINT NOT NULL DEFAULT 0 CHECK (travel_fee_cents >= 0),
    discount_cents             BIGINT NOT NULL DEFAULT 0 CHECK (discount_cents >= 0),
    total_cents                BIGINT NOT NULL CHECK (total_cents >= 0),
    source                     TEXT NOT NULL CHECK (source IN ('public','staff')),
    customer_note              TEXT NULL CHECK (customer_note IS NULL OR char_length(customer_note) <= 500),
    internal_note              TEXT NULL CHECK (internal_note IS NULL OR char_length(internal_note) <= 500),
    status_token_hash          TEXT NULL,
    off_duty_override          BOOLEAN NOT NULL DEFAULT FALSE,
    override_reason            TEXT NULL CHECK (override_reason IS NULL OR char_length(override_reason) <= 300),
    cancel_reason              TEXT NULL CHECK (cancel_reason IS NULL OR char_length(cancel_reason) <= 300),
    confirmed_by               UUID NULL,
    confirmed_at               TIMESTAMPTZ NULL,
    completed_at               TIMESTAMPTZ NULL,
    created_by                 UUID NULL,
    created_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (id, business_id),
    FOREIGN KEY (staff_id, business_id) REFERENCES staff_profiles(id, business_id),
    CHECK (ends_at > starts_at),
    CHECK (total_cents = services_total_cents + travel_fee_cents - discount_cents),
    -- No two confirmed appointments for the same barber may overlap (defence in depth; the API checks first).
    EXCLUDE USING gist (staff_id WITH =, tstzrange(starts_at, ends_at) WITH &&) WHERE (status = 'confirmed' AND staff_id IS NOT NULL)
);
CREATE INDEX ix_bookings_business_start ON bookings(business_id, starts_at);
CREATE INDEX ix_bookings_staff_start ON bookings(staff_id, starts_at);

CREATE TABLE booking_items (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id      UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    booking_id       UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
    service_id       UUID NULL REFERENCES services(id) ON DELETE SET NULL,
    service_name     TEXT NOT NULL,
    person_label     TEXT NOT NULL DEFAULT 'Person 1' CHECK (char_length(person_label) BETWEEN 1 AND 40),
    unit_price_cents BIGINT NOT NULL CHECK (unit_price_cents >= 0),
    duration_minutes INT NOT NULL CHECK (duration_minutes > 0)
);
CREATE INDEX ix_booking_items_booking ON booking_items(booking_id);

CREATE TABLE booking_events (
    id            BIGSERIAL PRIMARY KEY,
    business_id   UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    booking_id    UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
    event         TEXT NOT NULL,
    from_status   TEXT NULL,
    to_status     TEXT NULL,
    actor_kind    TEXT NOT NULL CHECK (actor_kind IN ('staff','customer','system')),
    actor_user_id UUID NULL,
    note          TEXT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_booking_events_booking ON booking_events(booking_id, created_at);

-- Private: only shown to people who handle the booking. Never on the public profile.
CREATE TABLE house_call_details (
    booking_id                   UUID PRIMARY KEY REFERENCES bookings(id) ON DELETE CASCADE,
    business_id                  UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    address_line                 TEXT NOT NULL CHECK (char_length(address_line) BETWEEN 3 AND 200),
    suburb                       TEXT NULL CHECK (suburb IS NULL OR char_length(suburb) <= 80),
    town                         TEXT NULL CHECK (town IS NULL OR char_length(town) <= 80),
    access_notes                 TEXT NULL CHECK (access_notes IS NULL OR char_length(access_notes) <= 300),
    latitude                     NUMERIC(9,6) NULL CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90),
    longitude                    NUMERIC(9,6) NULL CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180),
    distance_km                  NUMERIC(6,1) NULL CHECK (distance_km IS NULL OR distance_km >= 0),
    distance_source              TEXT NOT NULL DEFAULT 'uncalculated' CHECK (distance_source IN ('uncalculated','manual','provider')),
    estimated_travel_cost_cents  BIGINT NULL CHECK (estimated_travel_cost_cents IS NULL OR estimated_travel_cost_cents >= 0),
    estimated_other_cost_cents   BIGINT NULL CHECK (estimated_other_cost_cents IS NULL OR estimated_other_cost_cents >= 0),
    updated_at                   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Ledger and debts link to bookings.
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS booking_id UUID NULL REFERENCES bookings(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS ix_transactions_booking ON transactions(booking_id);

-- ---------------------------------------------------------------------------
-- Customer debts: dispute, disclosure, charges and collection attempts
-- ---------------------------------------------------------------------------
ALTER TABLE receivables
    ADD COLUMN IF NOT EXISTS booking_id            UUID NULL REFERENCES bookings(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS reference             TEXT NULL CHECK (reference IS NULL OR char_length(reference) <= 80),
    ADD COLUMN IF NOT EXISTS disputed              BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS dispute_reason        TEXT NULL CHECK (dispute_reason IS NULL OR char_length(dispute_reason) <= 500),
    ADD COLUMN IF NOT EXISTS disputed_at           TIMESTAMPTZ NULL,
    -- Charge terms shown to the customer when the debt was incurred (snapshot; never changed afterwards).
    ADD COLUMN IF NOT EXISTS charge_terms_disclosed_at TIMESTAMPTZ NULL,
    ADD COLUMN IF NOT EXISTS charge_terms_snapshot TEXT NULL,
    ADD COLUMN IF NOT EXISTS charge_policy_version INT NULL,
    ADD COLUMN IF NOT EXISTS charge_amount_cents   BIGINT NULL CHECK (charge_amount_cents IS NULL OR charge_amount_cents >= 0),
    ADD COLUMN IF NOT EXISTS charge_overdue_days   INT NULL;

CREATE TABLE receivable_charges (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id      UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    receivable_id    UUID NOT NULL REFERENCES receivables(id) ON DELETE CASCADE,
    event_key        TEXT NOT NULL,                       -- the qualifying event; one charge per event at most
    amount_cents     BIGINT NOT NULL CHECK (amount_cents > 0),
    status           TEXT NOT NULL CHECK (status IN ('proposed','applied','waived','reversed')),
    basis            TEXT NOT NULL,                       -- why it applies / why it is only proposed
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    decided_by       UUID NULL,
    decided_at       TIMESTAMPTZ NULL,
    decision_reason  TEXT NULL CHECK (decision_reason IS NULL OR char_length(decision_reason) <= 300),
    UNIQUE (receivable_id, event_key)
);
CREATE INDEX ix_receivable_charges_business ON receivable_charges(business_id, status);

CREATE TABLE receivable_reminders (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id   UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    receivable_id UUID NOT NULL REFERENCES receivables(id) ON DELETE CASCADE,
    channel       TEXT NOT NULL DEFAULT 'manual' CHECK (channel IN ('manual','whatsapp','sms','call','in_person')),
    outcome       TEXT NOT NULL DEFAULT 'sent' CHECK (outcome IN ('sent','promised','no_answer','refused')),
    note          TEXT NULL CHECK (note IS NULL OR char_length(note) <= 300),
    created_by    UUID NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_receivable_reminders ON receivable_reminders(receivable_id, created_at);

-- ---------------------------------------------------------------------------
-- Fraud & Alerts Centre
-- ---------------------------------------------------------------------------
CREATE TABLE alerts (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id        UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    rule_code          TEXT NOT NULL,
    fingerprint        TEXT NOT NULL,
    severity           TEXT NOT NULL CHECK (severity IN ('informational','warning','critical')),
    title              TEXT NOT NULL,
    reason             TEXT NOT NULL,
    evidence           JSONB NOT NULL DEFAULT '[]'::jsonb,
    affected_type      TEXT NULL,
    affected_id        UUID NULL,
    recommended_action TEXT NOT NULL,
    status             TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','under_review','resolved','false_positive')),
    reviewer_id        UUID NULL,
    review_note        TEXT NULL CHECK (review_note IS NULL OR char_length(review_note) <= 1000),
    reviewed_at        TIMESTAMPTZ NULL,
    first_detected_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_detected_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (business_id, fingerprint)
);
CREATE INDEX ix_alerts_business_status ON alerts(business_id, status, severity);

-- Proof of payment is a claim, never proof that money cleared.
CREATE TABLE payment_proofs (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id           UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    transaction_id        UUID NULL REFERENCES transactions(id) ON DELETE SET NULL,
    booking_id            UUID NULL REFERENCES bookings(id) ON DELETE SET NULL,
    receivable_id         UUID NULL REFERENCES receivables(id) ON DELETE SET NULL,
    file_name             TEXT NOT NULL CHECK (char_length(file_name) BETWEEN 1 AND 120),
    content_type          TEXT NOT NULL CHECK (content_type IN ('image/jpeg','image/png','application/pdf')),
    size_bytes            INT NOT NULL CHECK (size_bytes BETWEEN 1 AND 2097152),
    sha256                TEXT NOT NULL,
    content               BYTEA NOT NULL,
    claimed_amount_cents  BIGINT NULL CHECK (claimed_amount_cents IS NULL OR claimed_amount_cents > 0),
    claimed_reference     TEXT NULL CHECK (claimed_reference IS NULL OR char_length(claimed_reference) <= 80),
    payer_name            TEXT NULL CHECK (payer_name IS NULL OR char_length(payer_name) <= 120),
    status                TEXT NOT NULL DEFAULT 'unverified'
                             CHECK (status IN ('unverified','verified_by_provider','confirmed_in_bank','rejected')),
    verification_note     TEXT NULL CHECK (verification_note IS NULL OR char_length(verification_note) <= 300),
    verified_by           UUID NULL,
    verified_at           TIMESTAMPTZ NULL,
    submitted_by          UUID NOT NULL,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_payment_proofs_business ON payment_proofs(business_id, status);
CREATE INDEX ix_payment_proofs_sha ON payment_proofs(business_id, sha256);

-- Supplier bank details: only the last four digits and a keyed fingerprint are stored, never the full number.
CREATE TABLE supplier_bank_details (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id         UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    supplier_id         UUID NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
    bank_name           TEXT NOT NULL CHECK (char_length(bank_name) BETWEEN 2 AND 60),
    account_holder      TEXT NOT NULL CHECK (char_length(account_holder) BETWEEN 2 AND 120),
    account_last4       TEXT NOT NULL CHECK (account_last4 ~ '^[0-9]{4}$'),
    account_fingerprint TEXT NOT NULL,
    status              TEXT NOT NULL DEFAULT 'unverified' CHECK (status IN ('unverified','verified','rejected','superseded')),
    change_source       TEXT NOT NULL DEFAULT 'owner_entry' CHECK (change_source IN ('owner_entry','supplier_message','invoice','other')),
    verification_method TEXT NULL CHECK (verification_method IS NULL OR verification_method IN ('called_known_number','in_person','bank_confirmation_letter','other')),
    verification_note   TEXT NULL CHECK (verification_note IS NULL OR char_length(verification_note) <= 300),
    verified_by         UUID NULL,
    verified_at         TIMESTAMPTZ NULL,
    created_by          UUID NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_supplier_bank_details ON supplier_bank_details(supplier_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Inventory: equipment is tracked separately from consumables and retail stock
-- ---------------------------------------------------------------------------
ALTER TABLE products ADD COLUMN IF NOT EXISTS stock_class TEXT NOT NULL DEFAULT 'retail'
    CHECK (stock_class IN ('retail','consumable','equipment'));
ALTER TABLE products ADD COLUMN IF NOT EXISTS condition_note TEXT NULL CHECK (condition_note IS NULL OR char_length(condition_note) <= 200);

-- ---------------------------------------------------------------------------
-- Jobs and notifications for the new automation
-- ---------------------------------------------------------------------------
ALTER TABLE background_jobs DROP CONSTRAINT IF EXISTS background_jobs_job_type_check;
ALTER TABLE background_jobs ADD CONSTRAINT background_jobs_job_type_check
    CHECK (job_type IN ('process_provider_event','growth_refresh','sync_connection','daily_briefing'));

ALTER TABLE notifications ADD COLUMN IF NOT EXISTS staff_id UUID NULL;

-- ---------------------------------------------------------------------------
-- Lock down the Supabase Data API for the new tables (same policy as migrations 002 and 004)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
    t TEXT;
    tables TEXT[] := ARRAY['staff_profiles','staff_status','staff_status_history','staff_working_hours','staff_time_off',
        'services','staff_services','bookings','booking_items','booking_events','house_call_details','receivable_charges',
        'receivable_reminders','alerts','payment_proofs','supplier_bank_details'];
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

INSERT INTO schema_migrations(version) VALUES ('005_barbershop_platform');

COMMIT;
