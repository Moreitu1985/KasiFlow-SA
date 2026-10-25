# KasiFlow SA — REST API contract

Base URL: `VITE_API_BASE_URL` (e.g. `http://localhost:5080`). All routes below are relative to it.
Interactive docs: `/swagger` (Development only), OpenAPI document at `/openapi/v1.json`.

## Conventions

| Topic | Rule |
|---|---|
| Auth | `Authorization: Bearer <Supabase access token>` on every route except `/health*` and `/api/public/*`. |
| Business scope | Business-scoped routes need `X-Business-Id: <uuid>`. If omitted, the caller's oldest business is used. A business the caller does not belong to returns **404** (never 403, so existence is not leaked). |
| JSON | camelCase properties. Enums are lowercase `snake_case` strings. |
| Money | Always integer **cents** in fields ending `Cents` (`150000` = R1,500.00). Never floats. Currency is always ZAR. |
| Dates | `YYYY-MM-DD` for calendar dates, ISO-8601 UTC for timestamps (`createdAt`). "Today" is evaluated in `Africa/Johannesburg`. |
| Errors | RFC 7807 problem details. Validation failures: `400` with `errors: { fieldName: ["message"] }`. `401` unauthenticated, `403` your role does not allow the action (member of the business but lacking the permission), `404` not found / not yours, `409` conflict, `429` rate limited. Production never returns stack traces. |
| Paging | Paged endpoints accept `page` (1-based, default 1) and `pageSize` (default 20, max 100) and return `{ items, page, pageSize, totalCount, totalPages }`. |

### Enum values

- `province`: `eastern_cape, free_state, gauteng, kwazulu_natal, limpopo, mpumalanga, north_west, northern_cape, western_cape`
- `registrationStatus`: `not_started, in_progress, registered, not_sure`
- transaction `type`: `income, expense`
- `paymentMethod`: `cash, eft, card, mobile_payment, other`
- `paymentStatus`: `recorded_manually, awaiting_confirmation, failed, cancelled` (+ `confirmed_external`, reserved for a future verified provider; the API rejects it on input)
- transaction `status`: `posted` (happened), `scheduled` (planned future movement), `voided`
- transaction `source`: `manual, receivable_payment, payable_payment`
- Income categories: `Sales, Services, Debt collection, Other income`
- Expense categories: `Stock & supplies, Rent, Wages, Transport, Utilities, Airtime & data, Equipment, Supplier payment, Fees & charges, Marketing, Other expense`
- receivable `status`: `open, settled, written_off`
- payable `status`: `open, paid, cancelled`
- recommendation `severity`: `informational, warning, critical`; `status`: `open, dismissed, resolved`
- opportunity `opportunityType`: `funding, procurement, supplier_registration, training, market_access, other`
- opportunity `verificationStatus`: `verified_official, requires_verification, sample`
- `applicationStatus`: `saved, preparing, applied, successful, unsuccessful, closed`
- fraud `incidentType`: `suspicious_payment_request, fake_proof_of_payment, bank_detail_change, impersonation, upfront_fee_scam, phishing, urgent_payment_pressure, credential_request, other`
- fraud `status`: `open, monitoring, resolved`
- `businessBankAccountStatus`: `has_business_account, uses_personal_account, not_applicable`

---

## Health (anonymous)

- `GET /health` → `200 { "status": "Healthy" }` (process is up)
- `GET /health/ready` → `200` when the database is reachable, `503` otherwise

## Current user

`GET /api/me` → `{ userId, email, businesses: BusinessDto[] }`

## Businesses

```
BusinessDto { id, name, businessType, ownerName, contactEmail, contactPhone|null, province,
              town|null, registrationStatus, currency:"ZAR", createdAt, updatedAt }
BusinessInput { name, businessType, ownerName, contactEmail, contactPhone?, province, town?, registrationStatus }
```

