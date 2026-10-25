# KasiFlow SA — Automation and connected business platform

This document describes how KasiFlow captures sales automatically, keeps provider data honest, and turns events into
forecasts, warnings and notifications. It covers Brief 2 ("Advanced automation and connected business platform").

> **Honesty rule.** KasiFlow never presents simulated or unverified data as real. Every ledger record carries an
> origin label, sandbox data only exists on the fictional demo business, and a connection only shows *Connected*
> after a genuine connection test succeeds.

---

## 1. Architecture at a glance

```
 Provider (SnapScan)        Sandbox simulator (demo only)
   │ webhook (signed)  │ sync (polling, API key)      │ signed sandbox webhook
   ▼                   ▼                              ▼
 POST /api/webhooks/{provider}/{connectionId}  ◄──────┘
   │ 1. look up connection   2. verify signature (raw body, HMAC-SHA256, fixed-time compare)
   │ 3. normalise → NormalizedEvent
   │ 4. INSERT provider_events  ON CONFLICT (connection_id, external_event_id) → duplicate_count+1
   │ 5. enqueue background_jobs(process_provider_event)  ← same DB transaction as step 4
   │ 6. log webhook_deliveries (no payload, body SHA-256 only) → 200 (duplicates also 200)
   ▼
 JobWorker (BackgroundService, PostgreSQL queue, FOR UPDATE SKIP LOCKED)
   ├─ process_provider_event → PaymentIngestionService
   │     (SnapScan: re-confirm payment via GET /payments/{id} first)
   │     PaymentStateMachine → provider_payments → ReconciliationPolicy → ledger / review queue
   │     line items → StockLedger (idempotent source keys) → low-stock notification
   │     settlement → settlements (gross / fees / net) → fee expense only
   │     → enqueue growth_refresh
   ├─ growth_refresh  → GrowthRefresher (forecast + all rules incl. anomaly rules) → notifications for critical findings
   ├─ sync_connection → ProviderSyncService (cursor in sync_checkpoints, 30-min overlap, same idempotent pipeline)
   └─ daily_briefing  → BriefingBuilder → one in-app notification per member per day
```

Nothing financial lives only in memory: events, jobs, cursors, deliveries and decisions are all rows in PostgreSQL
(migration `004_automation_platform.sql`). A crashed worker leaves jobs `running`; the scheduler re-queues them after
5 minutes. Every handler is idempotent, so retries and manual re-runs are safe.

### Key components (API)

| Component | File | Role |
|---|---|---|
| `IPaymentProviderAdapter` | `Services/Integrations/Adapters.cs` | Per-provider: test, parse/verify webhook, fetch since cursor, confirm payment |
| `SnapScanAdapter` | same | Real adapter written against SnapScan's published docs |
| `SandboxAdapter` | same | Demo simulator; signs with a per-connection key derived from `Integrations:SandboxSigningKey` |
| `IntegrationSecrets` | same | Reads secrets from configuration only — never from the database |
| `PaymentIngestionService` | `Services/Integrations/PaymentIngestionService.cs` | Webhook ingestion + event processing |
| `ReconciliationService` | `Services/Integrations/ReconciliationService.cs` | Review queue, manual match / create sale / ignore / unmatch |
| `IntegrationService` | `Services/Integrations/IntegrationService.cs` | Catalogue, connections, tests, health, activity, jobs, sandbox |
| `JobWorker`, `ProviderSyncService` | `Services/Automation/JobWorker.cs` | Durable worker and scheduled sync |
| `GrowthRefresher` | `Services/Automation/GrowthRefresher.cs` | Event-driven Growth Engine run + anomaly signals |
| `BriefingBuilder`, `NotificationService` | `Services/Automation/` | Daily briefing and in-app notifications |
| `StaffService`, `ShiftService`, `InventoryService` | `Services/Automation/` | Staff/branches/invitations, shifts & cash-up, inventory |

