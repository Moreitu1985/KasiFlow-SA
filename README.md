# KasiFlow SA

**Know your numbers. Protect your cash. Grow your business.**

> **Now barbershop-first.** The demo business is *Thato's Barber Studio*. It covers barber statuses, bookings
> (including public online booking), house calls, services, customer debts with R5-charge safeguards, separated money
> figures and a Fraud & Alerts Centre. See **[docs/BARBERSHOP.md](docs/BARBERSHOP.md)** for the rules and the
> implementation checklist. Customers book with a **one-time email code**; barbers get their own login and screen; house
> calls need a complete customer account and include barber safety check-ins — see
> **[docs/CUSTOMERS_AND_SAFETY.md](docs/CUSTOMERS_AND_SAFETY.md)** (includes the Supabase email-code setup). Walk-in queue, barber pay,
> the house-call map and owner shop insights: **[docs/QUEUE_PAY_INSIGHTS.md](docs/QUEUE_PAY_INSIGHTS.md)**.

KasiFlow SA is a mobile-first business management and growth platform for South African township and rural
entrepreneurs — spaza shops, barbers and salons, food vendors, clothing and retail, freelancers and other micro
businesses. It connects everyday records (sales, expenses, customer debts, supplier bills) to understandable
financial insight and practical next steps:

| Stage | What KasiFlow does |
|---|---|
| **Capture** | Record sales and expenses, customer debts and part payments, supplier bills and payments. |
| **Understand** | Cash balance, income, expenses, net recorded result, category and monthly reports, a 30-day cash-flow forecast. |
| **Protect** | Fraud-awareness centre (fake proof of payment, bank-detail-change scams, upfront-fee "funding" scams, OTP requests) and a private incident log. |
| **Prepare** | Registration guidance with official South African resources, a transparent funding-readiness checklist and an exportable business summary. |
| **Grow** | Opportunity tracker (clearly labelled verified / requires verification / sample), and a shareable public business profile. |

### The KasiFlow Growth Engine

The flagship feature. A **deterministic, rules-based** engine (no AI model, no guessing) that:

1. projects your daily cash position for the next 7–90 days from recorded cash, scheduled transactions,
   customer debts (as *expected*, not guaranteed) and supplier bills;
2. detects situations such as a projected shortage, dipping below your safety buffer, relying on customers paying on time,
   overdue debts and bills, unusually high spending (only with enough history), debt concentrated in one customer and
   missing information;
3. explains **what** it found, **which records and dates** caused it, **why it matters**, and **what you could do next** —
   every recommendation links back to the underlying records.

Example (the included demo data): Thato's Barber Studio has R1,500.00 recorded, a R1,450.00 supplier bill due in 3 days
and R150.00 of planned airtime on day 5, while the R1,200.00 expected from a customer only arrives on day 9. The engine
reports *"Potential cash shortage in 5 days"*, shows the projected balance of −R100.00, lists the bill, the planned expense
and the late-arriving expected payment as evidence, and suggests concrete actions — without claiming any action guarantees
recovery.

> KasiFlow does **not** process payments, verify bank accounts, register businesses, or submit anything to government
> systems. Figures are owner-recorded, cash-basis records — not audited statements, tax returns or credit scores.

---

## Repository layout

```
KasiFlow-SA/
├── KasiFlow.Core/          Pure domain library (no NuGet deps): money, periods, financial calculator,
│                           cash-flow forecaster, Growth Engine rules, readiness catalogues, validation, CSV
├── KasiFlow.Api/           ASP.NET Core Web API (.NET 10): Controllers, DTOs, Services, Repositories (Dapper +
│                           Npgsql), Validators, Middleware, Configuration, Data (migrations/seed CLI)
├── KasiFlow.Api.Tests/     xUnit: Core (calculations, forecast, Growth Engine), Api (validation, ownership),
│                           Integration (WebApplicationFactory + PostgreSQL, opt-in)
├── kasiflow-web/           React 19 + TypeScript (strict) + Vite + Tailwind + TanStack Query + RHF/Zod + Recharts
├── database/
│   ├── migrations/         Version-controlled SQL migrations (001 schema, 002 Supabase Data-API lock-down, 003 catalogue)
│   └── seed/demo_seed.sql  Fictional "Thato's Barber Studio" demo data (dates relative to today)
├── docs/                   PROJECT_SPECIFICATION, ARCHITECTURE, API, SECURITY, IMPLEMENTATION_PLAN
├── Dockerfile              API container image
└── .github/workflows/ci.yml  Build + test (API with a Postgres service, web lint/test/build)
```

---

## Quick start (local development)

### Prerequisites

- .NET 10 SDK (`dotnet --version` → 10.x)
- Node.js 22 + npm
- A Supabase project (free tier is fine) — used for **authentication** and as the **PostgreSQL** database.
  You can also use any PostgreSQL 14+ for the database and keep Supabase for auth only.

### 1. Supabase

