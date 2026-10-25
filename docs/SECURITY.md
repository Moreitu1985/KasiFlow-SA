# KasiFlow SA — Security

This document describes the threat model, the controls that are implemented, how they were tested, and the remaining
limitations. **KasiFlow SA should not be described as production-secure** until the items under "Before production"
are done.

## Assets
- Business financial records (transactions, debts, bills, forecasts), customer/supplier contact details, fraud notes.
- User accounts (managed by Supabase Auth).
- Secrets: database connection string, legacy JWT secret (if used).

## Threats and controls

| Threat | Control | Where |
|---|---|---|
| Unauthenticated access | Fallback authorisation policy requires an authenticated user with a `sub` claim on every endpoint; only `/health*`, `/openapi` (Development) and `/api/public/profiles/{slug}` are anonymous. | `Program.cs` |
| Forged / expired tokens | JwtBearer validates signature (Supabase JWKS for ES256/RS256; optional legacy HS256 secret ≥ 32 chars), issuer `<SupabaseUrl>/auth/v1`, audience `authenticated`, lifetime (30 s skew), allowed algorithms. Inbound claim mapping is off. | `Services/Auth.cs` |
| Client-supplied identity | User id is taken only from the validated token. No endpoint accepts an owner/user id. | `HttpCurrentUser` |
| Insecure direct object references (IDOR) | `BusinessContext` verifies the caller is a member of the business in `X-Business-Id`; every SQL statement filters by `business_id`; cross-business references (customer on a debt, supplier on a bill, related transaction on an incident) are verified. Non-members get 404, not 403. | Services, Repositories |
| SQL injection | All SQL is parameterised (Dapper). The only interpolated identifiers come from fixed in-code whitelists (table names). LIKE input is escaped. | Repositories |
| Supabase Data API exposure | Migration 002 enables RLS with **no policies** on every table and revokes privileges from `anon` and `authenticated`, so the browser's anon key cannot read or write tables via PostgREST. The API connects as the table owner (bypasses RLS) and enforces access in code. | `database/migrations/002_lock_down_data_api.sql` |
| Overpayment / race conditions | Payments run in a DB transaction with `SELECT … FOR UPDATE` on the debt/bill; recommendation refresh uses an advisory lock and a partial unique index. | Bookkeeping & Growth services |
| Invalid data | Server-side validation of every write (amount > 0, ≤ R100m, category per type, date rules, enums, lengths, emails, phones, https URLs, slugs) + DB `CHECK` constraints. | `Validators/`, migrations |
| Abuse / scraping | Rate limits: 300 req/min per user/IP globally, 60/min writes, 20/min exports, 60/min per IP for public profiles. | `Program.cs` |
| Cross-origin abuse | CORS exact-origin allow-list; Production refuses `localhost` and `*`. | `Program.cs` |
| Information leakage | Global exception handler returns generic problem details (trace id only); no stack traces; logs contain method/path, never bodies, amounts or SQL parameters. Public profile returns only opted-in fields. `Cache-Control: no-store` on private API responses. | Middleware |
| Transport | HSTS + HTTPS redirection outside Development. `X-Forwarded-*` headers are trusted from loopback only, unless `App:TrustForwardedHeadersFromAnyProxy` is enabled for hosts reachable solely through their proxy (otherwise clients could spoof IPs to dodge rate limits). | `Program.cs` |
| Anonymous Supabase sessions | Tokens with `is_anonymous=true` are rejected by the authorisation policy. | `Program.cs` |
| Serializer detail leakage | `AllowInputFormatterExceptionMessages = false`, so malformed JSON returns a generic 400. | `Program.cs` |
| Clickjacking / sniffing | `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, restrictive CSP on API responses. | `SecurityHeadersMiddleware` |
| CSV/formula injection | Exported cells starting with `= + @ - TAB CR` (except plain numbers) are prefixed with `'`. | `CsvBuilder` |
| Sensitive data collection | No ID documents, bank credentials, card numbers, PINs or OTPs are collected or stored. Fraud guidance tells users never to share them. | Product design |
| Secrets in source | Connection strings and secrets come from environment variables / user-secrets / host secret managers; `.gitignore` excludes env files; frontend env contains only the Supabase anon/publishable key and the API URL. | Config |