Pure, unit-tested rules live in **KasiFlow.Core**: `PaymentStateMachine`, `ReconciliationPolicy`, `CashUp`,
`ReorderCalculator`, `WebhookSignatures`, `SnapScanMapper`, `RolePermissions`, the anomaly rules and the forecaster's
scenarios.

---

## 2. Integrations Centre — provider status

| Provider | Status | Notes |
|---|---|---|
| KasiFlow sandbox | **Sandbox only** | Demo business only. Signed events through the real pipeline. Never real money. |
| SnapScan | **Available (built against published docs)** | Basic auth (API key as username), `GET /payments`, `GET /payments/{id}`, webhooks signed `Authorization: SnapScan signature=<HMAC-SHA256 hex of raw body>` with the Webhook Authentication Key. Only completed/errored payments are sent as webhooks. SnapScan calls webhooks an unauthenticated stream, so KasiFlow re-confirms every webhook payment through the API before trusting it. SnapScan does not provide fees, net amounts, staff or line items — KasiFlow does not invent them. **Not yet tested against a live merchant account.** |
| Yoco | **Planned — awaiting provider access** | Yoco requires an integration/partnership request; production needs the app to be live with Yoco merchants. Cannot be connected. |
| Other POS, Xero/QuickBooks, barcode scanner, email/SMS/WhatsApp | **Planned** | Shown honestly as planned. KasiFlow never sends messages through an unconfigured service. |
| CSV export, in-app notifications | **Available** | Built in. |

### Connecting SnapScan (production)

1. Ask SnapScan (help@snapscan.co.za) for merchant API access and a Webhook Authentication Key.
2. Choose a short credential name in the app, e.g. `main` (the UI rejects anything that looks like a secret).
3. On the API server set:
   `Integrations__SnapScan__Credentials__main__ApiKey` and `Integrations__SnapScan__Credentials__main__WebhookKey`.
4. Press **Test connection**. Status becomes `connected` only when SnapScan answers `200` to an authenticated request;
   without keys it stays `awaiting_credentials` with a hint.
5. Ask SnapScan to send webhooks to `https://<api-host>/api/webhooks/snapscan/<connectionId>` (shown on the card).
6. Payments are also pulled every `Automation:SnapScanSyncMinutes` (default 10) — webhooks are an accelerator, not the
   only source.

---

## 3. Payment rules

* **Status lifecycle** (`PaymentStateMachine`): `pending → completed | failed`, `completed → reversed`. Failed and reversed are
  final; late or repeated statuses change nothing.
* **Only completed payments count as income.** Pending payments appear only in the *optimistic* forecast scenario.
* **Payment ≠ settlement.** A settlement (payout to the bank) links payments, stores gross, fees and net separately and
  creates **one** expense for the provider fee (category *Fees & charges*, source `provider_fee`) when the provider reports
  fees. It never creates revenue. SnapScan settlements are grouped by `statementReference` with gross only; because SnapScan
  does not report a payout date, `settledOn` for these groups is the date KasiFlow first saw the statement reference.
  Sync re-reads the last 3 days so payments that settle later pick up their statement reference.
* **Refunds** are recorded as money out (category *Refunds*, source `provider_refund`); stock returns once refunds add up to the
  full payment. A refund that is later reversed has its expense voided; a payment reversed after refunds supersedes them, so
  money is never taken out twice.
* **Reversals** void a sale created from the payment, or mark a matched staff sale `cancelled`, and restock.
* **Provider references** (`external_payment_id`, merchant/statement references) are kept on every record.
* **Idempotency**: events are unique per `(connection, external_event_id)`; payments per `(connection, external_payment_id)`;
  stock movements per `source_key`; staff-recorded sales honour an `Idempotency-Key` header.

## 4. Reconciliation policy

1. **Exact reference + same amount + exactly one unlinked staff-recorded sale** → matched automatically.
2. Reference found but ambiguous or amount differs → **needs review** with suggestions.
3. Same amount within ±1 day on a non-cash sale → **needs review** (secondary evidence only, never automatic).
4. Nothing matches → a new sale is created from the confirmed payment.

