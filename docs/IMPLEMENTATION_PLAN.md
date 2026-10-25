# KasiFlow SA — Implementation plan and checklist

Legend: ✅ done and exercised · ⚠️ done, verified only with offline substitutes / needs your environment · ⏳ planned

## Build environment note

The code was written in a sandbox where **nuget.org was blocked**. The verification strategy was:

- `KasiFlow.Core` has no NuGet dependencies → built with the real .NET 10 SDK.
- `KasiFlow.Api` and the tests were compiled against signature stubs, then **run end-to-end** using runtime shims:
  Ubuntu's Npgsql 2.2 driver, a minimal Dapper implementation and an HS256-only JWT handler, against PostgreSQL 16.
- 73 unit tests ran (xUnit test code executed by a reflection runner); 95 HTTP end-to-end checks ran against the live
  API; the React app was driven in Chromium (Playwright) against that API.

**Update 2026-10-16:** the solution was built with the real NuGet packages on Windows (.NET SDK 10): build succeeded and
`dotnet test` reported 73 passed, 0 failed, 5 integration tests skipped (they need `KASIFLOW_TEST_DATABASE`).
`Microsoft.OpenApi` is pinned to 2.7.5 to avoid GHSA-v5pm-xwqc-g5wc.

## Phase 1 — Foundation
- ✅ Inspect workspace (only `README.md` + git remote existed)
- ✅ Solution structure (`KasiFlowSA.sln`, Core / Api / Api.Tests, `kasiflow-web`, `database`, `docs`)
- ✅ React + TypeScript strict + Vite + Tailwind; production build and lint clean
- ✅ ASP.NET Core API (.NET 10), options, DI, problem details, OpenAPI + Swagger UI (Development)
- ✅ PostgreSQL migrations (001 schema, 002 Supabase Data-API lock-down, 003 opportunity catalogue) + `migrate` CLI
- ✅ Health checks `/health`, `/health/ready`
- ✅ Responsive layout: desktop sidebar, mobile drawer + bottom tabs + floating Record button

## Phase 2 — Authentication and business setup
- ✅ Supabase sign-up / sign-in / sign-out / email confirmation state / forgot + reset password (frontend)
- ⚠️ API token validation: issuer, audience, lifetime, HS256 legacy secret ✅ (tested via shim); ES256/RS256 via JWKS ⚠️ (implemented, not tested against a live project)
- ✅ Protected routes and fallback authorisation policy
- ✅ Business onboarding wizard + settings (opening balance, buffer, horizon)
- ✅ Ownership enforcement (`BusinessContext`, business_id on every query) + tests

## Phase 3 — Bookkeeping
- ✅ Transactions CRUD with posted / scheduled / void (no hard delete), filters, search, paging, detail
- ✅ Customers, receivables, partial payments, settle, write-off, reminder templates (copy / WhatsApp link)
- ✅ Suppliers, payables, partial payments, paid, cancel
- ✅ Financial summaries (cash, income, expenses, net result, category breakdown, monthly)
- ✅ Validation (server + client) and tests

## Phase 4 — Growth Engine
- ✅ Deterministic daily forecast (expected + conservative, buffer, exclusions, assumptions)
- ✅ 9 rules with evidence, dates, actions and calculated impact
- ✅ De-duplication via fingerprints + partial unique index + reconciliation (update / respect dismissals / auto-resolve)
- ✅ Growth Engine page: risk headline, chart with shortage shading, daily table (Cash Flow page), filters, evidence links, status actions, rules + assumptions
- ✅ Edge-case tests (empty business, income-first, expenses before expected income, overdue, partial, settled, unconfirmed, horizon bounds)

## Phase 5 — Growth support
- ✅ Registration guidance (8 steps, official links checked 2026-10-16, disclaimer, progress)
- ✅ Public business profile (opt-in fields, stable slug, anonymous page, rate limited)
- ✅ Opportunities (verification labels, private entries, save, tracking)
- ✅ Funding readiness (6 automatic + 4 manual items, funding profile, transparent %)
- ✅ Fraud protection (education, pre-payment checklist, incident log)

## Phase 6 — Reporting and polish
- ✅ Reports page + CSV exports (8 kinds, formula-injection safe, UTF-8 BOM)
- ✅ Printable business summary (browser "Save as PDF")
- ✅ Mobile check at 390 px: no horizontal page scroll (wide tables scroll inside their cards)
- ✅ Loading / error / empty / success states
- ✅ Deployment config: `Dockerfile`, `vercel.json`, CI workflow, environment documentation