- `GET /api/businesses` → `BusinessDto[]` (only the caller's)
- `POST /api/businesses` `BusinessInput` → `201 BusinessDto` (caller becomes owner; settings row created)
- `GET /api/businesses/{id}` → `BusinessDto`
- `PUT /api/businesses/{id}` `BusinessInput` → `BusinessDto`

## Settings (business-scoped)

```
SettingsDto { openingCashBalanceCents, openingBalanceDate|null, cashBufferCents, forecastDays }
```
- `GET /api/settings` → `SettingsDto`
- `PUT /api/settings` `SettingsDto` → `SettingsDto` (`openingCashBalanceCents` may be negative (overdraft) ; `cashBufferCents >= 0`; `forecastDays` 7–90; `openingBalanceDate` not in the future)

## Dashboard (business-scoped)

`GET /api/dashboard/summary?period=this_week|this_month|last_month|last_30_days|custom&from=&to=`

```
DashboardSummaryDto {
  period: { from, to, label },
  hasAnyTransactions, openingBalanceConfigured,
  cashBalanceCents, awaitingConfirmationCents,
  incomeCents, expensesCents, netResultCents,
  outstandingReceivablesCents, overdueReceivablesCents,
  upcomingPayablesCents,          // open bills due within the next 30 days, including overdue
  overduePayablesCents,
  forecast: { horizonDays, lowestExpectedBalanceCents, lowestExpectedBalanceDate,
              closingExpectedBalanceCents, firstShortageDate|null, firstBelowBufferDate|null },
  forecastSeries: [{ date, expectedBalanceCents, conservativeBalanceCents }],
  openRecommendations: { total, critical, warning, informational },
  fundingReadinessPercent, registrationProgressPercent,
  incomeVsExpenses: [{ month:"2026-05", label:"May 2026", incomeCents, expensesCents }],   // last 6 months
  upcomingObligations: [{ payableId, supplierName, description, dueDate, remainingCents, isOverdue }],  // max 5
  priorityActions: RecommendationDto[]                                                  // max 3 open, most severe first
}
```

`GET /api/dashboard/recent-transactions?limit=8` → `TransactionDto[]`

## Transactions (business-scoped)

```
TransactionDto { id, type, description, amountCents, category, transactionDate, paymentMethod,
                 paymentStatus, status, source, reference|null, notes|null, voidReason|null,
                 voidedAt|null, createdAt, updatedAt, receivableId|null, payableId|null,
                 counterpartyName|null }
TransactionInput { type, description, amountCents, category, transactionDate, paymentMethod,
                   paymentStatus?="recorded_manually", status?="posted", reference?, notes? }
```
Rules: `amountCents > 0`; `posted` ⇒ date ≤ today; `scheduled` ⇒ date ≥ today; category must belong to the type.

- `GET /api/transactions?type=&category=&status=&from=&to=&search=&page=&pageSize=` → `Paged<TransactionDto>` (default excludes voided unless `status=voided` or `status=all`)
- `GET /api/transactions/categories` → `{ income: string[], expense: string[] }`
- `POST /api/transactions` `TransactionInput` → `201 TransactionDto`
- `GET /api/transactions/{id}` → `TransactionDto`
- `PUT /api/transactions/{id}` `TransactionInput` → `TransactionDto` (only `source=manual`, not voided; else `409`)
- `POST /api/transactions/{id}/void` `{ reason }` → `TransactionDto`. Voiding a debt/bill payment re-opens that debt/bill.

## Customers & receivables (business-scoped)

```
CustomerDto { id, name, phone|null, email|null, notes|null, isArchived, outstandingCents, openDebts, createdAt }
CustomerInput { name, phone?, email?, notes?, isArchived? }
ReceivableDto { id, customerId, customerName, description, originalAmountCents, paidCents, writtenOffCents,
                remainingCents, issueDate, dueDate|null, status, isOverdue, daysOverdue, notes|null, createdAt }
ReceivableDetailDto = ReceivableDto + { payments: [{ id, transactionId, amountCents, paymentDate, paymentMethod, reference|null, isVoided }] }
```
- `GET /api/customers?search=&includeArchived=false` → `CustomerDto[]`
- `POST /api/customers` → `201 CustomerDto`; `GET /api/customers/{id}`; `PUT /api/customers/{id}`
- `GET /api/receivables?status=open|settled|written_off|all&filter=all|overdue|upcoming&customerId=&page=&pageSize=` → `Paged<ReceivableDto>` (`upcoming` = due in the next 14 days)
- `GET /api/receivables/summary` → `{ totalOutstandingCents, overdueCents, upcomingCents, openCount, topDebtors: [{ customerId, customerName, outstandingCents }] }`
- `POST /api/receivables` `{ customerId, description, originalAmountCents, issueDate, dueDate?, notes? }` → `201 ReceivableDetailDto`. **Does not create income** — no cash has been received.
- `GET /api/receivables/{id}` → `ReceivableDetailDto`
- `POST /api/receivables/{id}/payments` `{ amountCents, paymentDate, paymentMethod, reference? }` → `ReceivableDetailDto`. Atomically creates a posted income transaction (category `Debt collection`) and links it. `amountCents` ≤ remaining (`409` otherwise). Settles at zero.
- `POST /api/receivables/{id}/write-off` `{ reason }` → `ReceivableDetailDto` (no cash movement).

## Suppliers & payables (business-scoped)

```
SupplierDto { id, name, phone|null, email|null, notes|null, isArchived, outstandingCents, openBills, createdAt }
PayableDto  { id, supplierId, supplierName, description, category, originalAmountCents, paidCents, remainingCents,
              billDate, dueDate, status, isOverdue, daysUntilDue, reference|null, notes|null, createdAt }
PayableDetailDto = PayableDto + { payments: [...same shape as receivable payments] }
```
- `GET /api/suppliers?search=&includeArchived=false`; `POST /api/suppliers`; `GET/PUT /api/suppliers/{id}`
- `GET /api/payables?status=open|paid|cancelled|all&filter=all|overdue|due_soon&supplierId=&page=&pageSize=` (`due_soon` = next 7 days)
- `GET /api/payables/summary` → `{ totalOutstandingCents, overdueCents, dueNext7DaysCents, dueNext30DaysCents, openCount }`
- `POST /api/payables` `{ supplierId, description, category (expense category), originalAmountCents, billDate, dueDate, reference?, notes? }` → `201 PayableDetailDto`. **Does not create an expense** until paid.
- `GET /api/payables/{id}`
- `POST /api/payables/{id}/payments` `{ amountCents, paymentDate, paymentMethod, reference? }` → creates a posted expense transaction in the bill's category; marks `paid` at zero.
- `POST /api/payables/{id}/cancel` `{ reason }` → only when no active payments exist.

## Growth Engine (business-scoped)

`GET /api/growth/forecast?days=` (7–90, defaults to settings)
```
ForecastDto {
  asOf, horizonDays, openingBalanceCents, cashBufferCents, openingBalanceConfigured,
  days: [{ date, openingBalanceCents, scheduledInflowsCents, expectedInflowsCents, outflowsCents,
           expectedClosingCents, conservativeClosingCents, belowBuffer, belowZero,
           events: [{ kind: "scheduled_income"|"expected_collection"|"scheduled_expense"|"supplier_bill",
                      sourceType: "transaction"|"receivable"|"payable", sourceId, description,
                      counterparty|null, amountCents, isExpected, isOverdueCarryForward }] }],
  lowestExpected: { date, balanceCents }, lowestConservative: { date, balanceCents },
  firstShortageDate|null, firstBelowBufferDate|null, firstConservativeShortageDate|null,
  totals: { scheduledInflowsCents, expectedInflowsCents, outflowsCents },
  excluded: [{ sourceType, sourceId, description, amountCents, reason }],
  assumptions: string[]
}
```
Day 0 is today. `expectedClosingCents` includes expected customer collections; `conservativeClosingCents` excludes them.

```
RecommendationDto { id, ruleCode, title, severity, explanation,
                    evidence: [{ sourceType, sourceId|null, label, amountCents|null, date|null, detail|null }],
                    relevantDates: [{ label, date }], actions: string[], estimatedImpactCents|null,
                    status, resolutionNote|null, createdAt, updatedAt }
```
- `GET /api/growth/recommendations?status=open|dismissed|resolved|all&severity=` → `RecommendationDto[]` (re-evaluates the rules first)
- `PATCH /api/growth/recommendations/{id}` `{ status: "open"|"dismissed"|"resolved", note? }` → `RecommendationDto`
- `POST /api/growth/refresh` → `{ created, updated, autoResolved }`
- `GET /api/growth/rules` → `[{ code, name, description, severity }]`

## Opportunities (business-scoped)

```
OpportunityDto { id, title, description, organisation, opportunityType, industry, eligibilityCriteria,
                 requiredDocuments: string[], applicationDeadline|null, sourceUrl|null, geographicScope,
                 verificationStatus, lastCheckedOn|null, isPrivate,
                 tracking: { id, applicationStatus, notes|null, personalDeadline|null, updatedAt } | null }
```
- `GET /api/opportunities?type=&verification=&search=&savedOnly=false` → `OpportunityDto[]`
- `GET /api/opportunities/{id}`
- `POST /api/opportunities` (private manual entry) `{ title, description, organisation, opportunityType, industry?, eligibilityCriteria?, requiredDocuments?, applicationDeadline?, sourceUrl?, geographicScope? }` → always stored as `requires_verification`
- `POST /api/opportunities/{id}/save` → `OpportunityDto`
- `PUT /api/opportunities/{id}/tracking` `{ applicationStatus, notes?, personalDeadline? }` → `OpportunityDto`
- `DELETE /api/opportunities/{id}/save` → `204`

## Business readiness (business-scoped)

- `GET /api/registration` → `{ registrationStatus, progressPercent, completedCount, totalCount, disclaimer, steps: [{ key, title, description, appliesTo, resources: [{ title, url, purpose }], completed, notes|null, updatedAt|null }] }`
- `PUT /api/registration/items/{key}` `{ completed, notes? }`
- `PUT /api/registration/status` `{ registrationStatus }`
- `GET /api/funding-readiness` → `{ percent, completedCount, totalCount, disclaimer, profile: { fundingPurpose|null, amountRequestedCents|null, businessBankAccountStatus|null }, items: [{ key, title, description, howToComplete, mode: "automatic"|"manual", completed, notes|null, appRoute|null }] }`
- `PUT /api/funding-readiness/items/{key}` `{ completed, notes? }` (manual items only; automatic → `400`)
- `PUT /api/funding-readiness/profile` `{ fundingPurpose?, amountRequestedCents?, businessBankAccountStatus? }`
- `GET /api/funding-readiness/summary?from=&to=` → `BusinessSummaryDto` (see reports)

## Public profile

- `GET /api/public-profile` (owner, business-scoped) → `{ exists, slug, isPublished, description, category, productsServices, showPhone, showEmail, showTown, serviceArea, openingHours, imageUrl, publicUrlPath }`
- `PUT /api/public-profile` (owner) → same. `slug` 3–80 chars `a-z0-9-`, unique (`409` if taken). `imageUrl` must be `https://`.
- `GET /api/public/profiles/{slug}` (**anonymous**, rate limited) → `{ slug, businessName, description, category, productsServices, province, town|null, serviceArea, openingHours, imageUrl, phone|null, email|null }`. `404` unless published. Only opted-in fields are returned.

## Fraud protection (business-scoped)

```
FraudIncidentDto { id, incidentType, description, incidentDate, relatedTransactionId|null, status,
                   actionTaken|null, privateNotes|null, createdAt, updatedAt }
```
- `GET /api/fraud/incidents?status=` ; `POST /api/fraud/incidents` ; `GET/PUT /api/fraud/incidents/{id}`

## Reports (business-scoped)

- `GET /api/reports/financial-summary?from=&to=` → `{ period:{from,to,label}, incomeCents, expensesCents, netResultCents, transactionCount, categoryBreakdown: [{ type, category, totalCents, count, sharePercent }], monthly: [{ month, label, incomeCents, expensesCents, netCents }] }`
- `GET /api/reports/cash-flow?days=` → `ForecastDto`
- `GET /api/reports/business-summary?from=&to=` → `BusinessSummaryDto { generatedAt, business: { name, businessType, province, town, registrationStatus }, period, incomeCents, expensesCents, netResultCents, categoryBreakdown, monthly, cashBalanceCents, outstandingReceivablesCents, outstandingPayablesCents, forecast: { horizonDays, lowestExpectedBalanceCents, lowestExpectedBalanceDate, closingExpectedBalanceCents }, readinessPercent, fundingPurpose|null, amountRequestedCents|null, disclaimer }`
- `GET /api/reports/export/{kind}.csv?from=&to=` where `kind` ∈ `transactions, category-breakdown, monthly, receivables, payables, cash-flow, readiness, business-summary` → `text/csv` attachment (amounts in rand with two decimals, labelled Actual/Forecast).

---

# Automation platform (migration 004)

Every route below is business-scoped and checked against the caller's **role permission** (see
`KasiFlow.Core/Access/Permissions.cs`); branch-scoped roles only see their branches. Full behaviour: `docs/AUTOMATION.md`.
`BusinessDto` now also returns `role`, `permissions` (camelCase permission names) and `isDemo`.