People can **match**, **create sale**, **ignore** (reason required) or **unmatch** (reversible). Every decision is audited.
**Amounts are never changed to force a match** — if a recorded sale is wrong, it is corrected first.

## 5. Automatic sales capture — source labels

| Origin | Meaning |
|---|---|
| `staff_recorded` | Entered by a person in KasiFlow |
| `connected_pos` | From a connected provider event that includes product lines |
| `verified_provider` | From a verified payment provider (signature + API confirmation, or API sync) |
| `imported_file` | Reserved for file imports |
| `demo_simulation` | Sandbox — simulated, not real money (demo business only) |

Provider-created records cannot be edited or voided directly; use Reconciliation (unmatch) or a provider refund.

## 6. Staff, roles and branches

Roles: **Owner, Business administrator, Branch manager, Cashier, Staff member, Read-only accountant.** The matrix lives in
`KasiFlow.Core/Access/Permissions.cs` and is enforced by the API on every endpoint (`IBusinessContext.RequireAsync`);
the frontend only mirrors it. Branch-scoped roles (manager, cashier, staff) only see records of their branches —
filtered in SQL.

* Invitations: a random 256-bit token, shown **once** to the inviter (no email service is configured), stored only as a
  SHA-256 hash, valid 7 days, one use, and only for the invited email address.
* Nobody can change their own role, ownership cannot be assigned, only the owner manages administrators.
* Cash-up: expected cash = opening float + cash sales − cash refunds − paid-outs − cash drops + float top-ups. Card/QR never
  count as till cash. A variance ≥ the business threshold (default R50) is flagged **for review** with neutral wording;
  people cannot review their own variance (except the owner).
* Staff performance shows sales recorded, averages, voids and cash-up results **with caveats**, never rankings or labels.

## 7. Inventory

Products (SKU, optional barcode, price, cost, minimum stock, lead time, supplier), stock per branch, and an append-only
movement history (`received`, `sold`, `adjustment`, `damaged`, `return`, `transfer_out/in`, `sale_reversal`).
POS and recorded sales decrement stock idempotently; voids, reversals and refunds restock once. Manual adjustments by people
without approval rights wait for approval. Reorder suggestions are calculated on request (no table) from the last 30 days
of sales and show every assumption; nothing is ordered automatically.

## 8. Event-driven Growth Engine, anomalies and notifications

Every financial change enqueues a deduplicated `growth_refresh`, so forecasts and recommendations update within seconds.
Forecast scenarios: **expected**, **conservative** (no debt collections) and **optimistic** (overdue debts and pending
provider payments arrive tomorrow). With fewer than 10 counted transactions or 14 days of history the forecast is marked
**preliminary**.

Anomaly rules (deterministic, evidence-based, non-accusatory): repeated provider deliveries, rising payment failures,
unusual refunds, unusually large transactions (needs ≥20 earlier ones), unreviewed cash-up variances, large stock
adjustments, integration changes. Supplier bank-detail change detection does not apply: KasiFlow stores no bank details
(the Fraud page covers this risk as an incident type).

In-app notifications go to members whose role has the relevant permission and who have not turned that kind off:
critical cash warnings, payments needing review, reversals, cash-up variances, low stock, stock approvals, integration
failures and the daily briefing. Email is shown as unavailable because no email provider is configured.
The frontend **polls** (10–30 s while visible) instead of using WebSockets/SignalR; this keeps hosting simple and works on
free tiers. A push channel can be added later without changing the data model.

## 9. Demo / sandbox mode

`Settings → Load demo data` creates the fictional *Thato's Barber Studio* (`is_demo = true`) with one branch, three retail
products and a month of stock history. The app shows a persistent **DEMO · SANDBOX** badge. In the Integrations Centre,
connect the sandbox and use the simulator: QR payment, POS sale with product lines, pending → completed / failed, reversal,
refund, settlement with fees, duplicate delivery, forged signature. **Reset sandbox data** removes all simulated records,
restores stock and returns matched staff sales to "recorded manually". The sandbox cannot be connected on a real business.

