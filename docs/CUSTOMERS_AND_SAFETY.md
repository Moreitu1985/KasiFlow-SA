# KasiFlow SA — Customers, barbers and house-call safety (Brief 4)

Migration: `database/migrations/006_customers_safety_portfolio.sql`.

## Three ways to sign in

| Who | How | Lands on |
|---|---|---|
| **Customer** | `/c/sign-in`: a one-time code sent to their email. No password and no profile form. SMS codes are added later (see below). | `/c` (My bookings) |
| **Barber** | The owner registers them and shares a one-time invite link (`/join?token=…`). The barber signs up or signs in with the invited email. | `/workspace` (barber screen) |
| **Shop owner** | Email and password sign-up, then business onboarding. | `/app` |

A customer account is **not** a business membership. With a customer account you can only see your own bookings (across
shops) and your own saved details. Business endpoints return 404 for it.

### One-time codes (Supabase setup)
1. In Supabase, go to **Authentication → Emails → Magic Link**. Make sure the template contains `{{ .Token }}` so the
   email shows the 6-digit code. The link in the email also works.
2. Add your site URLs (for example `http://localhost:5173/**` and your production URL) under
   **Authentication → URL Configuration → Redirect URLs**.
3. Supabase's built-in email sender is only for testing. It is heavily rate-limited and may only deliver to your own
   team's addresses. Before real customers use the app, configure **custom SMTP** in Supabase.
4. To turn on **SMS codes** later:
   - connect an SMS provider in Supabase (**Authentication → Providers → Phone**, e.g. Twilio, MessageBird, Vonage or
     Textlocal; each SMS costs money);
   - then set `VITE_CUSTOMER_SMS_OTP=true` in the web app's environment.
   The API already accepts the verified `phone` claim.

The verified email or phone always comes from the validated Supabase token. The API never takes it from the request.

## Demo logins for every role
Run once from `KasiFlow.Api` (after `migrate`):
```
dotnet user-secrets set "Supabase:ServiceRoleKey" "<service_role or sb_secret_ key>"
dotnet run -- demo-users
```
It creates, in your Supabase project, an owner, a business manager, a receptionist, two barbers and two customers (all
@example.com, fictional), seeds Thato's Barber Studio for the owner, links each person to it, and prints random passwords,
also saved to the git-ignored `demo-logins.local`. Re-running resets the passwords **and rebuilds the demo shop**
so today's bookings, walk-in queue, house call, barber statuses, 90 days of visits, pay terms and the cash forecast are
current — run it on the morning of a demo. Only the shop flagged `is_demo` and owned by the demo owner login is ever
removed; your own business is never touched. Add `--keep` to leave the existing demo shop as it is. Demo customers sign in with a password
only when `VITE_DEMO_PASSWORD_SIGNIN=true` is set in the web app; real customers always use one-time codes.

## Booking rules
- **Everyone verifies before booking.** `POST /api/public/profiles/{slug}/bookings` returns 401 without a signed-in
  customer. The catalogue, prices, barbers and free times stay public.
- **Shop visits** need only the verified sign-in. The name is remembered for next time.
- **House calls need a complete account**: full name, verified email or phone, a contact phone, a street address,
  suburb or town, and agreement to the house-call safety terms (versioned, currently `house-call-safety-v1`). If
  anything is missing, the API refuses with a list of what to add.
- One customer account can have at most **3 waiting requests** per shop.
- A shop can **block house calls** for a customer account. This is a manual decision by an owner or manager, with a
  reason, and it is audited. Lifting the block also needs a reason. A blocked customer can still book at the shop.
- A customer can delete their saved details (`DELETE /api/customer/me`). Bookings keep the name and contact they were
  made with, because the shop needs them for its records. Deleting the sign-in account itself is done in Supabase Auth.

## House-call safety
- The barber taps **Left for the visit → Arrived → Finished → Back safely**. The order is enforced.
  - "Left" sets their status to *On a house call*.
  - "Back safely" sets it to *Available*.
- **I need help** raises a critical alert in the Fraud & Alerts Centre (labelled "Barber safety") and a critical in-app
  notification for owners and managers. It stays active until someone records **All clear**.
- **Late check-in**: the worker checks every 30 seconds. An alert is raised when there is:
  - no check-in by the start time plus the grace period (30 minutes by default,
    `business_settings.house_call_checkin_grace_minutes`), or
  - no "Finished" by the end time plus the grace period.

  The alert wording says this is often a busy barber or a flat phone and asks the owner to phone. Arriving or finishing
  closes it.
- **Location** is attached only when the barber ticks "Share my location with this check-in" for that one tap. There is
  no background tracking.
- A manager can record a check-in on the barber's behalf (for example after a phone call), but must say how they know.
- Check-ins are **append-only**: a database trigger blocks UPDATE and DELETE. They are also audited, including whether
  a location was shared.
