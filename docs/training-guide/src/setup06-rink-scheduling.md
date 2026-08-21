# 6. Rink Scheduling & Billing Setup

The newest module books the ice itself: rinks, bookings, rate cards, invoices, payments, locker-room assignments, and lobby TV displays. It is a separate module from Employee Scheduling — the two sit adjacent in the sidebar and permissions grid ("Scheduling Admin" = staff shifts; "Rink Scheduling Admin" = ice bookings and billing), so read labels carefully before granting or configuring.

## 6.1 The mental model

A facility has **rinks** and **locker rooms**. The building has **operating hours** plus holiday exceptions. Staff drop **bookings** onto a calendar — one slot, one rink, one **customer**, one **booking type**, with a **resurfacing buffer** reserved after it. Bookings can repeat as a **series**. Pricing comes from **rate cards** (prime/non-prime hourly rates plus per-type overrides), and the rate is **snapshotted onto the booking at save time** — editing a card never restates existing bookings or invoices. Later, bookings roll up into **invoices** with payments and aging. A **coverage engine** flags bookings outside operating hours or with no published staff shift covering them. Locker-room assignments feed a public **lobby display** reached by a secret URL.

Two guarantees worth teaching: all times are the facility's own wall clock, and **conflicts are enforced by the database** — the resurfacing buffer counts as occupied ice, so slots can clash even when the visible times don't touch.

## 6.2 Admin console tour