1. Create a project at supabase.com.
2. **Project Settings → API**: copy the **Project URL** and the **anon / publishable key** (for the frontend only).
3. **Authentication → URL configuration**: set the Site URL to `http://localhost:5173` and add
   `http://localhost:5173/reset-password` and `http://localhost:5173/sign-in` to the redirect URLs.
4. **Connect** (top bar) → copy a PostgreSQL connection string. Use the **direct connection** or the **session pooler**
   (port 5432). Convert it to Npgsql format, e.g.
   `Host=aws-0-xx.pooler.supabase.com;Port=5432;Database=postgres;Username=postgres.<ref>;Password=<password>;SSL Mode=Require`
5. Tokens: new Supabase projects sign access tokens with **asymmetric JWT signing keys** — the API fetches the public keys
   from `<SupabaseUrl>/auth/v1/.well-known/jwks.json` automatically. If your project still uses the legacy shared secret,
   also set `Auth__JwtSecret` (Project Settings → JWT Keys → Legacy JWT secret). Never put it in the frontend.

### 2. API

```bash
cd KasiFlow.Api
dotnet user-secrets set "Database:ConnectionString" "<your Npgsql connection string>"
dotnet user-secrets set "Auth:SupabaseUrl" "https://<project-ref>.supabase.co"
# only for legacy HS256 projects:
# dotnet user-secrets set "Auth:JwtSecret" "<legacy jwt secret>"

# automation (see docs/AUTOMATION.md) — any 32+ character random string:
dotnet user-secrets set "Integrations:SandboxSigningKey" "<random 32+ chars>"
# optional, SnapScan (only after SnapScan gives you merchant API access):
# dotnet user-secrets set "Integrations:SnapScan:Credentials:main:ApiKey" "<api key>"
# dotnet user-secrets set "Integrations:SnapScan:Credentials:main:WebhookKey" "<webhook authentication key>"

# optional: key for supplier bank-detail fingerprints (any 32+ char random string; falls back to a derived key)
# dotnet user-secrets set "Security:FingerprintKey" "<random 32+ chars>"

dotnet run -- migrate            # applies database/migrations (idempotent; 004 automation, 005 barbershop — needs btree_gist, available on Supabase)
dotnet run                       # http://localhost:5080  — Swagger UI at /swagger (Development only)
```

Health: `GET /health` (process) and `GET /health/ready` (database reachable).

### 3. Web app

```bash
cd kasiflow-web
cp .env.example .env.local       # set VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, VITE_API_BASE_URL=http://localhost:5080
npm install                      # re-run after updates (qrcode was added for the profile QR code)
npm run dev                      # http://localhost:5173
```

### 4. Demo account (fictional data)

1. Sign up in the web app with an email you control and confirm it (this creates the Supabase user — no passwords are
   stored in this repository).
2. Find the user's id in Supabase → Authentication → Users.
3. Seed the fictional demo business for that user:

```bash
cd KasiFlow.Api
dotnet run -- seed-demo --user-id <supabase-user-uuid>
# or: psql "<connection string>" -v user_id=<uuid> -f ../database/seed/demo_seed.sql
```

The seed refuses to run in Production unless `--allow-production` is passed, and does nothing if the demo business
already exists for that user. All names, numbers and messages in it are invented and labelled "(fictional)".

### 5. Tests

```bash
dotnet test                                     # unit tests (calculations, forecast, Growth Engine, validation, ownership)
KASIFLOW_TEST_DATABASE="Host=localhost;Username=postgres;Password=postgres;Database=kasiflow_test" dotnet test
                                                # + integration tests against a DISPOSABLE database
cd kasiflow-web && npm test && npm run lint && npm run build
```

---

## Demonstration journey

**Barbershop journey (Brief 3):**
1. **Barber Workspace**: set your status (Available / Busy / On a house call / On break / Unavailable / Off duty), see
   today's customers, edit working hours and time off. Colleagues' statuses appear alongside yours.
2. **Bookings**: confirm Lwazi's request, propose a new time, complete a visit with payment or as a debt.
3. Open `/p/thatos-barber-studio-demo/book` in a private window to book as a customer. Neo is off duty, so he is not
   offered. A house call shows its travel fee before you submit.
4. **Debts**: Tumi owes R150 (R200 − R50). The R5 charge shows as *proposed only* until the policy is enabled,
   legally reviewed and was disclosed to that customer.
5. **Money**: sales vs received vs unpaid vs expenses vs estimated contribution, by day, week or month.
6. **Alerts**: cash-up variance, booking/payment mismatch, unverified proof and supplier bank change. Each can be moved
   to Under review, Resolved or False positive.

**General bookkeeping journey:**

1. Sign in → the dashboard of *Thato's Barber Studio* loads real records from the API.
2. **Record sale** / **Record expense** from the dashboard; the cash balance, income and charts update.
3. **Customers & Debts**: Sipho owes R400.00 (overdue); Lerato owes R1,200.00 (due in 9 days); record a part payment.
4. **Suppliers & Bills**: R1,450.00 stock order due in 3 days; next month's rent due in 17 days.
5. **Growth Engine**: the forecast chart shades the shortage; *"Potential cash shortage in 5 days"* lists the bill, the
   planned airtime and the late expected payment as evidence, with numbered next steps. Dismiss or resolve findings.
