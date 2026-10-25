# KasiFlow SA — Architecture

## Overview

```
 Browser (React SPA on Vercel)
   │  supabase-js: sign-up / sign-in / reset  ──────────────►  Supabase Auth
   │  fetch + Authorization: Bearer <access token>
   │        + X-Business-Id: <uuid>
   ▼
 ASP.NET Core Web API (.NET 10, modular monolith, container)
   │  JWT validation (issuer, audience "authenticated", lifetime, signature via JWKS or legacy secret)
   │  Rate limiting · CORS allow-list · Problem details · Security headers
   │  Controllers → Services (business rules, authorisation, transactions)
   │             → Repositories (parameterised SQL via Dapper)
   │             → KasiFlow.Core (pure, deterministic calculations & Growth Engine)
   ▼
 PostgreSQL (Supabase) — RLS enabled with no policies for Data-API roles (deny-all);
                          API connects with a server-side role.
```

The browser **never** talks to PostgreSQL. The Supabase client in the browser is used for authentication only.

## Projects

| Project | Responsibility | Dependencies |
|---|---|---|
| `KasiFlow.Core` | Domain constants, money formatting, periods, `FinancialCalculator`, `BalanceMath`, `CashFlowForecaster`, Growth Engine rules + reconciliation, readiness catalogues, validation helper, slug, CSV | none (BCL only) |
| `KasiFlow.Api` | HTTP, auth, authorisation, persistence, orchestration | Core, Npgsql, Dapper, JwtBearer, OpenApi, SwaggerUI |
| `KasiFlow.Api.Tests` | xUnit unit + integration tests | Api, Core, xUnit, Mvc.Testing |
| `kasiflow-web` | SPA | React, Router, TanStack Query, RHF, Zod, Tailwind, Radix, Recharts, supabase-js |

Keeping all calculations in `KasiFlow.Core` with no I/O makes them deterministic and testable, and lets a future
"explainability assistant" consume `RecommendationDraft`s without touching the maths.

## API layering

```
Controllers/   thin; map HTTP ↔ DTOs, [Authorize] by default (fallback policy), rate-limit attributes
DTOs/          request/response records (entities never leave the API)
Validators/    RequestValidators — server-side validation, field names match JSON
Services/      Auth (JWKS, current user, BusinessContext), Bookkeeping, Growth, Dashboard, Reports,
               Readiness, PublicProfile, Opportunities, Fraud, Payments (provider interface), Mappers
Repositories/  SQL per aggregate; every statement filters by business_id; row locks for payments
Models/        Dapper row classes
Data/          connection factory, Dapper setup (snake_case, DateOnly), migrate / seed-demo CLI
Middleware/    exception → problem details, security headers
Configuration/ options classes bound from configuration / environment
```

### Request flow (e.g. record a debt payment)

1. JwtBearer validates the token → `sub` claim is the user id (`ICurrentUser`).
2. `BusinessContext` reads `X-Business-Id`, checks membership in `business_members` (404 if not a member).
3. `ReceivableService.RecordPaymentAsync` validates input, opens a DB transaction, `SELECT … FOR UPDATE` on the debt,
   checks the remaining balance with `BalanceMath`, inserts the income transaction and the payment link, updates status,
   writes an audit event, commits.
4. The next dashboard / Growth Engine request recomputes the snapshot and reconciles recommendations.

## Data model

```
businesses 1─* business_members (user_id = Supabase auth user)
businesses 1─1 business_settings, funding_profiles, public_profiles
businesses 1─* transactions ─┬─ receivable_payments *─1 receivables *─1 customers
                             └─ payable_payments    *─1 payables    *─1 suppliers
businesses 1─* growth_recommendations (unique open fingerprint)
businesses 1─* registration_checklist_items, funding_readiness_items (keys defined in Core catalogues)
opportunities (business_id NULL = shared catalogue) 1─* saved_opportunities *─1 businesses
businesses 1─* fraud_incidents (optional related transaction)
audit_events (no amounts or personal data)
```

- UUID primary keys, `TIMESTAMPTZ` timestamps, `BIGINT` cents with `CHECK (> 0)`, `CHECK` constraints for every status/enum.
- Financial history uses `ON DELETE RESTRICT`; records are voided, not deleted.
- Indexes on `(business_id, transaction_date)`, `(business_id, status)`, `(business_id, due_date)`, membership by user.
- Migrations are plain SQL in `database/migrations`, applied in order by `dotnet run -- migrate` and tracked in
  `schema_migrations`.

## Frontend

- `src/lib/apiClient.ts` is the single HTTP client: base URL from env, fresh Supabase access token per request,
  `X-Business-Id`, RFC 7807 parsing, CSV downloads, sign-out on 401.
- TanStack Query keys include the active business id; mutations invalidate dependent queries (transactions → dashboard,
  growth, reports).
- Route-level code splitting; Recharts loaded only on chart pages.
- Money is formatted deterministically (`R1,500.00`) and rand input is parsed to cents by string arithmetic.

## Extension points

