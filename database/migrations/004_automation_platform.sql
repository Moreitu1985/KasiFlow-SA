-- KasiFlow SA — automation platform: staff & branches, shifts, integrations, provider events,
-- reconciliation, settlements, inventory, notifications and durable background jobs.
-- Additive only: existing rows are preserved; new columns have safe defaults.

BEGIN;

-- ---------------------------------------------------------------------------
-- Existing tables
-- ---------------------------------------------------------------------------
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS is_demo BOOLEAN NOT NULL DEFAULT FALSE;
-- Demo businesses created by earlier seeds are fictional and isolated: mark them.
UPDATE businesses SET is_demo = TRUE WHERE name = 'Thato''s Barber Studio' AND contact_email = 'demo@example.com';

ALTER TABLE business_members DROP CONSTRAINT IF EXISTS business_members_role_check;
ALTER TABLE business_members ADD CONSTRAINT business_members_role_check
    CHECK (role IN ('owner','business_admin','branch_manager','cashier','staff','accountant'));
ALTER TABLE business_members
    ADD COLUMN IF NOT EXISTS is_active    BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS display_name TEXT NULL CHECK (display_name IS NULL OR char_length(display_name) <= 120),
    ADD COLUMN IF NOT EXISTS email        TEXT NULL CHECK (email IS NULL OR char_length(email) <= 254),
    ADD COLUMN IF NOT EXISTS invited_by   UUID NULL,
    ADD COLUMN IF NOT EXISTS updated_at   TIMESTAMPTZ NOT NULL DEFAULT now();
-- At most one owner per business.
CREATE UNIQUE INDEX IF NOT EXISTS ux_business_members_one_owner ON business_members(business_id) WHERE role = 'owner';

ALTER TABLE business_settings
    ADD COLUMN IF NOT EXISTS large_tx_multiplier         NUMERIC(4,1) NOT NULL DEFAULT 3.0 CHECK (large_tx_multiplier BETWEEN 1.5 AND 20),
    ADD COLUMN IF NOT EXISTS cashup_variance_threshold_cents BIGINT NOT NULL DEFAULT 5000 CHECK (cashup_variance_threshold_cents >= 0),
    ADD COLUMN IF NOT EXISTS reorder_safety_days         INT NOT NULL DEFAULT 3 CHECK (reorder_safety_days BETWEEN 0 AND 60),
    ADD COLUMN IF NOT EXISTS reorder_cover_days          INT NOT NULL DEFAULT 14 CHECK (reorder_cover_days BETWEEN 1 AND 120),
    ADD COLUMN IF NOT EXISTS default_lead_time_days      INT NOT NULL DEFAULT 7 CHECK (default_lead_time_days BETWEEN 0 AND 120);

-- ---------------------------------------------------------------------------
-- Branches and staff
-- ---------------------------------------------------------------------------
CREATE TABLE branches (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    name        TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
    area        TEXT NULL CHECK (area IS NULL OR char_length(area) <= 120),
    is_active   BOOLEAN NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (business_id, name),
    UNIQUE (id, business_id)
);

CREATE TABLE member_branches (
    business_id UUID NOT NULL,
    user_id     UUID NOT NULL,
    branch_id   UUID NOT NULL,
    PRIMARY KEY (business_id, user_id, branch_id),
    FOREIGN KEY (business_id, user_id) REFERENCES business_members(business_id, user_id) ON DELETE CASCADE,
    FOREIGN KEY (branch_id, business_id) REFERENCES branches(id, business_id) ON DELETE CASCADE
);