## Automation platform controls (Brief 2)
| Threat | Control |
|---|---|
| Forged or replayed provider webhooks | HMAC-SHA256 over the raw body with a fixed-time comparison; SnapScan webhooks are additionally re-confirmed through the authenticated API before they are trusted; events are unique per connection + provider event id, so replays are acknowledged and ignored. |
| Provider secrets leaking | API/webhook keys live only in server configuration (`Integrations__…`). The database stores a credential *name* (regex-restricted, so a pasted secret is rejected). Secrets are never returned by the API or sent to the browser. |
| Webhook abuse / DoS | Per-IP rate limit, 64 KB body cap, unknown/disconnected connections rejected; every delivery logged with a body SHA-256 only (no payload). |
| Simulated data mistaken for real | Sandbox only on `is_demo` businesses, `demo_simulation` origin label, SANDBOX badge, separate `environment` column, one-click reset. A connection shows *Connected* only after a genuine test. |
| Privilege escalation by staff | Role permissions enforced server-side on every endpoint (403); branch scoping in SQL; nobody changes their own role; ownership cannot be assigned; only the owner manages administrators; self-approval of stock adjustments and cash-up reviews is blocked (except the owner). |
| Invitation hijacking | 256-bit random token, stored as SHA-256 only, single use, 7-day expiry, bound to the invited email. |
| Double counting / lost events | Durable PostgreSQL job queue (`SKIP LOCKED`), idempotent handlers, unique keys on events, payments, stock source keys and `Idempotency-Key`; payment state machine only moves forward; amounts never changed to force a match. |
| Unfair accusations | Anomaly and cash-up wording is evidence-based and explicitly non-accusatory; staff performance shows caveats. |
| Card/PII data | KasiFlow stores no card numbers, PINs, banking passwords or OTPs; provider payloads are normalised and only needed fields are kept. |

## Barbershop platform controls (Brief 3)
- **Append-only audit.** A trigger on `audit_events` rejects UPDATE and DELETE. The only exception is setting
  `business_id` to null when a business is deleted.
- **No double booking.** An exclusion constraint (btree_gist) prevents overlapping confirmed bookings per barber, plus
  a server-side check under an advisory lock.
- **Public booking tokens** are random, returned once and stored only as SHA-256 hashes. Lookups compare hashes.
  Requests are rate-limited, with at most 3 pending requests per phone number. Public responses contain no internal
  IDs beyond what the customer needs, no addresses and no other customers' data.
- **House-call addresses** are visible only to staff with booking permissions. They are never on the public profile.
- **Payment proofs.** The file type is checked from its first bytes (PNG, JPEG or PDF only). Files are limited to 2 MB,
  hashed with SHA-256, and served as attachments with `X-Content-Type-Options: nosniff`. A proof never changes a
  payment to confirmed on its own.
- **Supplier bank details.** Only the last 4 digits and an HMAC-SHA256 fingerprint are stored. Set
  `Security:FingerprintKey`; otherwise a key is derived from the connection string and a warning is logged. Changes
  stay unverified until approved by a user with `verifySupplierBankDetails`.
- **Debt charges.** Only the owner can configure them. A charge is applied only when the policy is enabled, legally
  reviewed and was disclosed for that debt. The database allows at most one charge per event. Waiving or reversing
  needs a reason and is audited.
- **Alerts** are worded as things to check, never as accusations. Status changes are audited.
- **Staff privacy.** Statuses are self-reported. There is no location tracking or monitoring.