| Extension | Where |
|---|---|
| Payment provider verification | `IPaymentVerificationProvider` (Services/Payments.cs) + a signed webhook endpoint; only then set `confirmed_external`. |
| Live opportunity feed | Insert into `opportunities` with `business_id NULL`, a `source_url`, `verification_status` and `last_checked_on` from a scheduled importer. |
| Explainability assistant | Consume `RecommendationDraft` / `ForecastResult` from Core; never let it compute balances. |
| Messaging (reminders) | Add a provider behind a service interface with explicit owner consent; templates already exist in the UI. |

## Automation platform (Brief 2)

The automation layer (provider adapters, webhook ingestion, durable PostgreSQL job queue and worker, reconciliation,
staff roles and branches, shifts, inventory, notifications and the daily briefing) is described in
[`AUTOMATION.md`](AUTOMATION.md). It keeps the same layering: pure rules in `KasiFlow.Core` (payment state machine,
reconciliation policy, cash-up, reorder, signatures, permissions, anomaly rules), Dapper SQL in repositories, and thin
controllers. Authorisation moved from "member of the business" to role permissions checked by `IBusinessContext.RequireAsync`.


## Barbershop platform (Brief 3)

- **Core** (pure, unit-tested): `Bookings/StaffAvailability.cs` (effective status, slot finder, why-not reasons),
  `Bookings/BookingRules.cs` (state machine, pricing, house-call economics), `Finance/DebtRules.cs` (balance,
  charge policy evaluation), `Growth/AlertRules.cs` (alert and insight rules).
- **API services** live in `KasiFlow.Api/Services/Barbershop/`:
  - `TeamService` and `ServiceCatalogService`
  - `PolicyService`
  - `BookingEngine`: shared by staff and public booking; handles locking and conflict checks.
  - `BookingService` and `PublicBookingService`
  - `DebtService` and `DebtChargeEvaluator`
  - `MoneyService`
  - `AlertService`, `PaymentProofService` and `SupplierBankService`
- **Automation.** The durable `JobWorker` expires timed statuses. Each growth refresh:
  1. evaluates debt charges;
  2. runs all rules;
  3. sends alert codes to the `alerts` table (upsert by fingerprint, auto-resolve) and the rest to recommendations.
- **Frontend** (`kasiflow-web/src/features/`): workspace, team, bookings, house-calls, services, debts, money, alerts,
  payments, expenses, business-profile and public-booking. Navigation is built from the user's permissions; the server
  still enforces every permission.


## Role experiences (one app per actor)

`KasiFlow.Core/Access/RoleExperiences.cs`:

- **`AppExperience`** (abstract) is the abstraction for any app in KasiFlow. It has a title, a purpose, a home page, screens in menu order and phone tabs. Subclasses only declare what they *want*; the base class decides what they *get* through the abstract `Allows(screen)` gate. The computed screen list is private and read-only.
- **`RoleExperience : AppExperience`** covers business roles. It seals `Allows` so a role can only receive screens its permissions allow: a subclass can hide a screen but never leak one. The concrete roles are `OwnerExperience`, `AdminExperience`, `ManagerExperience`, `ReceptionExperience`, `BarberExperience` and `AccountantExperience`.
- **`CustomerExperience : AppExperience`** is the customer app: Find a barber, My bookings and My account. It contains no business screens at all.
- **`ScreenCatalog`** is the single list of screens (path, label, group, required permissions). **`RoleExperiences.For(role)`** is the factory; an unknown role gets the smallest app.

`/api/me` returns each membership's experience; `/api/customer/me` returns the customer's. In the web app, `lib/experience.ts` wraps either one in an `Experience` object, and the business shell and the customer shell both draw their menus, tabs, landing page and route guard from it. The API still checks every request.

**Business stats are owner-only.** `ViewBusinessInsights` is held only by the owner. It covers:
- the overview dashboard and money summary;
- the cash forecast and Growth Engine;
- reports and staff performance;
- the money parts of the daily briefing and cash warnings.

Admins, managers and accountants get 403 from those endpoints, and the screens don't appear in their apps.

| Role | App | Lands on | Screens |
|---|---|---|---|
| Owner | Owner app | Business overview | Everything, including business stats and trends, Shop insights and Barber pay |
| Admin | Administrator app | Today on the floor | Everything except business stats and trends, and the debt-charge policy |
| Business manager | Manager app | **Today on the floor** (`/api/floor`) | Floor, Walk-in queue, My earnings, House-call map, Bookings, Workspace, House calls, Payments, Debts, Expenses, Transactions, Staff, Shifts, Inventory, Services, Alerts, Integrations, Reconciliation |
| Cashier / receptionist | Front desk app | Bookings | Walk-in queue, House-call map, Bookings, Workspace (who is free), Payments, Debts, Transactions, Shifts, Inventory, Fraud guide |
| Barber | Barber app | My day (Workspace) | Workspace (status, day, hours, time off, safety, My work), Walk-in queue (call next / finish), their own Bookings, My earnings |
| Accountant | Accountant app (read-only) | Transactions | The books: transactions, payments, debts, expenses, customers, bills, alerts. No stats or trends |
| Customer | Customer app | My bookings | Find a barber (`/api/public/shops`), shop catalogue and booking, My bookings, Account |
