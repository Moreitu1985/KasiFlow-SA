# KasiFlow SA — Project specification

## 1. Purpose

KasiFlow SA helps South African township and rural micro and small businesses capture daily financial activity, understand
cash flow, protect themselves from fraud, prepare for registration and funding, and find growth opportunities. The
differentiator is the **KasiFlow Growth Engine**: deterministic, explainable cash-flow forecasting and recommendations that
are traceable to the owner's own records.

Target users: spaza shop owners, barbers and salons, food vendors, clothing and retail, freelancers and service providers.
Design constraints: mobile-first, works on modest phones, plain language, South African rand (`R1,500.00`), `en-ZA`
conventions, Africa/Johannesburg time.

## 2. Scope (MVP)

| Area | In scope | Out of scope (documented) |
|---|---|---|
| Auth | Supabase sign-up, sign-in, sign-out, email verification, password reset; protected routes; API validates tokens | Social logins, MFA (available in Supabase, not wired) |
| Business | Onboarding profile, settings (opening balance, buffer, horizon), up to 5 businesses per user, active-business switcher | Team members / roles beyond owner |
| Bookkeeping | Transactions (posted / scheduled / voided), categories, payment methods and statuses, filters, paging, detail, void with reason | Double-entry ledger, VAT, inventory |
| Debts | Customers, receivables, partial payments, settle, write-off, overdue/upcoming filters, reminder templates (copy / open WhatsApp) | Automatic SMS/WhatsApp sending |
| Bills | Suppliers, payables, partial payments, paid, cancel (unpaid only), overdue / due-soon filters | Purchase orders |
| Growth Engine | 7–90 day daily forecast (expected + conservative), 9 rules, evidence, actions, statuses, de-duplication | AI explanations (extension point only) |
| Payments | Manual recording, awaiting confirmation, failed/cancelled; provider interface | Receiving, initiating, settling or verifying real payments |
| Readiness | Registration guidance with official links; funding checklist (6 automatic + 4 manual items); funding profile; business summary (print-to-PDF + CSV) | Credit scoring, lender criteria |
| Market | Public profile with explicit opt-in fields and stable slug URL | E-commerce, checkout |
| Opportunities | Catalogue with verification labels, private manual entries, save, application tracking | Live tender feed (extension point) |
| Fraud | Education centre, pre-payment checklist, private incident log | Fraud "detection", bank account verification |
| Reports | Financial summary, category breakdown, monthly, debts, bills, cash-flow forecast, readiness; CSV exports | Native PDF generation (browser print used) |

## 3. Accounting policy (cash basis)

1. A **transaction** is a cash movement. `posted` = happened; `scheduled` = planned (forecast only); `voided` = reversed
   (kept for audit, excluded everywhere). Posted transactions cannot be dated in the future; scheduled ones cannot be in the past.
2. Only posted transactions with payment status `recorded_manually` or `confirmed_external` count as cash, income or
   expense. `awaiting_confirmation` is shown separately and is not counted. `failed` / `cancelled` are never counted.
   `confirmed_external` is reserved for a future verified provider and cannot be set by users.
3. **Recording an amount owed (receivable) or a supplier bill (payable) does not create income or an expense.** No cash
   has moved.
4. A payment against a debt creates exactly one posted income transaction (category *Debt collection*) linked through
   `receivable_payments`. A payment against a bill creates exactly one posted expense transaction in the bill's
   category, linked through `payable_payments`. This is the only place that money is counted, so nothing is double counted.
5. Payments are limited to the remaining balance (row-locked to prevent concurrent overpayment). A debt settles / a bill is
   marked paid when the remaining balance reaches zero.
6. Voiding a payment transaction restores the related debt/bill balance and re-opens it. Payment-created transactions can
   only be voided, not edited.
7. Writing off a debt records the remaining amount as written off (no cash movement).
8. Money is stored as **integer cents** (`BIGINT`); all arithmetic is integer; overflow is checked.

## 4. Metric definitions

