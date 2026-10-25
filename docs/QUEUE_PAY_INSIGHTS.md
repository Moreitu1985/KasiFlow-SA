# KasiFlow SA: walk-in queue, barber pay, house-call map and shop insights

Migration: `database/migrations/007_queue_pay_insights.sql`.

## Walk-in queue
Most kasi cuts are walk-ins. Each person gets a numbered ticket for the day.

- **Joining the queue**
  - The **front desk** adds people at the counter; a name is enough.
  - **Customers** join from the shop's QR code or booking page. Like booking, this needs a one-time-code sign-in, and each person can have only one open ticket per shop.
- **Ticket steps:** waiting → called → in the chair → done. A ticket can also end as *left* or *didn't come up*.
- **Barbers** call the next person and take them, or finish their own customer. Only the desk can remove someone from the queue. A barber can't start a second cut while someone is in their chair.
- **Done:** a finished walk-in becomes a **completed booking** (source `walkin`), priced at the barber's own price. Any payment taken is recorded and linked to it, so money pages, insights and barber pay all count it.
- **Status updates:** starting a cut sets the barber's status to *Busy*; finishing sets it to *Available*.
- **Wait estimates:** the minutes of work ahead (people in front, plus what's left of the cuts in progress), shared across the barbers in the shop now. The estimate is shown as a range and is always called an estimate.
- **Customer ticket page** (`/q/{id}`): shows the number, position, estimated wait and "your turn". Customers can leave the queue from here. The link token is stored only as a hash.

## Barber pay
- Pay terms per person:
  - **commission:** a percentage of services done; travel fees stay with the shop;
  - **chair rent:** a weekly amount the barber owes the shop, pro-rated by day; the barber keeps their own takings;
  - **wage:** a weekly amount, pro-rated by day.
- **Earnings statement** (`/earnings`): built from completed visits.
  - Barbers see only their own statement; the owner can see anyone's.
  - It shows visits, walk-ins, house calls, services, commission, wage or chair rent, payouts already recorded, and the balance.
  - It is labelled "a statement to agree on, not a payslip or tax advice."
- **Barber pay** (`/payroll`, owner only):
  - shows every barber, with totals owed to barbers and owed to the shop;
  - **recording a payout** creates a *Wages* expense, or *Other income* for chair rent received;
  - KasiFlow never moves money.
- Only people with staff-management rights (owner, admin, manager) can change pay terms, and every change is audited.

## House-call map
`/map` shows today's house calls on an OpenStreetMap map, for the owner, admin, manager and front desk. It shows:
- the customer's own map pin, if they dropped one;
- the barber's last location, but only from check-ins where the barber chose to share it.

There is no background tracking, and the app doesn't calculate distances. Barbers can't open the map. Customers can drop a pin when they book a house call.

## Shop insights (owner only)
`/insights` covers completed visits over 30, 90, 180 or 365 days:
- a busiest-hours heatmap (weekday × hour) and the busiest slot;
- top services;
- per-barber visits, value, average ticket, no-show rate and repeat-customer rate;
- the share of walk-ins and house calls, and the average queue wait.

Visit values are services booked, not money received. Repeat customers are matched by account, customer record, phone number or name.

**Demo history:** the demo shop has about 90 days of visits copied from its paper appointment book (source `history`). They feed insights and barber statements but carry no linked payments, because the cash is already in the recorded takings. Payment-mismatch checks skip them.

## Endpoints

**Walk-in queue**

| Method | Path | Who | What it does |
|---|---|---|---|
| GET | `/api/queue` | Desk, manager, owner, barber | Today's queue board |
| POST | `/api/queue` | Desk | Add a walk-in |
| POST | `/api/queue/{id}/call\|start\|requeue\|done\|left\|no-show` | Desk; barbers for their own or unassigned tickets | Move a ticket to the next step; `done` can include payments |
| GET | `/api/public/profiles/{slug}/queue` | Anyone | Queue snapshot: how many are waiting and the estimated wait |
| POST | `/api/public/profiles/{slug}/queue` | Signed-in customer | Join the queue |
| GET | `/api/public/queue/{id}?t=` | Ticket holder | Ticket status |
| POST | `/api/public/queue/{id}/leave` | Ticket holder | Leave the queue |

**Barber pay**

| Method | Path | Who | What it does |
|---|---|---|---|
| GET / PUT | `/api/team/{id}/pay-terms` | PUT needs staff-management rights | Read or change pay terms |
| GET | `/api/team/{id}/earnings?from&to` | The barber themselves, or the owner | Earnings statement |
| GET | `/api/payroll?from&to` | Owner | All barbers, with totals |
| POST | `/api/payroll/payouts` | Owner | Record a payout or chair rent received |

**Map and insights**

| Method | Path | Who | What it does |
|---|---|---|---|
| GET | `/api/house-calls/map?date=` | Owner, admin, manager, front desk | Today's house calls with pins |
| GET | `/api/insights/shop?days=` | Owner | Shop insights |

## Tests
- `e2e_pro.py`: 50 end-to-end checks covering:
  - queue estimates, claiming tickets, the one-chair rule, finishing with payment, overpayment refusal and status automation;
  - customers joining by QR, token checks, leaving, and desk notifications;
  - pay terms and permissions, commission and chair-rent maths, payroll and payouts;
  - the map and owner-only insights;
  - history visits never raising mismatch alerts.
- `QueueAndPayTests.cs`: 15 unit tests for the estimator, queue steps and pay maths.