## Transactions (additions)
- `POST /api/transactions` accepts `branchId` (required when the caller can use several branches) and `lineItems: [{ productId, quantity }]` (income only; reduces stock once).
  Header `Idempotency-Key: <≤100 chars>` makes retries return the original record. Cash sales attach to the caller's open shift.
  Roles with `recordSales` but not `manageFinancials` may only record posted income.
- `GET /api/transactions?branchId=&origin=`; `TransactionDto` adds `origin, branchId, branchName, shiftId, providerPaymentId, providerKey, providerStatus`.
- Records with source `provider_payment | provider_refund | provider_fee`, and staff sales matched to a provider payment, cannot be voided (`409`) — use Reconciliation.

## Forecast (additions)
`ForecastDayDto.optimisticClosingCents`; `ForecastDto.lowestOptimistic, totalOptimisticExtraCents, isPreliminary, preliminaryReason, scenarios[{key,name,assumption}]`.
Dashboard: `forecast.isPreliminary, preliminaryReason, lowestConservativeBalanceCents, lowestOptimisticBalanceCents`, `forecastPoints[].optimisticBalanceCents`.
Settings: `largeTxMultiplier, cashupVarianceThresholdCents, reorderSafetyDays, reorderCoverDays, defaultLeadTimeDays` (omit on update to keep the current value).