## 10. Configuration

| Setting | Purpose |
|---|---|
| `Integrations__SandboxSigningKey` | ≥32 chars. Derives per-connection sandbox keys. If unset, a random per-process key is used (sandbox events signed before a restart can't be re-verified). |
| `Integrations__SnapScan__BaseUrl` | Defaults to `https://pos.snapscan.io/merchant/api/v1/` |
| `Integrations__SnapScan__Credentials__<name>__ApiKey` / `__WebhookKey` | SnapScan secrets per credential name |
| `Automation__EnableWorker` | `true` by default. Set `false` only on extra instances when one instance runs the worker. |
| `Automation__SnapScanSyncMinutes` | Polling interval (default 10) |
| `Automation__BriefingHour` | SA hour after which the daily briefing notification is created (default 6) |

## 11. Acceptance tests (Brief 2)

| # | Acceptance requirement | Where it is tested |
|---|---|---|
| 1 | Webhook signature verified; forged/wrong-key webhooks rejected (401), nothing stored | `WebhookSignatureTests`; e2e_auto "forged sandbox signature", e2e_snapscan "wrong key → 401" |
| 2 | Duplicate deliveries are idempotent (acknowledged, never double counted, never double stock) | e2e_auto duplicate checks; e2e_snapscan "retry acknowledged as duplicate", webhook + sync dedupe |
| 3 | Pending payments are not income; shown only in the optimistic scenario | `PaymentLifecycleTests`, `ForecastScenarioTests`; e2e_auto pending checks |
| 4 | Completion creates exactly one labelled sale (origin, provider reference, branch) | e2e_auto "completed payment counted once", e2e_snapscan "verified_provider income" |
| 5 | Failed and reversed payments do not count; reversal removes income and restocks | e2e_auto failed/reversal checks |
| 6 | Settlements keep gross / fees / net separate; only the fee is an expense; no invented fees | e2e_auto settlement; e2e_snapscan "gross only (no invented fees)" |
| 7 | Exact-reference auto-match; ambiguous → review; manual match/unmatch/create/ignore audited; amounts never forced | `ReconciliationPolicyTests`; e2e_auto reconciliation block |
| 8 | POS line items decrement stock exactly once; refunds/voids restock once | e2e_auto POS block; e2e_staff "voiding a sale returns its stock" |
| 9 | Low stock and reorder suggestions with assumptions | `ReorderTests`; e2e_staff reorder |
| 10 | RBAC enforced in the API, incl. branch scoping | `RolePermissionTests`, `BusinessOwnershipTests`; e2e_staff cashier/accountant blocks |
| 11 | Invitations: hashed one-time token, email-bound, expiring; role-change rules | e2e_staff invitation block |
| 12 | Cash-up expected/variance/review, non-accusatory notification | `CashUpTests`; e2e_staff shift block |
| 13 | Event-driven growth refresh, anomaly rules, notifications and daily briefing | `AnomalyRuleTests`; e2e_auto growth/briefing checks |
| 14 | Honest integration status: Connected only after a real test; SnapScan awaiting credentials; Yoco planned; sandbox demo-only | e2e_auto catalogue/connection checks; e2e_snapscan |
| 15 | Sandbox isolation and reset | e2e_auto "sandbox refused on a real business", reset checks |

An independent code review of the automation backend found 16 issues (none critical); all were fixed except the
SnapScan settlement date noted above, and regression checks were added.

Results in the build environment (PostgreSQL 16, offline shims — see IMPLEMENTATION_PLAN.md): **119 unit tests passed;
224 end-to-end HTTP checks passed** (95 original + 57 automation + 57 staff/inventory + 15 SnapScan against a local mock of
the documented API). The e2e scripts are kept outside the repository because they rely on the offline test setup.