CREATE TABLE staff_invitations (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    email       TEXT NOT NULL CHECK (char_length(email) <= 254),
    role        TEXT NOT NULL CHECK (role IN ('business_admin','branch_manager','cashier','staff','accountant')),
    branch_ids  UUID[] NOT NULL DEFAULT '{}',
    token_hash  TEXT NOT NULL UNIQUE,          -- SHA-256 of the one-time token; the token itself is never stored
    status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','revoked')),
    expires_at  TIMESTAMPTZ NOT NULL,
    invited_by  UUID NOT NULL,
    accepted_by UUID NULL,
    accepted_at TIMESTAMPTZ NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_staff_invitations_business ON staff_invitations(business_id, status);

-- ---------------------------------------------------------------------------
-- Shifts and cash-up
-- ---------------------------------------------------------------------------
CREATE TABLE shifts (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id          UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    branch_id            UUID NOT NULL,
    staff_user_id        UUID NOT NULL,
    opened_by            UUID NOT NULL,
    opened_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    opening_float_cents  BIGINT NOT NULL CHECK (opening_float_cents >= 0),
    closed_at            TIMESTAMPTZ NULL,
    counted_cash_cents   BIGINT NULL CHECK (counted_cash_cents IS NULL OR counted_cash_cents >= 0),
    expected_cash_cents  BIGINT NULL,
    variance_cents       BIGINT NULL,
    needs_review         BOOLEAN NOT NULL DEFAULT FALSE,
    status               TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed','reviewed')),
    close_note           TEXT NULL CHECK (close_note IS NULL OR char_length(close_note) <= 1000),
    review_note          TEXT NULL CHECK (review_note IS NULL OR char_length(review_note) <= 1000),
    reviewed_by          UUID NULL,
    reviewed_at          TIMESTAMPTZ NULL,
    FOREIGN KEY (branch_id, business_id) REFERENCES branches(id, business_id) ON DELETE RESTRICT,
    CHECK ((status = 'open') = (closed_at IS NULL))
);
CREATE UNIQUE INDEX ux_shifts_one_open ON shifts(branch_id, staff_user_id) WHERE status = 'open';
CREATE INDEX ix_shifts_business ON shifts(business_id, opened_at DESC);

CREATE TABLE shift_cash_movements (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id  UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    shift_id     UUID NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
    kind         TEXT NOT NULL CHECK (kind IN ('cash_drop','float_top_up')),
    amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
    note         TEXT NULL CHECK (note IS NULL OR char_length(note) <= 300),
    recorded_by  UUID NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Integrations and provider events
-- ---------------------------------------------------------------------------
CREATE TABLE integration_connections (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id      UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    provider_key     TEXT NOT NULL CHECK (provider_key IN ('sandbox','snapscan','yoco')),
    environment      TEXT NOT NULL CHECK (environment IN ('sandbox','production')),
    status           TEXT NOT NULL DEFAULT 'pending_setup'
                        CHECK (status IN ('pending_setup','awaiting_credentials','connected','error','disconnected')),
    display_name     TEXT NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 80),
    credential_ref   TEXT NULL CHECK (credential_ref IS NULL OR credential_ref ~ '^[A-Za-z0-9_-]{1,64}$'), -- name of a secret in configuration; never the secret
    merchant_ref     TEXT NULL CHECK (merchant_ref IS NULL OR char_length(merchant_ref) <= 120),
    default_branch_id UUID NULL REFERENCES branches(id) ON DELETE SET NULL,
    connected_at     TIMESTAMPTZ NULL,
    disconnected_at  TIMESTAMPTZ NULL,
    last_test_at     TIMESTAMPTZ NULL,
    last_test_ok     BOOLEAN NULL,
    last_sync_at     TIMESTAMPTZ NULL,
    last_success_at  TIMESTAMPTZ NULL,
    last_error       TEXT NULL,
    last_error_hint  TEXT NULL,
    created_by       UUID NOT NULL,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK ((provider_key = 'sandbox') = (environment = 'sandbox'))
);
CREATE UNIQUE INDEX ux_integration_active ON integration_connections(business_id, provider_key) WHERE status <> 'disconnected';

CREATE TABLE sync_checkpoints (
    connection_id    UUID PRIMARY KEY REFERENCES integration_connections(id) ON DELETE CASCADE,
    cursor_time      TIMESTAMPTZ NULL,
    last_external_id TEXT NULL,
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE webhook_deliveries (
    id              BIGSERIAL PRIMARY KEY,
    provider_key    TEXT NOT NULL,
    connection_id   UUID NULL REFERENCES integration_connections(id) ON DELETE SET NULL,
    business_id     UUID NULL REFERENCES businesses(id) ON DELETE SET NULL,
    received_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    signature_valid BOOLEAN NOT NULL,
    outcome         TEXT NOT NULL CHECK (outcome IN ('accepted','duplicate','rejected')),
    http_status     INT NOT NULL,
    body_sha256     TEXT NOT NULL,
    error           TEXT NULL,
    event_id        UUID NULL
);
CREATE INDEX ix_webhook_deliveries_connection ON webhook_deliveries(connection_id, received_at DESC);

CREATE TABLE settlements (
    id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id            UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    connection_id          UUID NOT NULL REFERENCES integration_connections(id) ON DELETE CASCADE,
    external_settlement_id TEXT NOT NULL,
    settled_on             DATE NOT NULL,
    gross_cents            BIGINT NOT NULL DEFAULT 0,
    fee_cents              BIGINT NULL CHECK (fee_cents IS NULL OR fee_cents >= 0),
    net_cents              BIGINT NULL,
    payment_count          INT NOT NULL DEFAULT 0,
    fee_transaction_id     UUID NULL REFERENCES transactions(id) ON DELETE SET NULL,
    environment            TEXT NOT NULL CHECK (environment IN ('sandbox','production')),
    created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (connection_id, external_settlement_id)
);

CREATE TABLE provider_payments (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id           UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    connection_id         UUID NOT NULL REFERENCES integration_connections(id) ON DELETE CASCADE,
    provider_key          TEXT NOT NULL,
    environment           TEXT NOT NULL CHECK (environment IN ('sandbox','production')),
    external_payment_id   TEXT NOT NULL,
    kind                  TEXT NOT NULL CHECK (kind IN ('payment','refund')),
    method                TEXT NOT NULL DEFAULT 'qr' CHECK (method IN ('qr','card','other')),
    status                TEXT NOT NULL CHECK (status IN ('pending','completed','failed','reversed')),
    gross_cents           BIGINT NOT NULL CHECK (gross_cents >= 0),
    tip_cents             BIGINT NOT NULL DEFAULT 0 CHECK (tip_cents >= 0),
    fee_cents             BIGINT NULL,
    net_cents             BIGINT NULL,
    merchant_reference    TEXT NULL,
    user_reference        TEXT NULL,
    statement_reference   TEXT NULL,
    refund_of_payment_id  UUID NULL REFERENCES provider_payments(id) ON DELETE SET NULL,
    occurred_at           TIMESTAMPTZ NOT NULL,
    completed_at          TIMESTAMPTZ NULL,
    settlement_id         UUID NULL REFERENCES settlements(id) ON DELETE SET NULL,
    transaction_id        UUID NULL REFERENCES transactions(id) ON DELETE SET NULL,
    reconciliation_status TEXT NOT NULL DEFAULT 'unmatched'
                             CHECK (reconciliation_status IN ('not_applicable','unmatched','auto_matched','matched','needs_review','created_sale','ignored')),
    branch_id             UUID NULL REFERENCES branches(id) ON DELETE SET NULL,
    device_id             TEXT NULL,
    line_items            JSONB NULL,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (connection_id, external_payment_id)
);
CREATE INDEX ix_provider_payments_business ON provider_payments(business_id, occurred_at DESC);
CREATE INDEX ix_provider_payments_recon ON provider_payments(business_id, reconciliation_status);
CREATE INDEX ix_provider_payments_statement ON provider_payments(connection_id, statement_reference);

CREATE TABLE provider_events (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id         UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    connection_id       UUID NOT NULL REFERENCES integration_connections(id) ON DELETE CASCADE,
    provider_key        TEXT NOT NULL,
    environment         TEXT NOT NULL CHECK (environment IN ('sandbox','production')),
    external_event_id   TEXT NOT NULL,
    event_type          TEXT NOT NULL CHECK (event_type IN ('payment','settlement')),
    verification        TEXT NOT NULL CHECK (verification IN ('signature_verified','api_confirmed','sandbox_signed')),
    received_via        TEXT NOT NULL CHECK (received_via IN ('webhook','sync')),
    payload             JSONB NOT NULL,          -- normalised fields only; no card or personal data
    received_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    processing_status   TEXT NOT NULL DEFAULT 'received'
                           CHECK (processing_status IN ('received','processed','failed','dead','rejected')),
    attempts            INT NOT NULL DEFAULT 0,
    last_error          TEXT NULL,
    processed_at        TIMESTAMPTZ NULL,
    provider_payment_id UUID NULL REFERENCES provider_payments(id) ON DELETE SET NULL,
    duplicate_count     INT NOT NULL DEFAULT 0,
    last_duplicate_at   TIMESTAMPTZ NULL,
    UNIQUE (connection_id, external_event_id)       -- idempotency: one row per provider event
);
CREATE INDEX ix_provider_events_business ON provider_events(business_id, received_at DESC);

CREATE TABLE reconciliation_matches (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id         UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    provider_payment_id UUID NOT NULL REFERENCES provider_payments(id) ON DELETE CASCADE,
    transaction_id      UUID NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
    method              TEXT NOT NULL CHECK (method IN ('exact_reference','amount_date','manual','created_from_payment')),
    confidence          NUMERIC(4,3) NOT NULL CHECK (confidence BETWEEN 0 AND 1),
    reason              TEXT NOT NULL,
    status              TEXT NOT NULL CHECK (status IN ('suggested','accepted','rejected','unmatched')),
    decided_by          UUID NULL,
    decided_at          TIMESTAMPTZ NULL,
    note                TEXT NULL CHECK (note IS NULL OR char_length(note) <= 300),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ux_recon_payment_accepted ON reconciliation_matches(provider_payment_id) WHERE status = 'accepted';
CREATE UNIQUE INDEX ux_recon_tx_accepted ON reconciliation_matches(transaction_id) WHERE status = 'accepted';
CREATE INDEX ix_recon_business ON reconciliation_matches(business_id, status);

-- Ledger additions: origin label, branch, shift, provider link.
ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_source_check;
ALTER TABLE transactions ADD CONSTRAINT transactions_source_check
    CHECK (source IN ('manual','receivable_payment','payable_payment','provider_payment','provider_refund','provider_fee'));
ALTER TABLE transactions
    ADD COLUMN IF NOT EXISTS origin TEXT NOT NULL DEFAULT 'staff_recorded'
        CHECK (origin IN ('staff_recorded','connected_pos','verified_provider','imported_file','demo_simulation')),
    ADD COLUMN IF NOT EXISTS branch_id UUID NULL REFERENCES branches(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS shift_id  UUID NULL REFERENCES shifts(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS provider_payment_id UUID NULL REFERENCES provider_payments(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS idempotency_key TEXT NULL CHECK (idempotency_key IS NULL OR char_length(idempotency_key) <= 100);
CREATE UNIQUE INDEX IF NOT EXISTS ux_transactions_idempotency ON transactions(business_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_transactions_branch ON transactions(business_id, branch_id);
CREATE INDEX IF NOT EXISTS ix_transactions_shift ON transactions(shift_id);
CREATE UNIQUE INDEX IF NOT EXISTS ux_transactions_provider_payment ON transactions(provider_payment_id, source) WHERE provider_payment_id IS NOT NULL AND status <> 'voided';

-- ---------------------------------------------------------------------------
-- Inventory
-- ---------------------------------------------------------------------------
CREATE TABLE products (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id      UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    sku              TEXT NOT NULL CHECK (sku ~ '^[A-Za-z0-9._-]{1,40}$'),
    barcode          TEXT NULL CHECK (barcode IS NULL OR barcode ~ '^[0-9]{6,14}$'),
    name             TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
    kind             TEXT NOT NULL DEFAULT 'product' CHECK (kind IN ('product','service')),
    unit_price_cents BIGINT NOT NULL CHECK (unit_price_cents >= 0),
    unit_cost_cents  BIGINT NOT NULL DEFAULT 0 CHECK (unit_cost_cents >= 0),
    min_stock_qty    INT NOT NULL DEFAULT 0 CHECK (min_stock_qty >= 0),
    lead_time_days   INT NULL CHECK (lead_time_days IS NULL OR lead_time_days BETWEEN 0 AND 120),
    supplier_id      UUID NULL REFERENCES suppliers(id) ON DELETE SET NULL,
    is_active        BOOLEAN NOT NULL DEFAULT TRUE,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (business_id, sku)
);

CREATE TABLE inventory_levels (
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    product_id  UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    branch_id   UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
    quantity    INT NOT NULL DEFAULT 0,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (product_id, branch_id)
);

CREATE TABLE stock_movements (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id         UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    product_id          UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    branch_id           UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
    movement_type       TEXT NOT NULL CHECK (movement_type IN ('received','sold','adjustment','return','damaged','transfer_out','transfer_in','sale_reversal')),
    quantity_delta      INT NOT NULL CHECK (quantity_delta <> 0),
    unit_cost_cents     BIGINT NULL,
    status              TEXT NOT NULL DEFAULT 'applied' CHECK (status IN ('pending_approval','applied','rejected')),
    reason              TEXT NULL CHECK (reason IS NULL OR char_length(reason) <= 300),
    source_key          TEXT NULL UNIQUE,     -- idempotency for automated movements (e.g. one POS sale line)
    provider_payment_id UUID NULL REFERENCES provider_payments(id) ON DELETE SET NULL,
    transaction_id      UUID NULL REFERENCES transactions(id) ON DELETE SET NULL,
    transfer_group      UUID NULL,
    created_by          UUID NULL,
    approved_by         UUID NULL,
    approved_at         TIMESTAMPTZ NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_stock_movements_product ON stock_movements(product_id, created_at DESC);
CREATE INDEX ix_stock_movements_business ON stock_movements(business_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Notifications and background jobs
-- ---------------------------------------------------------------------------
CREATE TABLE notification_preferences (
    business_id   UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    user_id       UUID NOT NULL,
    briefing_time TIME NOT NULL DEFAULT '07:00',
    in_app        BOOLEAN NOT NULL DEFAULT TRUE,
    email         BOOLEAN NOT NULL DEFAULT FALSE,
    critical_cash BOOLEAN NOT NULL DEFAULT TRUE,
    cashup        BOOLEAN NOT NULL DEFAULT TRUE,
    low_stock     BOOLEAN NOT NULL DEFAULT TRUE,
    integrations  BOOLEAN NOT NULL DEFAULT TRUE,
    last_briefing_on DATE NULL,
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (business_id, user_id)
);

CREATE TABLE notifications (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    user_id     UUID NOT NULL,
    kind        TEXT NOT NULL,
    severity    TEXT NOT NULL CHECK (severity IN ('informational','warning','critical')),
    title       TEXT NOT NULL,
    body        TEXT NOT NULL,
    link        TEXT NULL,
    dedupe_key  TEXT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    read_at     TIMESTAMPTZ NULL
);
CREATE UNIQUE INDEX ux_notifications_dedupe ON notifications(business_id, user_id, dedupe_key) WHERE dedupe_key IS NOT NULL;
CREATE INDEX ix_notifications_user ON notifications(user_id, business_id, created_at DESC);

CREATE TABLE background_jobs (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_type     TEXT NOT NULL CHECK (job_type IN ('process_provider_event','growth_refresh','sync_connection','daily_briefing')),
    business_id  UUID NULL REFERENCES businesses(id) ON DELETE CASCADE,
    dedupe_key   TEXT NULL,
    payload      JSONB NOT NULL DEFAULT '{}'::jsonb,
    status       TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','succeeded','failed','dead','superseded')),
    attempts     INT NOT NULL DEFAULT 0,
    max_attempts INT NOT NULL DEFAULT 6,
    run_after    TIMESTAMPTZ NOT NULL DEFAULT now(),
    locked_at    TIMESTAMPTZ NULL,
    last_error   TEXT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at TIMESTAMPTZ NULL
);
-- One waiting job per logical key (e.g. one pending growth refresh per business). A running job does not block
-- a new one, so changes made while a job runs are picked up by the next run.
CREATE UNIQUE INDEX ux_background_jobs_dedupe ON background_jobs(job_type, dedupe_key) WHERE dedupe_key IS NOT NULL AND status IN ('queued','failed');
CREATE INDEX ix_background_jobs_due ON background_jobs(status, run_after);

-- ---------------------------------------------------------------------------
-- Lock down the Supabase Data API for the new tables (same policy as migration 002)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
    t TEXT;
    tables TEXT[] := ARRAY['branches','member_branches','staff_invitations','shifts','shift_cash_movements',
        'integration_connections','sync_checkpoints','webhook_deliveries','settlements','provider_payments',
        'provider_events','reconciliation_matches','products','inventory_levels','stock_movements',
        'notification_preferences','notifications','background_jobs'];
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

INSERT INTO schema_migrations(version) VALUES ('004_automation_platform');

COMMIT;