| Metric | Definition |
|---|---|
| Cash balance | Opening cash balance + counted income − counted expenses, for transactions dated on/after the opening-balance date up to today. Without an opening date, all counted transactions up to today. |
| Awaiting confirmation | Sum of posted transactions with status `awaiting_confirmation` (income positive, expenses negative). Not in cash. |
| Income / Expenses | Counted income / expenses dated within the selected period. |
| Net recorded result | Income − expenses for the period. Cash basis; **not** audited profit, not a tax figure. |
| Outstanding customer debts | Σ remaining (original − active payments − written off) of open receivables. |
| Overdue debts | Outstanding debts with a due date before today. |
| Upcoming supplier bills | Remaining balance of open bills due within the next 30 days, including overdue. |
| Projected lowest balance | Lowest *expected* closing balance in the forecast horizon, with its date. |
| Open recommendations | Count of open Growth Engine recommendations by severity. |
| Funding readiness % | Completed checklist items ÷ 10, rounded. |
| Registration progress % | Completed registration steps ÷ 8, rounded. |

## 5. Growth Engine

### Forecast
- Day 0 = today (Africa/Johannesburg). Opening = current cash balance (already includes today's counted transactions).
- Inflows: scheduled income on its date; **expected** customer collections (remaining balance) on the debt's due date.
- Outflows: scheduled expenses on their date; supplier bills (remaining balance) on the due date; overdue bills on day 0.
- Excluded (and listed with reasons): overdue debts, debts without due dates, scheduled items whose date has passed,
  failed/cancelled scheduled items, payments awaiting confirmation.
- Two lines: **expected** (with expected collections) and **conservative** (without them).
- Day flags: below zero, below the user's safety buffer.

### Rules
| Code | Severity | Fires when |
|---|---|---|
| CASH_SHORTFALL | critical | expected balance < 0 on any day |
| BELOW_BUFFER | warning | no shortfall, but expected balance < buffer (> 0) |
| RELIES_ON_COLLECTIONS | warning | no expected shortfall, but conservative balance < 0 |
| OVERDUE_RECEIVABLES | warning | any open debt past its due date |
| OVERDUE_BILLS | warning | any open bill past its due date |
| BILLS_DUE_SOON | info → warning | bills due in 7 days; warning if they exceed current cash |
| EXPENSE_SPIKE | warning | last 30 days ≥ 1.5 × average of the previous three 30-day windows (each must have expenses) and the increase ≥ R500 |
| DEBT_CONCENTRATION | info | one customer owes ≥ 50 % of outstanding debt (total ≥ R1,000) |
| DATA_QUALITY | info | opening balance not set, no / stale transactions, debts without due date, stale schedules, long-unconfirmed payments, insufficient history |

Each recommendation has title, severity, explanation, evidence (source type, id, label, amount, date, detail), relevant
dates, actions, an estimated impact only when it is a directly calculated amount, timestamps and status
(open / dismissed / resolved).

### De-duplication
Each situation has a stable **fingerprint** (e.g. `CASH_SHORTFALL:2026-10-21`, or a hash of the overdue record ids).
A partial unique index allows only one *open* recommendation per fingerprint. On every evaluation: the same open situation
is updated in place; a dismissed or user-resolved situation is not recreated; open situations that no longer occur are
auto-resolved; an auto-resolved situation that comes back is recreated.

Evaluation runs whenever recommendations or the dashboard are requested, and on demand (`POST /api/growth/refresh`), so
it always reflects the latest records.

## 6. Defaults and decisions

| Ambiguity | Decision |
|---|---|
| Accounting basis | Cash basis (see §3). |
| Business scope | Header `X-Business-Id`; defaults to the user's oldest business; non-member → 404. |
| Overdue debts in forecast | Excluded (conservative); highlighted by a dedicated rule. |
| Overdue bills in forecast | Treated as payable today. |
| Week start | Monday. |
| PDF export | Print-optimised page (`window.print()` → Save as PDF) — reliable on all devices. |
| Profile images | `https://` URL only (no file uploads in MVP). |
| Opportunities data | Curated official portals/programmes (with verification label and last-checked date) + clearly labelled samples + private manual entries. No invented tenders or deadlines. |
| Max businesses per user | 5. |