## Customers and safety controls (Brief 4)
- Customer identity = the Supabase-verified email/phone claim from the validated token; customer endpoints never accept a business header and only return the caller's own bookings/profile. Business endpoints return 404 to customer-only accounts.
- Booking creation requires a verified sign-in; house calls additionally need a complete profile and accepted, versioned terms. Blocks are manual, reasoned and audited.
- Safety check-ins are append-only (trigger) and audited; location is opt-in per check-in; no background tracking. Safety alerts are not auto-closed by rules.
- Business sees a customer's account summary only through its own bookings (counts are per business). Staff contact/emergency fields are returned only to managers and the person themself, and never in public responses.
- Portfolio uploads require recorded consent, are content-sniffed (JPEG/PNG/WebP), size-limited, and served publicly only while the profile is published and the photo is public; internal file route requires business access.
- Invitations bound to a barber profile are single-use, hash-stored, email-bound and expire in 7 days.

## Data handling
- Audit events record action, entity type and id — no amounts or personal data.
- Demo/seed data is fictional and labelled "(fictional)".
- Fraud incidents are private to the business and must not be used to publish allegations about identifiable people.

## How the controls were tested
- **Automated (xUnit)**: validation of zero/negative amounts, categories, dates and reserved statuses; business ownership
  (`BusinessContext`) with other users' ids, unknown ids and malformed headers; public-profile projection; integration
  tests (with `KASIFLOW_TEST_DATABASE`) for unauthenticated/expired tokens, cross-business transaction access and payments.
- **End-to-end (build environment, PostgreSQL 16, 95 checks)**: no / wrong-secret / wrong-audience / wrong-issuer / expired
  tokens → 401; user B cannot read, update, void, pay, export or reference user A's business, transactions, debts,
  incidents, private opportunities or tracking; slug conflicts; unpublished profiles hidden; security headers present.
  These used HS256 test tokens via an offline compatibility shim (see limitations).

- **Automation (build environment)**: 119 unit tests and 224 end-to-end HTTP checks, including forged signatures, duplicate
  deliveries, cross-role access (cashier, accountant, deactivated member), branch scoping, invitation misuse, and the
  SnapScan adapter against a local mock of the documented API (signature, API re-confirmation, polling, dedupe).

## Remaining limitations / before production
1. **Run the real build and tests**: the API was verified offline with compatibility shims (Npgsql 2.2, a minimal Dapper,
   an HS256-only JWT handler) because NuGet was unreachable. Run `dotnet test` with the real packages and repeat the
   end-to-end checks against a staging Supabase project, **including ES256 tokens via JWKS**.
2. Configure Supabase Auth: email confirmation on, strong password policy, leaked-password protection, rate limits, and
   redirect URL allow-list; consider MFA.
3. Use a dedicated least-privilege database role for the API instead of `postgres` (it must own or be granted the KasiFlow
   tables; keep RLS deny-all for Data-API roles).
4. Enable centralised logging/alerting on the host; review rate-limit values with real traffic.
5. The rate limiter is in-memory per instance; use a distributed limiter if you scale out.
6. Add a privacy notice and POPIA-aligned data-retention/deletion process (account and business deletion are not yet
   self-service).
7. Tenant consistency is enforced in the service layer (every referenced customer/supplier/transaction is checked to belong to the same business). Adding composite foreign keys `(id, business_id)` in the database would add defence in depth.
8. Dashboard snapshots read several queries outside one transaction; a write landing mid-request can make one response briefly inconsistent (the next request is correct).
9. Dependency scanning (`npm audit`, `dotnet list package --vulnerable`) in CI.
10. **SnapScan has not been tested against a live merchant account.** Test with real credentials in a staging environment before relying on it.
11. Set `Integrations__SandboxSigningKey` in every environment; run the background worker on exactly the instances you intend (`Automation__EnableWorker`).
12. Webhook endpoints are public by design; put them behind the same TLS and WAF as the API, and monitor `webhook_deliveries` for spikes of rejected signatures.
13. Set `Security__FingerprintKey` in production. Changing it later changes fingerprints; the seeded/stored ones would then not match.
14. Payment proofs are stored in PostgreSQL (`bytea`, ≤2 MB). For high volume move them to private object storage with signed URLs and a virus scan.
