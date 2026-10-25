-- KasiFlow SA — initial schema
-- Money is stored as BIGINT cents (ZAR). Never use floating point for money.
-- All business-owned tables carry business_id and are scoped by the API.
-- Important financial history uses ON DELETE RESTRICT; records are voided, not deleted.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto; -- gen_random_uuid()

CREATE TABLE IF NOT EXISTS schema_migrations (
    version     TEXT PRIMARY KEY,
    applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Businesses and ownership
-- ---------------------------------------------------------------------------
CREATE TABLE businesses (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name                TEXT NOT NULL CHECK (char_length(name) BETWEEN 2 AND 120),
    business_type       TEXT NOT NULL CHECK (char_length(business_type) BETWEEN 2 AND 60),
    owner_name          TEXT NOT NULL CHECK (char_length(owner_name) BETWEEN 2 AND 120),
    contact_email       TEXT NOT NULL CHECK (char_length(contact_email) <= 254),
    contact_phone       TEXT NULL CHECK (contact_phone IS NULL OR char_length(contact_phone) <= 20),
    province            TEXT NOT NULL CHECK (province IN (
                            'eastern_cape','free_state','gauteng','kwazulu_natal','limpopo',
                            'mpumalanga','north_west','northern_cape','western_cape')),
    town                TEXT NULL CHECK (town IS NULL OR char_length(town) <= 120),
    registration_status TEXT NOT NULL DEFAULT 'not_started'
                            CHECK (registration_status IN ('not_started','in_progress','registered','not_sure')),
    currency            CHAR(3) NOT NULL DEFAULT 'ZAR' CHECK (currency = 'ZAR'),
    created_by          UUID NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- user_id is the authenticated subject (Supabase auth.users.id). No FK so the
-- schema also runs on plain PostgreSQL for local development and tests.
CREATE TABLE business_members (
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    user_id     UUID NOT NULL,
    role        TEXT NOT NULL DEFAULT 'owner' CHECK (role IN ('owner')),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (business_id, user_id)
);
CREATE INDEX ix_business_members_user ON business_members(user_id);

CREATE TABLE business_settings (
    business_id                 UUID PRIMARY KEY REFERENCES businesses(id) ON DELETE CASCADE,
    opening_cash_balance_cents  BIGINT NOT NULL DEFAULT 0,
    opening_balance_date        DATE NULL,
    cash_buffer_cents           BIGINT NOT NULL DEFAULT 0 CHECK (cash_buffer_cents >= 0),
    forecast_days               INT NOT NULL DEFAULT 30 CHECK (forecast_days BETWEEN 7 AND 90),
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Customers and receivables (amounts owed TO the business)
-- ---------------------------------------------------------------------------
CREATE TABLE customers (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
    name        TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
    phone       TEXT NULL CHECK (phone IS NULL OR char_length(phone) <= 20),
    email       TEXT NULL CHECK (email IS NULL OR char_length(email) <= 254),
    notes       TEXT NULL CHECK (notes IS NULL OR char_length(notes) <= 1000),
    is_archived BOOLEAN NOT NULL DEFAULT FALSE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_customers_business ON customers(business_id);

CREATE TABLE receivables (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id           UUID NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
    customer_id           UUID NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
    description           TEXT NOT NULL CHECK (char_length(description) BETWEEN 1 AND 200),
    original_amount_cents BIGINT NOT NULL CHECK (original_amount_cents > 0),
    issue_date            DATE NOT NULL,
    due_date              DATE NULL,
    status                TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','settled','written_off')),
    written_off_cents     BIGINT NOT NULL DEFAULT 0 CHECK (written_off_cents >= 0),
    write_off_reason      TEXT NULL CHECK (write_off_reason IS NULL OR char_length(write_off_reason) <= 300),
    notes                 TEXT NULL CHECK (notes IS NULL OR char_length(notes) <= 1000),
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (due_date IS NULL OR due_date >= issue_date)
);
CREATE INDEX ix_receivables_business_status ON receivables(business_id, status);
CREATE INDEX ix_receivables_business_due ON receivables(business_id, due_date);
CREATE INDEX ix_receivables_customer ON receivables(customer_id);

-- ---------------------------------------------------------------------------
-- Suppliers and payables (amounts the business OWES)
-- ---------------------------------------------------------------------------
CREATE TABLE suppliers (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
    name        TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
    phone       TEXT NULL CHECK (phone IS NULL OR char_length(phone) <= 20),
    email       TEXT NULL CHECK (email IS NULL OR char_length(email) <= 254),
    notes       TEXT NULL CHECK (notes IS NULL OR char_length(notes) <= 1000),
    is_archived BOOLEAN NOT NULL DEFAULT FALSE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_suppliers_business ON suppliers(business_id);

CREATE TABLE payables (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id           UUID NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
    supplier_id           UUID NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
    description           TEXT NOT NULL CHECK (char_length(description) BETWEEN 1 AND 200),
    category              TEXT NOT NULL,
    original_amount_cents BIGINT NOT NULL CHECK (original_amount_cents > 0),
    bill_date             DATE NOT NULL,
    due_date              DATE NOT NULL,
    status                TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','paid','cancelled')),
    reference             TEXT NULL CHECK (reference IS NULL OR char_length(reference) <= 80),
    notes                 TEXT NULL CHECK (notes IS NULL OR char_length(notes) <= 1000),
    cancel_reason         TEXT NULL CHECK (cancel_reason IS NULL OR char_length(cancel_reason) <= 300),
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (due_date >= bill_date)
);
CREATE INDEX ix_payables_business_status ON payables(business_id, status);
CREATE INDEX ix_payables_business_due ON payables(business_id, due_date);
CREATE INDEX ix_payables_supplier ON payables(supplier_id);

-- ---------------------------------------------------------------------------
-- Transactions: the cash ledger. Each row is one actual (posted) or planned
-- (scheduled) cash movement. Credit sales and supplier bills are NOT
-- transactions; their payments are (see receivable_payments / payable_payments).
-- ---------------------------------------------------------------------------
CREATE TABLE transactions (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id      UUID NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
    type             TEXT NOT NULL CHECK (type IN ('income','expense')),
    description      TEXT NOT NULL CHECK (char_length(description) BETWEEN 1 AND 200),
    amount_cents     BIGINT NOT NULL CHECK (amount_cents > 0),
    category         TEXT NOT NULL,
    transaction_date DATE NOT NULL,
    payment_method   TEXT NOT NULL CHECK (payment_method IN ('cash','eft','card','mobile_payment','other')),
    payment_status   TEXT NOT NULL DEFAULT 'recorded_manually'
                        CHECK (payment_status IN ('recorded_manually','awaiting_confirmation','confirmed_external','failed','cancelled')),
    status           TEXT NOT NULL DEFAULT 'posted' CHECK (status IN ('posted','scheduled','voided')),
    source           TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','receivable_payment','payable_payment')),
    reference        TEXT NULL CHECK (reference IS NULL OR char_length(reference) <= 80),
    notes            TEXT NULL CHECK (notes IS NULL OR char_length(notes) <= 1000),
    void_reason      TEXT NULL CHECK (void_reason IS NULL OR char_length(void_reason) <= 300),
    voided_at        TIMESTAMPTZ NULL,
    created_by       UUID NOT NULL,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK ((status = 'voided') = (voided_at IS NOT NULL))
);
CREATE INDEX ix_transactions_business_date ON transactions(business_id, transaction_date DESC);
CREATE INDEX ix_transactions_business_status ON transactions(business_id, status);
CREATE INDEX ix_transactions_business_type_cat ON transactions(business_id, type, category);

CREATE TABLE receivable_payments (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id    UUID NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
    receivable_id  UUID NOT NULL REFERENCES receivables(id) ON DELETE RESTRICT,
    transaction_id UUID NOT NULL UNIQUE REFERENCES transactions(id) ON DELETE RESTRICT,
    amount_cents   BIGINT NOT NULL CHECK (amount_cents > 0),
    payment_date   DATE NOT NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_receivable_payments_receivable ON receivable_payments(receivable_id);

CREATE TABLE payable_payments (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id    UUID NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
    payable_id     UUID NOT NULL REFERENCES payables(id) ON DELETE RESTRICT,
    transaction_id UUID NOT NULL UNIQUE REFERENCES transactions(id) ON DELETE RESTRICT,
    amount_cents   BIGINT NOT NULL CHECK (amount_cents > 0),
    payment_date   DATE NOT NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_payable_payments_payable ON payable_payments(payable_id);

-- ---------------------------------------------------------------------------
-- Growth Engine recommendations
-- ---------------------------------------------------------------------------
CREATE TABLE growth_recommendations (
    id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id            UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    rule_code              TEXT NOT NULL,
    fingerprint            TEXT NOT NULL,
    title                  TEXT NOT NULL,
    severity               TEXT NOT NULL CHECK (severity IN ('informational','warning','critical')),
    explanation            TEXT NOT NULL,
    evidence               JSONB NOT NULL DEFAULT '[]'::jsonb,
    relevant_dates         JSONB NOT NULL DEFAULT '[]'::jsonb,
    actions                JSONB NOT NULL DEFAULT '[]'::jsonb,
    estimated_impact_cents BIGINT NULL,
    status                 TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','dismissed','resolved')),
    resolution_note        TEXT NULL,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    status_changed_at      TIMESTAMPTZ NULL
);
-- At most one OPEN recommendation per situation (prevents duplicates).
CREATE UNIQUE INDEX ux_growth_recs_open_fingerprint
    ON growth_recommendations(business_id, fingerprint) WHERE status = 'open';
CREATE INDEX ix_growth_recs_business_status ON growth_recommendations(business_id, status);

-- ---------------------------------------------------------------------------
-- Readiness checklists (definitions live in code; progress lives here)
-- ---------------------------------------------------------------------------
CREATE TABLE registration_checklist_items (
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    item_key    TEXT NOT NULL,
    completed   BOOLEAN NOT NULL DEFAULT FALSE,
    notes       TEXT NULL CHECK (notes IS NULL OR char_length(notes) <= 1000),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (business_id, item_key)
);

CREATE TABLE funding_profiles (
    business_id                  UUID PRIMARY KEY REFERENCES businesses(id) ON DELETE CASCADE,
    funding_purpose              TEXT NULL CHECK (funding_purpose IS NULL OR char_length(funding_purpose) <= 1000),
    amount_requested_cents       BIGINT NULL CHECK (amount_requested_cents IS NULL OR amount_requested_cents > 0),
    business_bank_account_status TEXT NULL CHECK (business_bank_account_status IS NULL OR
                                    business_bank_account_status IN ('has_business_account','uses_personal_account','not_applicable')),
    updated_at                   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE funding_readiness_items (
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    item_key    TEXT NOT NULL,
    completed   BOOLEAN NOT NULL DEFAULT FALSE,
    notes       TEXT NULL CHECK (notes IS NULL OR char_length(notes) <= 1000),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (business_id, item_key)
);

-- ---------------------------------------------------------------------------
-- Public business profile (owner opts in to every public field)
-- ---------------------------------------------------------------------------
CREATE TABLE public_profiles (
    business_id        UUID PRIMARY KEY REFERENCES businesses(id) ON DELETE CASCADE,
    slug               TEXT NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND char_length(slug) BETWEEN 3 AND 80),
    is_published       BOOLEAN NOT NULL DEFAULT FALSE,
    description        TEXT NULL CHECK (description IS NULL OR char_length(description) <= 1000),
    category           TEXT NULL CHECK (category IS NULL OR char_length(category) <= 60),
    products_services  TEXT NULL CHECK (products_services IS NULL OR char_length(products_services) <= 1000),
    show_phone         BOOLEAN NOT NULL DEFAULT FALSE,
    show_email         BOOLEAN NOT NULL DEFAULT FALSE,
    show_town          BOOLEAN NOT NULL DEFAULT TRUE,
    service_area       TEXT NULL CHECK (service_area IS NULL OR char_length(service_area) <= 200),
    opening_hours      TEXT NULL CHECK (opening_hours IS NULL OR char_length(opening_hours) <= 300),
    image_url          TEXT NULL CHECK (image_url IS NULL OR (image_url LIKE 'https://%' AND char_length(image_url) <= 500)),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Opportunities. business_id NULL = shared catalogue; otherwise a private
-- manual entry added by that business.
-- ---------------------------------------------------------------------------
CREATE TABLE opportunities (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id         UUID NULL REFERENCES businesses(id) ON DELETE CASCADE,
    title               TEXT NOT NULL CHECK (char_length(title) BETWEEN 3 AND 200),
    description         TEXT NOT NULL CHECK (char_length(description) <= 4000),
    organisation        TEXT NOT NULL CHECK (char_length(organisation) <= 200),
    opportunity_type    TEXT NOT NULL CHECK (opportunity_type IN ('funding','procurement','supplier_registration','training','market_access','other')),
    industry            TEXT NOT NULL DEFAULT 'any',
    eligibility_criteria TEXT NOT NULL DEFAULT '',
    required_documents  JSONB NOT NULL DEFAULT '[]'::jsonb,
    application_deadline DATE NULL,
    source_url          TEXT NULL CHECK (source_url IS NULL OR source_url LIKE 'https://%'),
    geographic_scope    TEXT NOT NULL DEFAULT 'national',
    verification_status TEXT NOT NULL CHECK (verification_status IN ('verified_official','requires_verification','sample')),
    last_checked_on     DATE NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_opportunities_business ON opportunities(business_id);
CREATE INDEX ix_opportunities_type ON opportunities(opportunity_type);

CREATE TABLE saved_opportunities (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id        UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    opportunity_id     UUID NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
    application_status TEXT NOT NULL DEFAULT 'saved'
                          CHECK (application_status IN ('saved','preparing','applied','successful','unsuccessful','closed')),
    notes              TEXT NULL CHECK (notes IS NULL OR char_length(notes) <= 2000),
    personal_deadline  DATE NULL,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (business_id, opportunity_id)
);

-- ---------------------------------------------------------------------------
-- Fraud incidents (private to the business)
-- ---------------------------------------------------------------------------
CREATE TABLE fraud_incidents (
    id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id            UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    incident_type          TEXT NOT NULL CHECK (incident_type IN (
                               'suspicious_payment_request','fake_proof_of_payment','bank_detail_change',
                               'impersonation','upfront_fee_scam','phishing','urgent_payment_pressure',
                               'credential_request','other')),
    description            TEXT NOT NULL CHECK (char_length(description) BETWEEN 1 AND 2000),
    incident_date          DATE NOT NULL,
    related_transaction_id UUID NULL REFERENCES transactions(id) ON DELETE SET NULL,
    status                 TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','monitoring','resolved')),
    action_taken           TEXT NULL CHECK (action_taken IS NULL OR char_length(action_taken) <= 2000),
    private_notes          TEXT NULL CHECK (private_notes IS NULL OR char_length(private_notes) <= 2000),
    created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_fraud_incidents_business ON fraud_incidents(business_id, incident_date DESC);

-- ---------------------------------------------------------------------------
-- Audit trail (no amounts or personal data in details)
-- ---------------------------------------------------------------------------
CREATE TABLE audit_events (
    id          BIGSERIAL PRIMARY KEY,
    business_id UUID NULL REFERENCES businesses(id) ON DELETE SET NULL,
    user_id     UUID NOT NULL,
    action      TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id   UUID NULL,
    details     JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_audit_events_business ON audit_events(business_id, created_at DESC);

INSERT INTO schema_migrations(version) VALUES ('001_initial_schema');

COMMIT;