## Integrations (`viewIntegrations` / `manageIntegrations`)
| Method & path | Notes |
|---|---|
| `GET /api/integrations` | `{ catalogue[], connections[], isDemoBusiness, canManage }` — catalogue states availability honestly |
| `POST /api/integrations/connections` `{ providerKey, displayName?, credentialRef?, defaultBranchId? }` | `sandbox` (demo business only, else 403), `snapscan` (credentialRef = name of server-side secret), `yoco` → 400 (planned). Runs a connection test immediately; returns `{ ok, status, error, hint, connection }`. 409 if already connected. |
| `GET /api/integrations/connections/{id}` | `ConnectionDto` incl. `health { state, label, eventsLast24h, failedEvents, duplicateEvents, pendingJobs, deadJobs, lastEventAt }` and `webhookPath` |
| `POST …/connections/{id}/test` | Genuine test; only success sets `connected` |
| `POST …/connections/{id}/sync` | 202; enqueues a sync (polling providers only) |
| `DELETE …/connections/{id}` | Disconnect (kept for history) |
| `GET …/connections/{id}/activity` | Events and webhook deliveries (no payloads or secrets) |
| `POST …/connections/{id}/simulate` `{ scenario, amountCents?, reference?, method?, paymentId?, feeCents?, sku?, quantity? }` | Sandbox only. Scenarios: `qr_payment, pos_sale, pending_payment, complete_pending, fail_pending, reverse_payment, refund, settlement, duplicate, bad_signature` |
| `POST /api/integrations/sandbox/reset` | Removes all sandbox data from the demo business |
| `GET /api/integrations/payments?reconciliationStatus=&status=&connectionId=&from=&to=&page=&pageSize=` | Paged `ProviderPaymentDto` (`countsAsIncome`, `sourceLabel`) |
| `GET /api/integrations/settlements` | Gross, fees (null = not reported), net |
| `GET /api/integrations/jobs?status=` ; `POST /api/integrations/jobs/{id}/retry` | Background jobs; retry failed/dead |

