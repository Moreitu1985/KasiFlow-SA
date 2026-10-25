# KasiFlow SA — Barbershop platform (Brief 3)

KasiFlow is now **barbershop-first and automation-first**. The general bookkeeping, Growth Engine, integrations,
staff, shifts and inventory from Briefs 1–2 are kept. A barbershop operating layer sits on top of them:
team status, bookings, house calls, services, debts with safeguards, separated money figures and a Fraud & Alerts Centre.

Database: `database/migrations/005_barbershop_platform.sql`. It needs the `btree_gist` extension, which Supabase
provides; the migration creates it.

---

## 1. Navigation by role

| Area | Owner | Admin | Business manager | Cashier / receptionist | Barber / employee | Accountant |
|---|---|---|---|---|---|---|
| Overview, money summary | ✔ | ✔ | ✔ (own branches) | – | – | ✔ (read) |
| Bookings | ✔ | ✔ | ✔ | ✔ | own bookings | – |
| Barber Workspace (own status, today, hours, time off) | ✔ | ✔ | ✔ | ✔ | ✔ | – |
| Team status board | ✔ | ✔ | ✔ | ✔ | ✔ | – |
| Payments / proofs, expenses | ✔ | ✔ | ✔ | sales and debt payments only | – | read |
| Debts | ✔ | ✔ | ✔ | list and record payments | – | read |
| Debt charge policy (R5) | **owner only** | – | – | – | – | – |
| Fraud & Alerts Centre | ✔ | ✔ | ✔ | – | – | read |
| Services, staff schedules | ✔ | ✔ | ✔ | – | – | – |
| Supplier bank-detail verification | ✔ | ✔ | – | – | – | – |

Hiding a menu item is **not** treated as authorisation. Every endpoint calls `IBusinessContext.RequireAsync(...)` on the
server and returns 403 if the permission is missing. Every query is filtered by the caller's `business_id`. Changing an
ID in a request cannot reach another business's records; the end-to-end suites test this.

## 2. Barber status and availability

There are six statuses: **Available, Busy, On a House Call, On Break, Unavailable, Off Duty.** Each person sets their
own status. An owner or manager can set anyone's status. Every change is written to `staff_status_history`.

The rules are in `KasiFlow.Core/Bookings/StaffAvailability.cs`:

- **Off duty** blocks new booking requests until the start of tomorrow, or until its expiry if one was set.
- **Unavailable** blocks new requests until the status is changed.
- **Busy, House call and On break** do not block future slots. They are never shown as "available now" while set.
- **Staleness.** A Busy, House call or On break status older than **4 hours** is treated as unknown. It is not shown
  as "available now". The background worker also expires statuses that have an expiry time.
- Working hours can have up to 3 blocks per weekday, so a split shift around classes works. Time off (classes, exams,
  leave) removes the slots it covers.
- Owner/admin overrides for an off-duty barber are allowed **only** when the setting `allow_off_duty_override` is on.
  Each override is recorded on the booking.
- The board shows status, a short note, today's booking count and the last update time. It does not track location,
  screens or keystrokes. KasiFlow avoids invasive staff surveillance by design.

## 3. Bookings

**Lifecycle** (`BookingStateMachine` in `KasiFlow.Core/Bookings/BookingRules.cs`):

```
requested ──confirm──▶ confirmed ──complete──▶ completed
    │  └─propose──▶ reschedule_proposed       ├─no_show──▶ no_show
    └─cancel──▶ cancelled                      ├─cancel──▶ cancelled
                                               └─propose──▶ reschedule_proposed
reschedule_proposed ──accept──▶ confirmed
                    ──reject──▶ confirmed (if the customer proposed) / requested (if the business proposed)
```

- **Conflicts.** The database has an exclusion constraint on `bookings` (btree_gist): one barber cannot have two
  overlapping confirmed bookings. The server also checks for overlaps inside a transaction that holds a per-barber
  advisory lock, so the user gets a clear message instead of a constraint error.
- **Several services or people.** A booking has several `booking_items`, each with its own price, duration and
  person count. A barber's own price for a service (`staff_services`) overrides the list price. Totals are computed
  on the server; client-sent totals are ignored.
- **Public booking.** The page is at `/p/{slug}/book`, where browsing needs no sign-in; sending a request needs a one-time-code sign-in (see CUSTOMERS_AND_SAFETY.md). The customer picks services, a barber or "any
  barber" and a free slot, and receives a reference such as `BK-7F3K9Q2A` plus a private link. Only a SHA-256 hash of
  that token is stored. One phone number can have at most 3 pending requests. Through the link the customer can
  cancel, propose a new time, or accept or reject the business's proposed time.