- **Emergency advice is always shown**: SAPS **10111**, or **112** from a cell phone. KasiFlow sends in-app alerts only;
  it cannot call or SMS anyone, and the screens say so.
- The safety alert codes (`HOUSE_CALL_HELP`, `HOUSE_CALL_OVERDUE`) are never auto-closed by the growth engine.
- **Customer account card** (booking detail, for staff who can see the booking):
  - verified contact and member since;
  - visits, no-shows and cancellations **with this shop only**;
  - factual safety notes (access, pets, conduct, safety concern, other).
  A "safety concern" note notifies managers. Notes are internal and never public. Another business sees nothing.
- **Barber emergency contact** (optional, on the barber's profile) is visible only to managers and to the barber
  themselves.

## Barber registration and portfolio
- **Register a barber** (`/team/register`, owners/admins/managers):
  - details, including private contact and emergency fields;
  - services they offer, with an optional own price;
  - weekly hours and whether they do house calls;
  - optionally a login email.

  The result is a one-time invite link (Copy, or share on WhatsApp). **No email is sent automatically.** When the
  barber accepts, their login is linked to the profile.
- **Portfolio ("My work")**:
  - Barbers manage their own photos; managers manage anyone's.
  - Files are JPEG, PNG or WebP only (checked from their first bytes), up to 3 MB, at most 24 per barber.
  - Each upload **requires confirming that the customer in the photo agreed** to it being shown publicly.
  - Photos can be hidden. Public photos are served only while the shop's profile is published.

## Endpoints

**Customer** (signed-in customer, no business header):

| Method | Path | What it does |
|---|---|---|
| `GET` / `PUT` / `DELETE` | `/api/customer/me` | Read, update or delete the saved profile |
| `GET` | `/api/customer/bookings` | The customer's bookings at every shop |
| `GET` | `/api/customer/bookings/{reference}` | One booking |
| `POST` | `/api/customer/bookings/{reference}/{op}` | `op` is cancel, reschedule, accept-proposal or reject-proposal |
| `POST` | `/api/public/profiles/{slug}/bookings` | Create a booking (now requires sign-in) |

**Public** (no sign-in):

| Method | Path | What it does |
|---|---|---|
| `GET` | `/api/public/profiles/{slug}/booking` | The catalogue: barbers' bio, specialties, own prices and photo URLs |
| `GET` | `/api/public/profiles/{slug}/photos/{id}` | One public photo |

**Team** (business-scoped):

| Method | Path | What it does |
|---|---|---|
| `POST` | `/api/team/register-barber` | Register a barber |
| `POST` | `/api/team/{id}/login-invite` | Send a login invite for an existing profile |
| `GET` / `POST` | `/api/team/{staffId}/portfolio` | List or upload photos (upload is multipart) |
| `PUT` / `DELETE` | `/api/team/{staffId}/portfolio/{photoId}` | Change or remove a photo |
| `GET` | `/api/team/{staffId}/portfolio/{photoId}/file` | The photo file (needs sign-in) |

**Safety** (business-scoped):

| Method | Path | What it does |
|---|---|---|
| `GET` | `/api/bookings/{id}/safety` | The house-call safety panel |
| `POST` | `/api/bookings/{id}/safety/check-ins` | Record a check-in |
| `GET` | `/api/bookings/{id}/customer-account` | The customer account card |
| `POST` | `/api/bookings/{id}/safety-notes` | Add a safety note |
| `POST` | `/api/customer-accounts/{userId}/house-call-block` | Block house calls (`{ reason }`) |
| `POST` | `/api/customer-accounts/{userId}/house-call-block/lift` | Lift the block (`{ reason }`) |

## Tests
- `e2e_customers.py`: 80 end-to-end checks. They cover:
  - customer access isolation and verified-contact handling;
  - account completeness and blocks;
  - pending limits and cross-customer and cross-business isolation;
  - check-in ordering, on-behalf notes, location validation and help/all-clear alerts;
  - growth refresh not closing safety alerts;
  - append-only check-ins and the background overdue alert;
  - barber registration, invite and accept, profile linking and barber permissions;
  - portfolio consent, image sniffing, public/hidden photos and unpublished profiles;
  - customer data deletion.
- `HouseCallSafetyTests.cs`: 10 unit tests for the safety state machine, account readiness and image sniffing.
- Frontend: 16 new vitest tests (customer helpers, catalogue grouping, WhatsApp share URL, safety labels).

## Known limits
- Customers are not notified by SMS, email or WhatsApp when the shop confirms or proposes a time; they see it under
  My bookings. A messaging provider is needed for that.
- The safety alerts are in-app only. Owners need the app open or must check notifications. Push notifications are not
  implemented yet.
- Photos are stored in PostgreSQL. For many shops, move them to private object storage with a CDN.