## Webhooks (anonymous, signature-verified)
`POST /api/webhooks/{provider}/{connectionId}` — raw body ≤ 64 KB, rate-limited per IP.
SnapScan: `Authorization: SnapScan signature=<hex HMAC-SHA256(raw body, Webhook Authentication Key)>`, form field `payload`.
Sandbox: `X-KasiFlow-Sandbox-Signature: sha256=<hex>`. Responses: `200 {outcome: accepted|duplicate}`, `401` bad signature, `404` unknown/disconnected connection, `413` too large.

## Reconciliation (`manageReconciliation`; read also with `viewIntegrations`)
- `GET /api/reconciliation/summary` → counts per status, pending and unsettled amounts.
- `GET /api/reconciliation/queue?status=needs_review|unmatched|auto_matched|matched|created_sale|ignored` → `[{ payment, suggestions[] }]`
- `POST /api/reconciliation/payments/{id}/match` `{ transactionId, note? }` (amounts must be equal) · `/create-sale` · `/ignore` `{ note }` (required) · `/unmatch` `{ note? }`

## Notifications and briefing (any member)
- `GET /api/notifications?unreadOnly=` → `{ items[], unreadCount }`; `POST /api/notifications/{id}/read`; `POST /api/notifications/read-all`
- `GET/PUT /api/notifications/preferences` `{ briefingTime "HH:mm", inApp, email(false — not available), criticalCash, cashup, lowStock, integrations, emailAvailable }`
- `GET /api/briefing` → `BriefingDto` (items filtered by the caller's permissions)
- Notification `kind` values: `cash_warning, growth, reconciliation, integration, cashup_variance, low_stock, stock_approval, staff, briefing`.

## Branches and staff
- `GET /api/branches` (visible branches) · `POST /api/branches` · `PUT /api/branches/{id}` `{ name, area?, isActive? }` (`manageBranches`)
- `GET /api/staff` (`viewStaff`) → members, pending invitations (`manageStaff`), branches, roles with permissions
- `POST /api/staff/invitations` `{ email, role, branchIds }` → `{ invitation, token, acceptPath, note }` (token shown once) · `DELETE /api/staff/invitations/{id}`
- `POST /api/invitations/accept` `{ token }` (signed-in user whose email matches; not business-scoped)
- `PUT /api/staff/{userId}/role` `{ role, branchIds }` · `POST /api/staff/{userId}/deactivate|reactivate`
- `GET /api/staff/performance?from=&to=` (`viewPerformance`) → rows + caveats

## Shifts and cash-up
- `GET /api/shifts?status=open|closed|reviewed|needs_review` · `GET /api/shifts/current` (204 when none) · `GET /api/shifts/{id}`
- `POST /api/shifts/open` `{ branchId?, openingFloatCents }` (`operateShift`)
- `POST /api/shifts/{id}/cash-movements` `{ kind: cash_drop|float_top_up, amountCents, note? }`
- `POST /api/shifts/{id}/close` `{ countedCashCents, note? }` → expected, variance, needsReview
- `POST /api/shifts/{id}/review` `{ note }` (`reviewShifts`; note required when a variance needs review)

## Inventory
- `GET /api/inventory/products?search=&includeInactive=` (`viewInventory`) · `POST /api/inventory/products` · `PUT /api/inventory/products/{id}` (`manageInventory`)
- `POST /api/inventory/receive` `{ productId, branchId, quantity, unitCostCents?, note? }`
- `POST /api/inventory/adjustments` `{ productId, branchId, type: adjustment|damaged|return, quantityDelta, reason }` (`recordStockAdjustment`; pending approval unless the caller can approve)
- `POST /api/inventory/adjustments/{id}/approve|reject` `{ note? }` (`approveStockAdjustment`; not your own, except the owner)
- `POST /api/inventory/transfers` `{ productId, fromBranchId, toBranchId, quantity, note? }`
- `GET /api/inventory/movements?productId=&branchId=&status=` · `GET /api/inventory/reorder-suggestions?onlyNeeded=`


# Barbershop platform (migration 005, see docs/BARBERSHOP.md)

All routes are business-scoped except `/api/public/*`. Permissions are checked on the server.

## Workspace and team
- `GET /api/workspace`: my profile, status, today's and upcoming bookings, hours, time off, colleagues.
- `GET /api/team`, `POST /api/team`, `PUT /api/team/{id}`: staff profiles (`manageStaffSchedules`).
- `PUT /api/team/{id}/status`: `{ status, note?, forMinutes?, revertTo? }`. Status is one of available, busy, house_call, on_break,
  unavailable, off_duty. You can set your own status (`updateOwnStatus`); managers can set anyone's.
- `GET /api/team/{id}/status-history`
- `PUT /api/team/{id}/hours`: `[{ weekday, start, end }]`, up to 3 blocks per day.
- `GET|POST /api/team/{id}/time-off`, `DELETE /api/team/{id}/time-off/{timeOffId}`
- `PUT /api/team/{id}/services`: the services a barber offers, with an optional price override.

## Services and policies
- `GET /api/services?includeInactive=`, `POST /api/services`, `PUT /api/services/{id}` (`manageServices`).
- `GET|PUT /api/policies/booking`: auto-confirm, off-duty override, slot interval, lead time, horizon, house calls,
  travel fee mode (none / flat / per_km), minimum fee, maximum km.
- `GET|PUT /api/policies/debt-charge`: owner only (`configureDebtPolicy`). The response includes the safeguards that
  still block the charge.

## Bookings
- `GET /api/bookings?from=&to=&status=&staffId=&locationType=`. Barbers only see their own bookings.
- `GET /api/bookings/availability?date=&serviceIds=&staffId=&locationType=shop|house_call`: free slots, plus why a barber is not offered.
- `POST /api/bookings/quote`: server-side totals (items × people, barber price, travel fee, discount).
- `POST /api/bookings`, `GET /api/bookings/{id}`
- `POST /api/bookings/{id}/confirm|propose|accept-proposal|reject-proposal|complete|no-show|cancel`
  - `complete` takes payments and/or `debt` (with `chargeTermsDisclosed`). A conflict returns 409.
- `PUT /api/bookings/{id}/house-call`: address, distance (manual), estimated costs.
- `POST /api/bookings/{id}/expenses`: an actual visit cost (taxi, disposables), linked to the booking.
- `GET /api/house-calls?from=&to=`: estimated vs actual contribution per visit.

## Public booking (anonymous, rate-limited)
- `GET /api/public/profiles/{slug}/booking`: services, barbers and the travel fee policy. Contains no internal data.
- `GET /api/public/profiles/{slug}/availability?date=&serviceIds=&staffId=&locationType=`
- `POST /api/public/profiles/{slug}/bookings`: returns `reference` and a one-time `token`. At most 3 pending requests
  per phone number.
- `GET /api/public/bookings/{reference}?t=<token>`
- `POST /api/public/bookings/{reference}/{op}` (token in the body), where op is cancel, reschedule, accept-proposal or
  reject-proposal.

## Debts
- `GET /api/debts/{id}/account`: statement with payments, charges (applied / proposed / waived / reversed),
  reminders, the disclosed terms snapshot and the running balance.
- `POST /api/debts/{id}/dispute`, `POST /api/debts/{id}/resolve-dispute`: `{ reason }`.
- `POST /api/debts/{id}/reminders`: logs a reminder you sent yourself. KasiFlow sends nothing.
- `POST /api/debts/{id}/charges/{chargeId}/waive|reverse`: `{ reason }` is required.
- `POST /api/debts/evaluate-charges`, `GET /api/debts/overdue-report`
- Existing `POST /api/receivables/{id}/payments` returns 409 for a repeat payment within 10 minutes unless
  `confirmDuplicate: true`.

## Money, alerts, proofs, supplier bank details
- `GET /api/money/summary?period=day|week|month&date=`: separated figures (see BARBERSHOP.md §6).
- `GET /api/alerts?status=&severity=`, `POST /api/alerts/{id}/status`: `{ status: under_review|resolved|false_positive|open, note }`.
- `GET /api/payment-proofs?status=`
- `POST /api/payment-proofs` (multipart: `file`, `transactionId?`, `bookingId?`, `note?`; PNG, JPEG or PDF, up to 2 MB).
- `GET /api/payment-proofs/{id}/file`: sent as an attachment with `nosniff`.
- `POST /api/payment-proofs/{id}/confirm-in-bank|reject`: `{ note }`.
- `GET|POST /api/suppliers/{supplierId}/bank-details`: stores only the last 4 digits and a keyed fingerprint.
- `POST /api/suppliers/{supplierId}/bank-details/{id}/verify|reject` (`verifySupplierBankDetails`).


# Customers, barbers and safety (migration 006)

See docs/CUSTOMERS_AND_SAFETY.md §Endpoints. Note: `POST /api/public/profiles/{slug}/bookings` now requires a signed-in customer (401 otherwise).

# Role apps, floor and shop catalogue

| Method | Path | Who | What it returns |
|---|---|---|---|
| `GET` | `/api/me` | Signed-in members | `businesses[].experience`: `{ role, title, purpose, homePath, screens[], mobileTabs[] }` |
| `GET` | `/api/customer/me` | Signed-in customers | Also includes `experience` (the customer app) |
| `GET` | `/api/floor` | Managers, front desk, owner, admin | The manager's "today on the floor" view: day counters, team status board, today's bookings, house-call safety states, and a needs-attention list. No money totals |
| `GET` | `/api/public/shops?q=` | Anyone | Published shops for customers to browse: name, town (if the owner shows it), category, service count, starting price, barbers, how many are available now, house calls, photo count, cover photo, booking link |

The **owner-only** endpoints (`viewBusinessInsights`) are:
- `/api/dashboard/summary`
- `/api/money/summary`
- `/api/growth/*`
- `/api/reports/financial-summary`
- `/api/reports/cash-flow`
- the business summary report
- `/api/staff/performance`