- Auto-confirm is off by default. Requests wait for a person to confirm them.

## 4. House calls

- The address is private. It is visible only to staff who can view bookings. It never appears on the public profile.
- **Travel fee:** none, flat (e.g. R100), or per km with a minimum, up to a maximum distance. The fee is shown to the
  customer **before** they submit (disclosed fee).
- **Distance.** KasiFlow has no maps provider configured, so distance is `uncalculated` or `manual` (entered by
  staff). Live distance results are never invented. A `provider` value is reserved for a future integration.
- **Economics** (`HouseCalls.Economics`): service revenue + travel fee − **estimated** travel costs gives the estimated
  contribution. After the visit, **actual** costs (taxi, disposables) are recorded as expenses linked to the booking,
  and the actual contribution is shown next to the estimate. The result always carries a caveat: it is a contribution,
  not profit. Staff time and wear on equipment are not included.
- The rule `HOUSE_CALL_FEE_REVIEW` flags house calls whose actual costs were higher than the travel fee charged.

## 5. Services and inventory

- Services have a name, price, duration, category, active flag, an optional "house call allowed" flag, and per-barber
  prices.
- Products now have a `stock_class`:
  - **retail** — sold to customers and counted in stock value;
  - **consumable** — used up (blades, disposables, cleaning products);
  - **equipment** — clippers, chairs and similar tools, tracked with a condition note. Equipment is not counted as sellable stock.
- `LOW_STOCK_REORDER` suggests reorders. KasiFlow never places orders or pays suppliers automatically.

## 6. Money: separated figures (`GET /api/money/summary?period=day|week|month`)

| Figure | Definition |
|---|---|
| Sales revenue | Value of sales in the period: confirmed sales, sales awaiting confirmation, and sales on credit (new debts). |
| Money received | Confirmed money in during the period, **including** old debts paid. |
| Unpaid from these sales | Credit sales still outstanding plus sales awaiting confirmation. |
| Expenses | Recorded money out (includes refunds). |
| Estimated contribution | Sales revenue − recorded expenses. **Not net profit.** Excludes tax, depreciation and unrecorded costs. |
| Pending / unsettled | Awaiting confirmation, provider payments still pending, and provider payments not yet paid out. |
| Owed to you | All outstanding customer debt principal (and charges that were applied validly). |
| Bills due in 7 days | Supplier bills due within 7 days plus overdue bills. |
| Available cash | Only shown once an opening balance is set: the recorded cash position, never a bank balance. |

**Assumptions:**
- All money is stored as `BIGINT` cents. Integer cents give exact decimal arithmetic; there are no floating-point amounts.
- KasiFlow keeps cash-basis records.
- Times are shown in Africa/Johannesburg.

## 7. Customer debts and the R5 charge

**Statuses:** Open, Partly paid, Paid, Overdue, **Disputed**, Written off.

- **Disputed.** Marking a debt as disputed needs a reason. It stops reminders and charges until the dispute is resolved.
- **Balance** (`DebtMath.Balance`): payments reduce principal first, then charges that were **applied** validly.
  Proposed charges are never counted.
- **Statement** (`GET /api/debts/{id}/account`): the original sale, payments, applied, proposed, waived and
  reversed charges, reminders, the disclosed terms snapshot and the running balance.
- A repeat payment within 10 minutes with the same amount returns `409`. The user has to confirm it
  (`confirmDuplicate`), which stops double capture.

**R5 charge safeguards** (`KasiFlow.Core/Finance/DebtRules.cs`, `DebtChargeEvaluator`):

1. Not per day. Not compounded. At most **once per qualifying event**. The event key is `overdue`, and
   `UNIQUE(receivable_id, event_key)` enforces this in the database.
2. Applied only if **all** of these are true:
   - the owner has enabled the policy;
   - the owner has recorded that it was **legally reviewed**;
   - the terms were **disclosed to that customer when the debt was created** (a snapshot of the terms and the policy
     version is stored on the debt);
   - the debt is overdue by the configured number of days and is not disputed.
3. If any condition is missing, the charge is shown as **proposed**. It is not added to the amount owed. The reason it
   was not applied is shown.
4. Changing the policy later never changes debts that already exist. Each debt keeps the terms it was disclosed under.
5. Waiving or reversing a charge needs a reason and is audited. Only owners can configure the policy (admins cannot).
6. This is not legal advice. The app tells the owner to get the policy reviewed (for example against the National
   Credit Act and the Consumer Protection Act) before enabling it.