6. **Business Readiness**: registration steps with official links; funding-readiness checklist (70% for the demo) and a
   printable business summary (Print / Save as PDF) and CSV exports.
7. **Opportunities**: verified official portals, programmes marked *requires verification*, and clearly marked
   SAMPLE entries. **Fraud Protection**: guidance and the demo incident about a fake "bank details changed" message.
8. Open the public profile at `/p/thatos-barber-studio-demo` (no sign-in, only opted-in fields).

---

## Deployment

### Frontend → Vercel

- Import the repo, set **Root Directory** = `kasiflow-web`, framework Vite (build `npm run build`, output `dist`).
- Environment variables: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (anon/publishable key only),
  `VITE_API_BASE_URL` (your API's https URL). `vercel.json` already rewrites routes to the SPA.
- Add the Vercel URL (`https://<app>.vercel.app`, plus `/reset-password` and `/sign-in`) to Supabase Auth URL configuration.

### API → any container host (Render, Railway, Fly.io, Azure Container Apps, …)

**Quickest: Render.** `render.yaml` is a ready Blueprint — in Render choose *New → Blueprint*, pick this repository and
fill in the values it asks for. Use Supabase's **Session pooler** connection string (Render's free tier has no IPv6, so
the direct `db.<ref>.supabase.co` host will not connect).

Build from the repo root with the included `Dockerfile` (listens on port 8080, runs as non-root). Configure secrets in
the host's secret manager — never in source:

| Variable | Example / notes |
|---|---|
| `ASPNETCORE_ENVIRONMENT` | `Production` |
| `Database__ConnectionString` | Npgsql connection string with `SSL Mode=Require` |
| `Auth__SupabaseUrl` | `https://<project-ref>.supabase.co` |
| `Auth__JwtSecret` | *optional*, legacy HS256 projects only |
| `Cors__AllowedOrigins__0` | `https://<app>.vercel.app` (exact origin; localhost and `*` are rejected in Production) |
| `App__PublicWebBaseUrl` | `https://<app>.vercel.app` |
| `Integrations__SandboxSigningKey` | 32+ random characters (signs demo sandbox events) |
| `Integrations__SnapScan__Credentials__<name>__ApiKey` / `__WebhookKey` | *optional*, SnapScan merchant API key and Webhook Authentication Key for the credential name chosen in the app |
| `Automation__EnableWorker` | `true` (default). Set `false` on extra replicas if only one instance should run the background worker |
| `App__TrustForwardedHeadersFromAnyProxy` | `true` only if the container is reachable **solely** through the platform proxy (needed for correct client IPs and https detection) |

Run migrations as a release/pre-deploy step: `dotnet KasiFlow.Api.dll migrate`. The platform must terminate HTTPS;
the API enables HSTS and HTTPS redirection outside Development; set `App__TrustForwardedHeadersFromAnyProxy=true` so it honours the proxy's `X-Forwarded-*` headers.
Point the platform health check at `/health/ready`.

---

## Status and honesty notes

See `docs/IMPLEMENTATION_PLAN.md` for the full checklist. In short:

- **Implemented and exercised end-to-end** (in the build environment, against PostgreSQL 16): all API endpoints in
  `docs/API.md`, the demo seed, migrations, ownership checks, and the browser journey (onboarding, recording a sale and
  an expense, a debt part-payment, dismissing a recommendation).
- **Built offline with substitutes**: NuGet was not reachable while this was built, so the API ran on compatibility shims
  (an older Npgsql driver, a minimal Dapper and an HS256-only JWT handler). **Run `dotnet build` and `dotnet test` on your
  machine first** — that is the first build against the real NuGet packages. Supabase's real ES256/JWKS token validation
  has not been tested against a live project yet.
- **Automation platform** (Brief 2, `docs/AUTOMATION.md`): Integrations Centre with a SnapScan adapter (built against
  SnapScan's published docs and tested against a local mock — not yet with a live merchant account), a demo-only sandbox
  simulator, durable background worker, reconciliation, staff roles and branches, shifts and cash-up, inventory,
  notifications and a daily briefing. Yoco and other providers are shown as planned.
- **Barbershop platform** (Brief 3, `docs/BARBERSHOP.md`): statuses, bookings, public booking, house calls,
  services, debts with R5 safeguards, money summary, payment proofs, supplier bank verification, Fraud & Alerts Centre.
  Tested in the build environment: 161 unit tests, 311 end-to-end checks and 64 frontend tests. Live distance and
  SMS/WhatsApp messages need providers and are shown as unavailable.
- **Not included by design**: moving money / issuing payments, bank verification, government submissions, live tender feeds,
  automatic messaging. These are labelled in the app and have documented extension points.