## Phase 7 — Hackathon readiness
- ✅ Fictional demo seed (Thato's Barber Studio) with numbers that reconcile (see header of `database/seed/demo_seed.sql`)
- ✅ Repeatable demo journey (README)
- ✅ `dotnet build` / `dotnet test` with real packages (73 passed)
- ⚠️ Run the 5 integration tests against a disposable PostgreSQL and test against a staging Supabase project
- ⏳ Deploy API + web and add production URLs to Supabase Auth and CORS

## Brief 2 — Automation and connected business platform (see docs/AUTOMATION.md)
- ✅ A: Migration `004_automation_platform.sql` (branches, staff, invitations, shifts, integrations, events, payments, settlements, reconciliation, inventory, notifications, durable jobs); RBAC retrofit of every service
- ✅ B: Provider adapter interface, SnapScan adapter (docs-verified, mock-tested), sandbox adapter, webhook ingestion, durable worker, scheduled sync, retries / dead jobs / manual retry
- ✅ C: Ingestion → ledger with origin labels, payment state machine, refunds, reversals, settlements (gross/fees/net), reconciliation centre
- ✅ D: Event-driven Growth Engine, expected/conservative/optimistic scenarios, preliminary flag, 7 anomaly rules
- ✅ E: Staff & branches, invitations, role changes, shifts and cash-up, staff performance with caveats
- ✅ F: Inventory: products, levels, movements, approvals, transfers, idempotent sale/POS decrements, reorder suggestions
- ✅ G: In-app notifications, preferences, daily briefing (email shown as unavailable — no provider configured)
- ✅ H: Frontend: Integrations Centre, Reconciliation, Staff, Shifts, Inventory, Briefing, notification bell, SANDBOX badge, role-aware navigation, optimistic forecast line
- ✅ Tests: 119 unit tests, 224 e2e checks (build environment); 15 acceptance requirements mapped in AUTOMATION.md §11
- ⚠️ Run `dotnet run -- migrate` (applies 004) and `dotnet test` with the real packages; test SnapScan with a real merchant account
- ⏳ Yoco (awaiting provider access), other POS, accounting sync, barcode scanning, email/SMS/WhatsApp
- ⏳ CSV import of sales (`imported_file` origin is reserved)

## Brief 3 — Barbershop-first restructure (see docs/BARBERSHOP.md §11 for the full checklist)
- ✅ Migration `005_barbershop_platform.sql`: staff profiles/status/hours/time off, services, bookings (exclusion
  constraint), house calls, debt charges and reminders, alerts, payment proofs, supplier bank details, append-only audit.
- ✅ Core rules: availability and staleness, booking state machine, pricing and travel fee, house-call economics, debt
  balance and R5 safeguards, 9 new alert/insight rules.
- ✅ API: workspace, team, services, policies, bookings, public booking, house calls, debts, money summary, alerts,
  payment proofs, supplier bank details.
- ✅ Frontend: role-based navigation and the new pages listed in BARBERSHOP.md.
- ✅ Tests: 161 unit tests, 311 end-to-end checks, 64 frontend tests; all 10 required scenarios mapped.
- ⚠️ Apply migrations 004 and 005 to Supabase and run the real `dotnet test`.
- ⏳ Maps provider for live distance, a messaging provider for reminders, online deposits.

## Brief 4 — Customers, barbers and house-call safety (see docs/CUSTOMERS_AND_SAFETY.md)
- ✅ Migration 006: customer accounts, verified bookings, append-only safety check-ins, safety notes, house-call blocks, barber profile details, login invitations bound to a profile, portfolio photos
- ✅ Customer one-time-code sign-in (email; SMS behind a flag once a provider is configured), My bookings, account and data deletion
- ✅ Booking requires verification; house calls require a complete account; per-shop house-call blocks
- ✅ House-call safety: ordered check-ins, help/all-clear, opt-in location per check-in, background late-check-in alerts, emergency advice
- ✅ Owner "Register a barber" with invite link; barber login lands on their own workspace; portfolio with consent; public catalogue
- ✅ Tests: 80 e2e checks, 10 unit tests, 16 frontend tests
- ⚠️ Configure the Supabase Magic Link template (`{{ .Token }}`), redirect URLs and custom SMTP before real customers
- ⏳ SMS codes (needs an SMS provider in Supabase), customer notifications, push alerts for safety

## Known gaps / planned
- ⏳ Screen to add a second business (API supports up to 5; the switcher appears when more exist)
- ⏳ Account / business deletion and data export for POPIA requests
- ⏳ Pre-payment checklist on the Fraud page is not persisted (stated in the UI)
- ⏳ Profile image upload (MVP accepts an https image URL)
- ⏳ Live opportunity feed, explainability assistant (extension points documented in ARCHITECTURE.md)
- ⏳ Recurring transactions (regular sales/costs must currently be scheduled individually; the forecast says so)
- Voiding a payment on a written-off debt is blocked (409) to keep closed debts consistent.
- An independent code review was run; its findings (forwarded-header trust, anonymous sessions, written-off voids, export filtering/truncation notice, safer row locks, bill payment date check, serializer messages) were fixed. Composite tenant foreign keys and snapshot read consistency are listed in SECURITY.md as hardening items.