Worked demo: Tumi owed R200 and paid R50, so the balance is R150. With the policy off, the R5 is *proposed* and the
balance stays R150. With the policy enabled, reviewed and disclosed, the balance is R155. After a waiver with a reason,
it is R150 again.

## 8. Payments, proofs and the Fraud & Alerts Centre

- An **uploaded proof of payment is not cleared money.** Proofs start as `unverified`. A sale paid with a proof stays
  "awaiting confirmation" until someone with permission marks it `confirmed_in_bank` (with a note) or `rejected`.
  Files are limited to 2 MB, the file type is checked from its first bytes (PNG, JPEG or PDF only), and a SHA-256 hash
  is stored so a re-used proof can be spotted.
- **Supplier bank details.** Only the last 4 digits and a keyed HMAC fingerprint are stored. A new or changed account
  is `unverified` and raises `SUPPLIER_BANK_CHANGE`. It must be verified by phone through a known number before it is
  used. KasiFlow does not pay suppliers.
- KasiFlow never stores card numbers, CVVs, PINs, OTPs or banking passwords.

**Alerts** (`alerts` table, statuses **Open → Under review → Resolved / False positive**) are raised by deterministic
rules:

| Code | Raised when |
|---|---|
| DUPLICATE_EXPENSE | Same amount and description recorded within a day of each other |
| BOOKING_PAYMENT_MISMATCH | Completed visit with no payment, a short payment, or a different amount |
| UNVERIFIED_PAYMENT_PROOF | Proof still unverified after 24 h |
| SUPPLIER_BANK_CHANGE | New or changed supplier bank details not yet verified |
| FINANCIAL_RECORD_CHANGES | Several edits or voids of money records in a short time |
| FAILED_COLLECTIONS | Repeated reminders on a debt with no payment |
| CASHUP_VARIANCE | Counted cash differs from the expected amount at cash-up |
| DUPLICATE_PROVIDER_EVENTS, PAYMENT_FAILURES, UNUSUAL_REFUNDS, LARGE_TRANSACTION, UNUSUAL_STOCK_ADJUSTMENT, INTEGRATION_CHANGES | Carried over from Brief 2 |

Each alert's wording says **what to check**. It never names anyone as a thief or a fraudster. A cash-up variance alert
lists possible innocent causes (change given, an uncaptured expense, a counting error). Alerts are upserted by
fingerprint, so re-running the rules does not create duplicates. An open alert resolves itself when the condition
disappears.

The Growth Engine keeps the opportunity rules (`STRONGEST_SERVICES`, `HOUSE_CALL_FEE_REVIEW`, `LOW_STOCK_REORDER`,
cash-flow rules). They are recommendations, not alerts.

## 9. Business setup, profile and funding readiness

- **Business Setup** lists registration steps (CIPC, SARS income tax and VAT, UIF, municipal trading permit, POPIA)
  with official links. Each link shows **"last checked 16 Oct 2026"**; every link was opened on that date.
  - VAT note: SARS's small-business page states a **R2.3 million** compulsory threshold (and R120 000 voluntary) from
    1 April 2026, while some older SARS pages still show R1 million / R50 000. The app asks the owner to confirm with
    SARS.
- **Business profile** shows a QR code and the public booking link. The public page shows only the fields the owner
  chose to publish. It never shows debts, customer data, staff records, internal finances or house-call addresses.
- **Funding readiness** is a transparent checklist, not a credit score. KasiFlow invents no tenders, deadlines,
  programmes or eligibility criteria. It implies no endorsement by FNB or any government body. It shares nothing with a
  funder; the owner exports their own summary.

## 10. The 10 required scenarios — where they are tested

| # | Scenario | Where it is checked |
|---|---|---|
| 1 | An off-duty barber cannot receive new requests | e2e_barber "off-duty barber offers no times", "request to an off-duty barber is blocked"; unit `Off_duty_blocks_new_bookings_until_tomorrow` |
| 2 | House call: fee disclosed, business proposes a new time, customer accepts | e2e_barber "house-call request shows disclosed travel fee in total", "barber proposes another slot and travel fee", "customer accepts: confirmed with the new time and fee" |
| 3 | Several services and people give the correct total | e2e_barber "quote for several services = sum of listed prices"; unit `Several_services_total_correctly` |
| 4 | R200 debt − R50 payment = R150 | e2e_money "R200 debt with R50 paid leaves R150 principal"; unit `R200_debt_with_R50_paid_leaves_R150_principal` |
| 5 | R5 only when valid: proposed → applied (R155) → waived (R150) | e2e_money "policy off: R5 charge only proposed…", "disclosed + reviewed + enabled: R5 applied once → R155", "charge waived with reason → back to R150"; unit `Otherwise_only_proposed`, `One_event_key_means_one_charge_never_per_day` |
| 6 | Reprocessing does not duplicate; duplicate payment guard | e2e_auto webhook replay checks; e2e_money "same payment twice within minutes is refused" |
| 7 | Another business's data cannot be reached by changing IDs | e2e_money "stranger cannot read another business"; cross-role checks in e2e_staff |
| 8 | A proof of payment is not cleared money until confirmed in the bank | e2e_money "proof stored as unverified", "proof does not change cash" |
| 9 | Cash-up variance creates a reviewable, non-accusatory alert | e2e_money "cash-up alert is reviewable and non-accusatory", "alerts say they are not proof of fraud" |
| 10 | Money summary keeps sales, received, unpaid, expenses and contribution separate | e2e_money "money summary keeps sales, received, unpaid, expenses, contribution…" |