**Admin → Rink Scheduling Admin** (requires the module's Admin grant). Tabs: **Facility Setup · Rate Cards · Lists · Displays · Settings**.

**Permissions split inside the console:** facility setup, lists, and displays need the module's **edit** grant; **rate cards and settings need admin**. Role defaults seed managers at edit (deliberately: no rate access) and staff at view.

## 6.3 Facility Setup tab — do this first

1. **Seed defaults.** A "Start with the defaults" card appears on a fresh facility. It creates the standard booking types, customer types, payment methods, a Monday–Sunday 06:00–23:00 hours grid, and a zero-rate default rate card. Idempotent — existing entries are left alone. **Rinks and locker rooms are not seeded** — those are yours to name.
2. **Rinks** — name, **short code** (max 8 characters, unique — it's what the TV display shows), color, order. Maximum **10 active rinks**; nothing is bookable until at least one exists. A rink with bookings can't be deleted — deactivate it.
3. **Locker rooms** — name, short code (kept brief for the display), optional capacity, and an advisory "rink-side" default. Rooms with assignments deactivate rather than delete.
4. **Operating hours** — open/close per weekday in facility-local time, with a **Closed** checkbox per day. A close time earlier than the open time means the day runs past midnight (a 6:00–2:00 rink is entered exactly that way). Bookings outside hours are *allowed* — they're flagged as coverage gaps, not blocked.
5. **Holidays & special days** — date + label, either closed all day or with replacement hours. An exception **replaces** that day's usual hours entirely; one exception per date.

## 6.4 Rate Cards tab — enter real rates before go-live

The seed creates one open-ended default card, **"Standard Rates", at $0.00** — deliberately zero, so a placeholder rate can't be invoiced by accident. **Until you enter real rates, every booking prices at $0.00.**

A rate card has three levels:

1. **The card** — name, effective date range, **Prime/hr** and **Non-prime/hr**, and a **Default** flag. Two default cards may never overlap in dates (the app will refuse); non-default cards can.
2. **Prime windows** — per weekday, the hours billed at the prime rate ("17:00–22:00"); everything else is non-prime. A booking straddling the boundary is split and billed at both rates. A window can't wrap midnight — use one ending 23:59 and another starting 00:00.
3. **Per-type overrides** — charge a booking type differently on this card (e.g. **$0.00 for internal programs** that occupy ice but shouldn't bill cash). Types not listed bill at the card's own rates.

How a rate is chosen: cards covering the booking's date → a customer's own default card wins if it covers → otherwise the facility default → per-type override applied if present. The quote is snapshotted at save.

## 6.5 Lists tab

- **Booking types** — what a slot is for; the color is the block's color on the grid. Seeded: Ice Rental, Practice, Game, Public Skate, Learn to Skate, Camp/Clinic, and the built-in **Maintenance Block** (non-billable, undeletable — deactivate it if unused). **Billable types require a customer** on every booking; Maintenance Block is how you hold ice with no customer.
- **Customer types** — classification (Internal Program, Team, League, School, Individual…).
- **Payment methods** — how payments get recorded (Check, ACH, Card (recorded), Internal Chargeback, Cash…). "Card (recorded)" logs a card payment taken elsewhere — no card details are ever stored.

Items referenced by existing records refuse deletion — deactivate instead.

## 6.6 Displays tab — the lobby TV

Each display gets its own web address showing the locker-room schedule. Point any browser at it — a smart TV, a streaming stick, a mini PC; no app, no sign-in on the device.

- Create with a **label**, **hours ahead** (1–48), and **refresh seconds**.
- **Copy the address immediately — it is shown exactly once.** Only a hashed form is stored; if the URL is lost, revoke the display and create another.
- The URL is the credential: anyone holding it sees room names, times, and the booking's display label — never customer contact details, rates, or notes. **Revoke** kills an address instantly.
- The row shows a last-seen status ("active now", "last seen 3h ago", "never checked in") so you can tell whether the TV is actually polling.

The board itself lists each active locker room with its current occupant and the next few slots; idle rooms show "Open".

## 6.7 Settings tab

| Setting | Default | Effect |
|---|---|---|
| Resurfacing buffer (min) | 15 | Reserved after each new booking — the next slot can't start until the flood is done |
| Calendar slot (min) | 30 | The grid's snap size (5/10/15/20/30/60) |
| Coverage check | on | Flags bookings with no staff scheduled or outside hours; turning it off resolves all open gap alerts |
| Payment terms (days) | 30 | Fallback due-date offset (0 = "Due on receipt") |
| Invoice prefix | INV- | Invoice numbers: prefix + 4-digit sequence |
| Tax rate (%) | blank | Blank = no tax line at all (different from 0); snapshotted per invoice |
| Locker lead / vacate (min) | 45 / 30 | How early a team gets its room and how long they keep it |
| Display refresh (s) | 60 | How often lobby screens re-check |

Changing a default never alters bookings or invoices that already exist.

## 6.8 What staff do with it (context for your setup choices)

- **Calendar** — Day (rinks as columns), Week, Month, and Agenda views; out-of-hours time is shaded, not hidden. Booking blocks show a hatched tail for the resurfacing buffer.
- **Bookings** — click a slot, pick type/customer/times; a live **rate preview** shows the priced segments. Conflicts come back with the exact colliding bookings. Cancelling requires a reason; bookings are never deleted (invoices reference them).
- **Series** — recurring patterns (weekly to every-4-weeks, up to 400 occurrences) with a **preview step**: conflicted dates default to Skip, and nothing is written until the expansion is reviewed. Series edits offer "this occurrence / this and future / cancel series", and past dates are never rewritten.
- **Locker rooms** — assigned from the booking sheet; rooms are held from lead-time before to vacate-time after. Overlapping room assignments are allowed with a warning (fast turnovers are normal).
- **Invoices** (edit tier) — pick a customer and window, select the uninvoiced bookings, create a draft, add manual lines while draft, **Send** (locks the lines), record **payments** (append-only — mistakes are fixed by reversal, overpayment is blocked), **Void** with a reason (releases the bookings for re-billing). The **Aging** tab buckets outstanding balances (Current / 1–30 / 31–60 / 61–90 / 90+), and invoices render to a branded **PDF**.

**Permission tiers in practice:** view = see the calendar (no rates, no money) · submit = create *tentative* bookings and assign locker rooms · edit = confirm/edit/cancel, series, customers, invoicing, displays · admin = rate cards and settings.

## 6.9 Coverage — connecting ice to staffing

Every 5 minutes a background sweep checks upcoming bookings (120 days out) on two axes: within **operating hours**, and covered by a single **published Employee-Scheduling shift** spanning the whole window *including the buffer*. Gaps raise an **"Ice booked without cover"** alert in Communications (high severity when both checks fail) and notify everyone holding rink-scheduling edit/admin — one message per sweep, new gaps only. Filled gaps auto-resolve.

Two setup consequences: publish your staff schedules or every booking reads as a staffing gap, and check the **Cron health** card (chapter 8) to confirm the sweep is running.

## 6.10 Known gaps to plan around

- **Customer records are name-only for now.** Staff create customers from the booking sheet with just a name; billing address, contact info, per-customer payment terms, and per-customer default rate cards exist in the data model but have **no editing UI yet**. Invoice PDFs will show only what exists.
- **Offline is read-only** — the calendar you viewed online is browsable at /offline-rink-schedule, but bookings can't be created or edited offline (conflicts must be checked live against the database).
- Retention: bookings, invoices, and payments carry a **7-year financial floor**; customers, rate cards, and setup are configuration and never age out.

## 6.11 Rink Scheduling setup checklist

1. Module enabled in Admin → Modules; permissions granted (admin for rate owners, edit for front desk/billing, submit for pencil-in supervisors, view for everyone else).
2. **Seed defaults** pressed on Facility Setup.
3. Every rink added (name, short code, color); locker rooms added.
4. Operating hours saved; known holidays entered.
5. "Standard Rates" renamed and dated, **real prime/non-prime rates entered**, prime windows per weekday, per-type overrides (internal programs at $0.00).
6. Lists reviewed — booking-type colors and billability, customer types, payment methods.
7. Settings reviewed — buffer, slot size, terms, prefix, tax, lead/vacate.
8. Displays created and each URL copied immediately onto its TV.
9. A test booking made: rate preview correct, conflict test against the buffer, coverage flag behaves, invoice drafted and voided.