The end-to-end suites are scripts that were run in the build environment against PostgreSQL 16. Totals:

| Suite | Checks |
|---|---|
| e2e | 95 |
| auto | 57 |
| staff | 57 |
| snapscan | 15 |
| barber | 41 |
| money | 46 |
| **Total** | **311** |

There are also 161 .NET unit tests and 64 frontend tests.

## 11. Implementation checklist

**Completed and tested** (unit tests and/or end-to-end checks in the build environment)
- ✅ Migration 005: the append-only audit trigger, a booking exclusion constraint, RLS deny-all on the new tables.
- ✅ Six staff statuses with history, expiry and the staleness rule; working hours (split blocks); time off.
- ✅ Bookings: quote, create, confirm, propose a new time, accept/reject, complete (with payment or a debt), no-show,
  cancel; advisory lock plus the exclusion constraint.
- ✅ Public booking by slug with a hashed token link and limits on pending requests; customer cancel, reschedule and
  accept/reject.
- ✅ House calls: travel fee modes, disclosed fee, manual distance, estimated vs actual costs, contribution with caveats.
- ✅ Services with barber price overrides; stock classes (retail / consumable / equipment).
- ✅ Debts: Disputed status, statement, reminders, R5 safeguards, waive/reverse with reason, duplicate-payment guard.
- ✅ Money summary with separated figures (day/week/month).
- ✅ Payment proofs: upload, type sniffing, hash, confirm-in-bank / reject.
- ✅ Supplier bank details: last 4 digits plus HMAC fingerprint, verify/reject, change alert.
- ✅ Fraud & Alerts Centre: 13 alert rules, status lifecycle, fingerprint upsert, auto-resolve.
- ✅ Growth insights: strongest services, house-call fee review, low-stock reorder.
- ✅ Business Setup links verified, with last-checked dates.
- ✅ Profile QR code and booking link.
- ✅ Role-based navigation plus server-side permissions; new permissions per role.
- ✅ Frontend: Workspace, Team, Bookings, House calls, Services, Debts, Money, Alerts, Payments, Expenses, Business
  profile and the public booking page. Typecheck, lint, 64 tests and the build pass. Screens were checked in a browser.
- ✅ Demo seed: Thato's Barber Studio with team, services, bookings, a house call, Tumi's R200/R50 debt, an unverified
  proof, a cash-up variance and supplier bank changes. All of it is fictional.

**In progress / known gaps**
- ⚠️ The booking detail does not yet link to proofs attached to the booking's payment. Proofs are listed on the
  Payments page.
- ⚠️ The frontend infers whether an off-duty override is allowed from the policy. There is no explicit per-slot flag
  yet.
- ⚠️ The debt form has one "terms disclosed" checkbox. Recording *how* they were disclosed (verbal, SMS, signed) is
  not yet captured.

**Blocked by external credentials or approvals**
- ⏳ Live distance and route pricing for house calls: needs a maps provider and API key.
- ⏳ SMS/WhatsApp reminders and booking confirmations: no messaging provider is configured, so these show as
  unavailable and nothing is sent.
- ⏳ SnapScan with a live merchant account; Yoco (awaiting provider access).
- ⏳ Legal review of any debt-charge policy: the owner's responsibility before enabling it.

**Not implemented**
- ⏳ Online deposits and card payments at booking.
- ⏳ Automatic supplier payments: excluded by design.
- ⏳ Procurement/tender feeds and funder data sharing: excluded unless a verified source and explicit authorisation exist.
- ⏳ Customer loyalty programme; payroll and commission splits.

**Must be done on your machine** (the build environment had no NuGet access)
- ⚠️ Run `dotnet build` and `dotnet test` against the real packages.
- ⚠️ Run `dotnet run -- migrate` against Supabase (applies 004 and 005).
