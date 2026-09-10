# Rink Scheduling

> Brand: RinkReports. Primary green **#4DFF00**, navy **#002244**.
>
> **You only see data for your own facility — this is automatic.** You never switch facilities or see another rink's bookings, customers or invoices; RinkReports keeps each facility's records separate for you.

---

## 1. What this module is for

**Rink Scheduling is ICE-TIME booking and billing** — which rink is booked when, who it's booked for, what it costs, and whether it has been paid. It covers the whole commercial life of a booking: the calendar itself, rate cards and pricing, season-long contracts with clubs, invoicing and accounts receivable, ice-resurfacing ("cut") scheduling, locker-room assignment, a public ice-time request form, and lobby TV displays.

**This is a completely different module from Employee Scheduling**, even though both modules are called "Scheduling" in the app and sit next to each other in the admin menu. Employee Scheduling (`/admin/scheduling`) plans *who works which shift*. Rink Scheduling (`/admin/rink-scheduling`) books *ice time and bills for it* — there are no employees, shifts, or timesheets anywhere in it. The nav config carries a comment for exactly this reason:

> "Sits next to Scheduling Admin deliberately: that one is EMPLOYEE scheduling (shifts), this one is ICE scheduling (bookings and billing). Adjacent placement with distinct labels is what keeps an admin from opening the wrong console." — `src/components/admin/nav-config.ts`

If you came here looking for shift assignment, time-off, or swaps, see the **Employee Scheduling** chapter instead.

Rink Scheduling is also **revenue-critical**: every booking can carry a price (via rate cards, with a prime/non-prime split and per-booking-type overrides), and that price flows into invoices, accounts receivable aging, and season-contract billing. Getting the setup right in §4 below — rinks, operating hours, rate cards, booking types — is what makes every downstream screen (the calendar, invoices, insights) correct.

---

## 2. Who can use it

Access here is **permission-driven**, through the same per-user, per-module, per-action grants used everywhere else in RinkReports (`user_permissions`, action = `view` / `submit` / `edit` / `admin`, module = `rink_scheduling`). There is **no separate role ladder** for this module — a "front desk" person and a "biller" are simply accounts with different action grants. Grants are set under **Admin → Employees → Permissions**.

| Action on `rink_scheduling` | What it unlocks |
|---|---|
| **view** | Read the calendar: the staff dashboard schedule (`/reports/rink-scheduling`), Front Desk (`/reports/rink-scheduling/desk`), and — combined with the global Admin Center gate — the admin Ice Schedule grid in read-only form. |
| **submit** | Everything `view` grants, plus creating a **tentative** booking on the admin Ice Schedule grid. Cannot confirm a booking, move/resize one, cancel one, or touch anything money-related. |
| **edit** | Full day-to-day scheduling and billing: confirm/move/resize/cancel bookings, manage recurring series and resurface ("cut") status, assign locker rooms, decide public requests and the waitlist, manage season contracts, and everything in Invoices &amp; Insights. Also covers Facility Setup (rinks, locker rooms, operating hours, exceptions) and Displays in the admin config console. |
| **admin** | Everything `edit` grants, plus **Rate Cards** and **Module Settings** in the admin config console — and, separately, `admin` is what's required just to *open* `/admin/rink-scheduling` at all (see below). |

Two extra things worth knowing:

- **Reaching the admin config console (`/admin/rink-scheduling`) itself requires the module's `admin` action**, on top of the global Admin Center (`admin`/`admin`) grant — the page calls `requireAdmin()` *and* `requireModuleAdmin("rink_scheduling")`. Someone with only `edit` on `rink_scheduling` cannot open that console page at all, even though `edit` is enough to actually save most of what's on it (Facility Setup, Displays). In practice, grant a facility's rink-scheduling manager **both `edit` and `admin`** so the console opens and every tab saves. ⚠ VERIFY with a real account if your facility has split these grants across two people.
- **The admin Ice Schedule grid (`/admin/rink-scheduling/schedule`) only needs the global Admin Center gate plus `view`/`submit`/`edit`** on the module — it does **not** require the module's `admin` action. So a scheduler can be given Admin Center access and just `edit` on `rink_scheduling` to run the calendar day-to-day, without ever seeing the config console.
- There is also a genuinely **unauthenticated, public tier**: lobby TV boards, the ICS calendar feed, and the public ice-time request form. Nobody signs in on those — a long random link (a "display token") *is* the credential. See §3 and §4 ("Displays").

A **deactivated** account is denied everywhere, as usual.

---

## 3. How to get there

**Admin configuration** — Admin Center → Module Admin → **Rink Scheduling Admin**, or directly:

- `/admin/rink-scheduling` — the config console (tabs below are `?tab=` query params on this same URL):
  - `?tab=setup` — **Facility Setup** (default landing tab)
  - `?tab=rates` — **Rate Cards**
  - `?tab=lists` — **Lists**
  - `?tab=displays` — **Displays**
  - `?tab=settings` — **Settings**
- `/admin/rink-scheduling/schedule` — **Ice Schedule**, the live, editable booking calendar (a separate route, not a config tab — it carries its own `view`/`date`/`rink` query params).

**Staff / front-desk / customer-facing surfaces** — under **Rink Schedule** in the staff menu, or directly:

- `/reports/rink-scheduling` — **Rink Schedule**, the read-only dashboard calendar.
- `/reports/rink-scheduling/desk` — **Front Desk**, a quick-lookup agenda for phone questions.
- `/reports/rink-scheduling/requests` — **Requests & Waitlist** (`?tab=requests` or `?tab=waitlist`).
- `/reports/rink-scheduling/contracts` — **Season Contracts**.
- `/reports/rink-scheduling/invoices` — **Invoices** (`?tab=invoices`, `?tab=aging`, or `?tab=new`), plus `/reports/rink-scheduling/invoices/[invoiceId]` for one invoice and `/reports/rink-scheduling/invoices/[invoiceId]/pdf` for its PDF.
- `/reports/rink-scheduling/insights` — **Insights** (`?month=YYYY-MM`).
- `/offline-rink-schedule` — a data-free, service-worker-cacheable shell showing the last-synced calendar when you have no connection (see §8).

**Public, tokened surfaces — no login, no account** (each is a random link an admin generates in Displays):

- `/display/[token]` — a lobby TV board: locker rooms or the ice schedule, depending on the token's type.
- `/api/display/[token]` — the JSON endpoint the TV board polls (not meant to be opened by a person).
- `/api/rink-ics/[token]` — a subscribable ICS calendar feed for coaches' and leagues' own calendar apps.
- `/request-ice/[token]` — a public ice-time request form.

---

## 4. Setup & configuration (admins)

Everything here lives at `/admin/rink-scheduling`, one tab per section. A brand-new facility (no operating-hours row yet) is shown a **Seed defaults** card at the top of Facility Setup — it calls the same idempotent database seeder the facility-creation trigger runs, filling in starter rinks, hours, booking types, customer types, payment methods and a zero-rate default rate card, all with `ON CONFLICT DO NOTHING` so it can never clobber anything you've already edited.

### Facility Setup (`?tab=setup`) — needs `edit`

The root of the module: everything downstream (the calendar's columns, locker-room pickers, the TV display, coverage checks) reads from these four tables and only these four.

- **Rinks** — the ice surfaces this facility books, each a column on the calendar. Fields: name, an uppercase **short code** (≤8 characters — shown on the TV display and dense grid headers), a display colour, and optional per-rink overrides for resurface (cut) duration and ice-make buffer minutes, which fall back to the facility defaults on the Settings tab when left blank. **Capped at 10 active rinks** — this is an application rule (not a database constraint), because it bounds how many columns the calendar can render; deactivate one to add another past the cap. Deleting is refused while a rink has bookings (deactivate instead).
- **Locker rooms** — rooms that can be assigned to a booking. Fields: name, short code, optional capacity, an optional default rink ("rink-side"), notes, and sort order.
- **Operating hours** — one weekly grid, saved as a single form (all seven days upsert together). Times are the **facility's own local clock**, never UTC. A closing time earlier than the opening time means the day runs past midnight (e.g. a 6:00–2:00 rink) — enter it exactly that way rather than as two rows. A booking outside these hours is **not blocked**; it is flagged as a coverage gap (see §7, §9).
- **Holidays & special days (exceptions)** — a specific date's hours entirely replace that day's usual weekly row. Only one exception per date.

### Rate Cards (`?tab=rates`) — needs `admin`

What ice costs, and when. See §7 for the exact pricing model (rate-engine.ts). Editing a rate card, a prime window, or an override **never** changes a booking or invoice that already exists — a booking snapshots its price at save time.

- **Rate cards**: name, an effective date range (`effective_start`, optional `effective_end`), an **is_default** flag, and a flat **prime** / **non-prime** hourly rate. Only one *default* card may cover any given date (an exclusion constraint enforces it); non-default cards may overlap freely — useful for a "member rate" card a scheduler picks explicitly for one customer.
- **Prime windows** on a card: day-of-week + start/end time (facility-local). Anything not inside a prime window on that card bills at the card's non-prime rate.
- **Per-type overrides** on a card: a specific booking type can bill at its own prime/non-prime rate on that card instead of the card's own rate — e.g. $0/hr for an internal program, or a discounted youth-league rate.

### Lists (`?tab=lists`) — needs `edit`

Three lookup lists that fill the pickers elsewhere in the module:

- **Booking types** — what a calendar slot is *for* (Ice Rental, Public Skate, Figure Skating, Maintenance Block, …). Each has a colour (the block's colour on the grid), an **is_billable** flag (a non-billable type occupies ice but never reaches an invoice — a booking of that type is also allowed to have **no customer**), and an **is_resurface** flag (marks it as an ice-cut booking rather than a bookable rental). One type, **Maintenance Block**, is a built-in **system** type: it can be renamed and recoloured but never deleted, and never made billable — flipping that would orphan the customer-less bookings that rely on it staying non-billable.
- **Customer types** — how booking parties are classified (internal program, team, league, school, …). Name + sort order only.
- **Payment methods** — how a recorded payment was made. "Card (recorded)" logs that a card payment happened elsewhere; **no card details are ever stored in RinkReports.**

### Displays (`?tab=displays`) — needs `edit`

Public, tokened links — a lobby TV board, a subscribable calendar feed, or a public request form. Each is created with a **type**, a **label**, and (for the two board types only) a **look-ahead window** (1–48 hours) and a **refresh interval** (15–3,600 seconds, defaulting to the facility's module setting).

- **locker_rooms** → renders at `/display/{token}` — a live board of which room holds which team, now and next.
- **ice_schedule** → renders at `/display/{token}` — a live board of what's on each rink, now and next.
- **rink_ics** → serves at `/api/rink-ics/{token}` — a read-only ICS feed a coach or league can subscribe to in their own calendar app.
- **request_form** → renders at `/request-ice/{token}` — the public ice-time request form.

**The plaintext link is shown exactly once, right after creation**, in a "copy this address now" card. Only a SHA-256 hash of the token is ever stored — RinkReports genuinely cannot show it to you again. Lose it, and the fix is to **revoke** that link and issue a new one; **revoking** stops it working immediately (kept in the list, greyed out, for the record), while **deleting** removes the row outright.

### Settings (`?tab=settings`) — needs `admin`

One row per facility, in four groups. See §7 for the full field list. Highlights:

- **Calendar**: default ice-make (buffer) minutes, default resurface (cut) duration, the calendar's drag/snap increment, and a toggle for whether ice-make time is billed as part of the rental hour or reserved *after* it. A **coverage-check** toggle turns the "no staff / outside hours" flags on the calendar on or off facility-wide.
- **Billing**: default payment terms (days), the invoice number prefix, and an optional tax rate (blank = no tax line at all, which is a different statement from entering 0).
- **Billing emails**: whether a booking confirmation email fires automatically, whether overdue-invoice reminder emails go out, and the reminder cadence (minimum days between reminders on the same invoice).
- **Locker rooms & displays**: how many minutes before/after a booking a locker room is held (lead / vacate time), and the default TV-display refresh interval.

---

## 5. Screen-by-screen walkthrough

### Admin — Ice Schedule (`/admin/rink-scheduling/schedule`)

The live, editable booking calendar — **this is the only place any scheduling write happens** (see the callout in §8). Header: *"Book, move and cancel ice across every surface. Times are the rink's own local clock; staff see this same calendar read-only on their dashboard."*

- **Views**: Day / Week / Month / **Agenda**, with Previous/Today/Next navigation and a rink filter (week and month views, when the facility has more than one active rink). Agenda doubles as the printable daily schedule — the toolbar and shell chrome are `print:hidden`, so printing shows just the list.
- **Drag-create**: drag in a rink/day column to open the booking sheet pre-filled with that window.
- **Move / resize**: drag a block to move it to another time or rink column; drag its edge to resize. Only whole, undragged blocks move — a booking clipped by the visible day's edge (crossing midnight) is rescheduled through the sheet instead, never by dragging its visible fragment. Drags apply **optimistically** and roll back if the server rejects them (most commonly, a booking-overlap conflict once the resurfacing buffer is counted).
- **Booking sheet** (create or edit): rink, customer, booking type, title, start/end time, status (tentative/confirmed), notes. A live rate quote and any booking-overlap conflicts are fetched as you edit; on an edit, a **Locker Rooms** panel lets you assign/release rooms for that booking, and resurface bookings expose **Cut status** controls (Scheduled/Completed/Skipped) plus a shortcut to the matching Ice Operations record.
- **Toolbar tools**: **Find a slot** (available to `submit`+ accounts — a phone-call answer: pick a duration and date range, see every open window across the rinks); **Plan cuts** and **New series** (both `edit`-tier): see §6. **Coverage gaps** and **Show cancelled** are view filters, not tools.
- A **⚠** badge on a block marks a coverage gap (see §7/§9); it does not block anything.

### Staff dashboard — Rink Schedule (`/reports/rink-scheduling`)

The **same calendar component**, deliberately locked read-only: `canCreate`/`canEdit` are pinned `false` here regardless of the account's actual grants, so no edit affordance ever renders on this page. A link to **Front Desk** always shows; a **Manage schedule →** link to the admin grid appears only for `edit`-tier accounts. Requires `view`.

### Front Desk (`/reports/rink-scheduling/desk`)

A phone-call lookup tool, **also view-tier and also read-only** — no booking creation happens here despite the name. It shows: two pinned widgets ("Next resurface" per rink, "Next Public Skate"), a day picker (today ± a short window), an optional filter by booking type, and that day's agenda as a simple list (time, colour swatch, label, rink). A resurface booking is called out with a wrench icon rather than treated as an ordinary rental.

### Requests & Waitlist (`/reports/rink-scheduling/requests`) — `edit`-tier

Two tabs:

- **Requests** — new submissions from the public request form land in an inbox (requester name/email/phone, organization, requested date/window, rink if named, purpose, received-at). Approving one **creates a tentative booking** (see §6) and marks the request `approved`, linked back to the booking; declining requires a reason. The last 20 decided requests are shown underneath for reference.
- **Waitlist** — manually add an entry (a customer, or a plain contact name/phone, for a date with an optional rink and an optional time window — leaving the window blank means "any time that day"). When a booking is later cancelled, matching entries are surfaced (§6) so the desk can call while the opportunity is still warm.

### Season Contracts (`/reports/rink-scheduling/contracts`) — `edit`-tier

Open (draft/active) contracts render as cards; finished (completed/cancelled) contracts list at the bottom. Each card shows the customer, season dates, rate (a negotiated flat rate, or "Card pricing" to defer to the rate cards), billing mode (auto-invoiced on a day of the month, or manual), how far billing has progressed, notes, any **bound series** (recurring bookings this contract already covers), and the invoices it has produced. A contract inside its final 60 days with no renewal on file is flagged **expiring soon**.

### Invoices (`/reports/rink-scheduling/invoices`) — `edit`-tier

Three tabs behind one summary strip (Outstanding, Overdue invoices, Billed this month, Collected this month):

- **Invoices** — every invoice for the facility, filterable/sortable in the table.
- **Aging** — the same A/R aging buckets (Current, 1–30, 31–60, 61–90, 90+ days) shown per-customer, driven by `buildAgingReport` in `ar.ts`.
- **New invoice** — pick a customer and a date window, see exactly which of their billable, non-cancelled, not-already-invoiced bookings fall in it (pre-selected, deselectable), then generate a draft. See §6.

**One invoice** (`/reports/rink-scheduling/invoices/[invoiceId]`) shows its line items, payment history, and status-specific actions (Send, Email, Record payment, Reverse a payment, Void). **`.../pdf`** streams the same PDF document a "Send" or "Email" action attaches — one render function shared by the download route and the email path, so what a biller sees and what a customer receives are never two different documents.

### Insights (`/reports/rink-scheduling/insights`) — `edit`-tier

A month-by-month operating dashboard: ice utilization per rink (prime/non-prime/unclassified minutes, as a percentage of posted operating hours), a 6-month revenue trail (invoiced vs. collected), top customers by invoiced amount, ice time by booking type, and the same A/R aging table as Invoices. Navigable by month; defaults to the facility's current month.

### Public displays and forms (no login)

- **`/display/[token]`** — a fixed navy/lime board (deliberately *not* theme-aware — it's a lobby TV, not an app surface) polling `/api/display/[token]` on the token's configured refresh interval. The payload is an **allow-list**, not a redaction: it is built field-by-field from only what a skater needs (room or rink, a label, a time window) — there is no code path by which a customer's contact details, a rate, an invoice, or a note can reach it.
- **`/api/rink-ics/[token]`** — the same allow-list discipline, served as an ICS feed. Both this and the display API are rate-limited per-token (and, for unrecognized tokens, per the guessing attempt itself) since they are unauthenticated internet endpoints.
- **`/request-ice/[token]`** — the public request form: name, email, phone, organization, an optional specific rink (else "any rink"), a date within the next two years, a start/end time (at least 30 minutes), and an optional message. An unknown, revoked, or wrong-type token renders the same neutral "this link isn't active" screen as a legitimately-inactive one — never a message that would confirm a guess was close.

---

## 6. Step-by-step: common tasks

**Set up a brand-new facility for ice scheduling (admin)**
1. Go to **Rink Scheduling Admin → Facility Setup** and click **Seed defaults** if it's offered — this seeds starter rinks, hours, booking types, customer types, payment methods, and a zero-rate default rate card.
2. Add or rename **rinks** (each needs a short code) and **locker rooms**.
3. Set **operating hours** for the week, and add any **holiday exceptions**.
4. Switch to **Rate Cards** and set real prime/non-prime rates (and prime windows) on the default card, or add a new one.

**Book a single ice slot (admin, on the Ice Schedule grid)**
1. Go to **Ice Schedule**, navigate to the right day/week, and **drag** in a rink column (or use **Find a slot** first if you don't know what's open).
2. In the booking sheet, pick the **booking type**, a **customer** (required unless the type is non-billable), and confirm the **start/end time**. Check the live rate quote.
3. Set **status** to Confirmed (needs `edit`) or leave it Tentative (available at `submit`), then Save. A conflicting slot is refused with the details of what it collides with.

**Find and book an open slot (front-desk phone call)**
1. On the Ice Schedule grid, click **Find a slot**.
2. Choose a duration, a date range, and optionally a specific rink; the results list every open window.
3. Pick a result to open the ordinary booking sheet, pre-filled — it re-checks everything at save time like any other booking.

**Create a recurring booking series**
1. On the Ice Schedule grid, click **New series** (`edit`-tier).
2. Pick the rink, booking type, customer, day(s) of the week, a time window, a date range, and the recurrence interval (every N weeks).
3. Click **Preview** — every occurrence is expanded and checked for conflicts before anything is written; conflicted dates default to **Skip**, but you can choose to book them anyway or pick something else.
4. **Commit** — each occurrence is priced against whichever rate card was in effect *on that occurrence's own date*, so a series spanning a rate-card change bills correctly across the boundary.

**Plan and apply today's ice cuts**
1. On the Ice Schedule grid, click **Plan cuts** (`edit`-tier).
2. Pick a day (and optionally one rink) and **Preview** — RinkReports proposes a resurface booking in every gap between consecutive rentals on that rink-day that is long enough for the configured cut duration, skipping gaps that already have (or sit next to) a cut.
3. **Apply** — the plan is **recomputed from scratch at apply time**, never trusted from the preview; any gap a concurrent booking has since filled is skipped and reported rather than double-booked.

**Handle a public ice-time request**
1. Open **Requests & Waitlist → Requests**.
2. Review the requester's details, date/window, and message. Pick a rink (required if the requester left it as "any rink").
3. **Approve** — this creates a tentative booking and links the request to it; or **Decline** with a reason. A conflict on approval leaves the request undecided so you can pick another rink or handle it by hand.

**Set up a season contract and bind a recurring series to it**
1. Open **Season Contracts → Create contract**: pick the customer, name it, set the season's start/end dates, an optional negotiated rate (blank defers to rate cards), and whether it auto-invoices (and on what day of the month, 1–28).
2. On the contract card, **bind** an existing recurring series for that same customer to the contract — only unbound series for that customer are offered.
3. From then on, the season-contract cron bills the bound series' bookings each month in arrears once the invoice day passes, advancing the contract's billed-through cursor one month at a time.

**Generate, send, and collect on an invoice**
1. Open **Invoices → New invoice**, pick the customer and a date window, and **Find** — every billable, uninvoiced booking in that window for that customer is listed and pre-selected.
2. Deselect anything you don't want on this invoice, add optional notes, and **Generate** — this creates a **draft**.
3. Open the invoice and **Send** (marks it sent; emails the customer if the facility's confirmation-email settings allow it) or use **Email** separately to resend the PDF.
4. As payments come in, **Record payment** (amount, date, method, optional reference) — the invoice's status (sent → partially paid → paid) is always **derived** from the payment total, never set by hand. A mistaken payment is corrected with **Reverse**, never edited or deleted.

**Publish a lobby display or public request link**
1. Open **Rink Scheduling Admin → Displays → Add link**, choose the type (locker room board, ice schedule board, calendar feed, or request form), and a label.
2. **Copy the address immediately** — it's shown exactly once and cannot be retrieved again.
3. Open it on the lobby TV browser (for a board) or share it (for the feed or the request form). If it's ever lost or compromised, **revoke** it and create a new one.

---

## 7. Field reference

### Rate card pricing model (rate-engine.ts) — how a booking's price is actually derived

1. **Pick the rate card** in effect for the booking's **facility-local start date**: a card whose `effective_start`–`effective_end` covers that date. A customer's own `default_rate_card_id` wins outright if it covers the date; otherwise the **default** card covering the date wins; if several defaults somehow qualify, the one with the latest `effective_start` wins; with no default at all, the latest-starting covering card wins. No covering card at all means the booking cannot be priced (a `problem` string is returned rather than silently pricing at $0).
2. **Slice the booking into prime / non-prime segments.** Prime windows are day-of-week + time-of-day ranges *in the facility's own zone* (not UTC), so the engine walks every local calendar day the booking touches, projects each day's prime windows into UTC instants for that specific date (correct across DST transitions), and cuts the booking wherever a boundary falls inside it. A slot straddling a prime boundary becomes two (or more) priced segments — never one rate "rounded" to a majority.
3. **Rate per segment**: the card's own prime/non-prime hourly rate, unless a **per-type override** exists for this card + this booking type, in which case the override's rate is used instead.
4. **Total and rounding**: each segment's amount is computed at full precision; rounding to the cent happens **once, on the sum** — never per segment, which is what stops two half-cent segments drifting a cent from the honest total.
5. **What gets saved**: a booking that lands wholly in prime or wholly in non-prime snapshots that single hourly rate (`rate_snapshot_hourly`) and whether it was prime (`rate_snapshot_prime` = true/false). A booking that straddles both snapshots `rate_snapshot_hourly` as **null** and `rate_snapshot_prime` as **null** — there is no single honest rate to name — and the blended total lives only in `computed_amount`. Invoicing always bills the **quoted `computed_amount`**, never a hours × snapshot-rate recompute, specifically because that recompute is wrong for a straddled booking (it would bill hours × null = $0) and drifts by a cent even for a uniform-rate booking due to hour rounding.
6. **Nothing here ever restates history.** A later edit to a rate card, a window, or an override changes only *future* quotes — every booking and invoice keeps the rate it was saved with.
7. A **non-billable** booking type (e.g. Maintenance Block) is never priced at all — its quote is `$0` with no rate card involved, and it never reaches an invoice.

### Rate card

| Field | Notes |
|---|---|
| Name | Free text, e.g. "2026–27 Season". |
| Effective start / end | End is optional (open-ended). |
| Default | At most one **default** card may cover any given date (enforced by a database exclusion constraint). Non-default cards may overlap freely. |
| Prime rate / hr | Flat rate for time inside a prime window. |
| Non-prime rate / hr | Flat rate for everything else on the card. |
| Prime windows | Day of week + start/end time, facility-local. A window may not wrap past midnight — enter it as two windows (…–23:59 and 00:00–…) instead. |
| Per-type overrides | Booking type → its own prime/non-prime rate on this card only. |

### Rink

| Field | Notes |
|---|---|
| Name | Free text. |
| Short code | ≤8 characters, upper-cased — shown on the TV display and grid headers. |
| Colour | The block colour for this rink's bookings. |
| Resurface (min) override | Cut duration for this sheet; blank uses the facility default. |
| Ice-make (min) override | Buffer minutes for this sheet; blank uses the facility default. |
| Sort order | Column order on the calendar. |
| Active | Deactivated rinks don't count toward new bookings; capped at 10 active. |

### Locker room

| Field | Notes |
|---|---|
| Name / Short code | Short code shows on the TV board. |
| Capacity | Optional, 1–500. |
| Rink-side | Optional default rink association. |
| Notes | Optional, admin-only (never shown on the public display). |

### Booking (calendar / booking sheet)

| Field | Notes |
|---|---|
| Rink | The sheet the booking occupies. |
| Customer | Required unless the booking type is non-billable. |
| Booking type | Drives colour, billability, and whether it's a resurface booking. |
| Title | Optional free-text label. |
| Start / End | Facility-local wall clock in the sheet; stored as UTC. |
| Status | Tentative, Confirmed, or Cancelled (cancellation requires a reason and is a soft state, not a delete). |
| Notes | Optional. |
| Buffer (ice-make) minutes | Snapshotted at save time from the rink/facility settings in effect then. |
| Rate snapshot (hourly, prime) | Set for a wholly prime or wholly non-prime booking; both null for a straddled one. |
| Computed amount | The quoted total actually billed; null (not $0) when nothing could price it. |

### Module settings

| Setting | Effect |
|---|---|
| Ice-make time (minutes) | Facility default buffer after a rental; overridable per rink. |
| Resurface duration (minutes) | Facility default cut length; overridable per rink. |
| Calendar slot (minutes) | The grid's drag/snap increment (5/10/15/20/30/60). |
| Ice-make included in rental | On: buffer time is billed as part of the booked hour and nothing is blocked afterward. Off (most rinks): buffer minutes are reserved *after* each booking. Either way, invoicing always bills the booked hours. |
| Flag bookings with no staff / outside hours | Turns the coverage-gap badges on/off. |
| Payment terms (days) | Default days-to-due on a new invoice; a customer's own terms override it. |
| Invoice prefix | ≤12 chars, letters/numbers/hyphens. |
| Tax rate (%) | Blank = no tax line at all (different from 0%). |
| Send booking confirmation emails | Emails the customer's billing contact on booking creation. |
| Send overdue invoice reminders / cadence | A daily job nags customers past their due date, at most once per cadence period per invoice. |
| Locker lead / vacate minutes | Padding before/after a booking a locker room is considered held. |
| Display refresh (seconds) | Default poll interval offered when creating a new board-type display link. |

### Booking type

| Field | Notes |
|---|---|
| Name / Colour | Colour is the block colour on the grid. |
| Billable | Off = occupies ice, never invoiced, and bookings of this type may have no customer. |
| Ice resurface | Marks bookings of this type as cuts, not rentals. |
| Built-in (system) | Only true for **Maintenance Block**: cannot be deleted or made billable. |

### Season contract

| Field | Notes |
|---|---|
| Customer | Required. |
| Name | ≤160 characters. |
| Season start / end | End must be after start. |
| Contract rate | Optional flat hourly rate; blank defers to rate cards. |
| Auto-invoice | Bills the bound series' bookings monthly in arrears once on. |
| Auto-send | Sends (and emails) each auto-generated invoice immediately rather than leaving it a draft for review. |
| Invoice day of month | 1–28 (so it exists in every month). |
| Status | Draft → Active → Completed, or Cancelled (with a reason). |

### Invoice / line item / payment

| Field | Notes |
|---|---|
| Status | Draft, Sent, Partially paid, Paid, or Void — **always derived** from the payment total against the invoice total, never set directly. A void invoice stays void no matter what has been paid against it. |
| Issue date / Due date | Due date = issue date + payment terms. |
| Subtotal / Tax / Total | Tax computed once on the subtotal, snapshotted at generation — a later settings change never restates an issued invoice. |
| Line item | Either tied to a booking (its description, hours, and rate are derived from that booking) or a **manual** line (booking_id is null) for something the calendar doesn't cover. |
| Payment | Always positive; correcting one means recording a **reversal** (a negative payment referencing the original), never editing or deleting the row. Overpayment is refused outright. |

### Waitlist entry

| Field | Notes |
|---|---|
| Customer or contact name/phone | At least one is required. |
| Desired date | Required. |
| Rink | Optional — blank matches any rink. |
| Start / End minute | Optional — blank matches any time that day. |
| Notes | Optional. |

---

## 8. Locking, saving & offline

### There is no draft/publish lock the way Employee Scheduling has one

A booking has its own small lifecycle — **tentative → confirmed**, either of which can move to **cancelled** — but there is no separate "publish" step and no requester/approver split the way shift publishing works. `submit`-tier accounts can create tentative bookings; confirming, moving, resizing, or cancelling any booking needs `edit`. Cancelling is a **soft** state (status = cancelled, with a stamped reason, actor, and timestamp) — bookings are never hard-deleted from the calendar.

### The database exclusion constraint is the real conflict authority

Every booking write is attempted first and only translated into a friendly message on rejection — RinkReports does not pre-check-then-hope. Two bookings on the same rink whose windows overlap **once the resurfacing buffer is counted** are refused by a database exclusion constraint (`23P01`), and the app looks up what it collided with purely to explain the rejection. Drag-move and drag-resize on the calendar apply **optimistically** and roll back to the server's answer if the write is refused.

### Snapshotting: nothing rewrites history

A booking's price (`rate_snapshot_hourly` / `rate_snapshot_prime` / `computed_amount`) and its buffer minutes are captured **at save time** and never silently recomputed later — editing a rate card, a rink's overrides, or the module's buffer settings only changes what a *future* booking or edit will use. The same principle governs invoices: tax rate and line amounts are snapshotted at generation, so a later settings change never restates a document already issued.

### Online-only, by design — and a genuine difference from Employee Scheduling

CLAUDE.md documents that Employee Scheduling deliberately queues two staff actions offline (submit availability, request time off) because those don't depend on live shift state. **Rink Scheduling has no offline write path anywhere, for any account tier** — not the admin calendar, not the staff dashboard, not Front Desk, not requests, invoices, or contracts. Every write in this module goes through a server action that re-validates against the database's exclusion constraints at the moment it runs, and — as `calendar-client.tsx` states directly —

> "Viewing the calendar online is what populates the offline copy — there is no separate sync step. Writes are NOT cached: booking conflicts are enforced by a database exclusion constraint that re-checks at insert time, so a booking queued offline could be accepted against a world that has since moved on."

What **does** exist offline is a **read-only cached view**: every time you view the staff dashboard calendar online, it silently saves a copy of what you saw (bookings, rinks, colours) to that browser's local IndexedDB, keyed to your account. `/offline-rink-schedule` — a deliberately data-free, service-worker-cacheable page outside the normal `/reports` layout (so its shell carries no user data before the client component loads) — reads that cache and shows it with a plain banner: **"You're offline — bookings can be viewed but not created or edited,"** noting when the snapshot is more than a day stale. If you've never opened the calendar online on that device, it says so instead of showing nothing unexplained.

The public display boards (`/display/[token]`) and the ICS feed similarly have no offline story of their own — a lobby TV or a subscribed calendar app simply shows whatever it last successfully fetched, per its own polling interval.

---

## 9. Troubleshooting & FAQ

**"I opened Rink Scheduling Admin but every save says I don't have permission."**
The console page itself only requires the module's `admin` action (plus the global Admin Center grant) — but most of what you'll actually save there (rinks, locker rooms, hours, exceptions, display links) is checked against the `edit` action, and rate cards / module settings are checked against `admin`. If your account has only one of the two, ask a super admin to grant **both `edit` and `admin`** on Rink Scheduling.

**"A staff member says they can't book or edit anything on their dashboard."**
That's correct and intentional — the dashboard calendar at `/reports/rink-scheduling` is **read-only for everyone**, whatever permissions the account holds. All scheduling writes happen on the admin Ice Schedule grid (`/admin/rink-scheduling/schedule`), which itself needs Admin Center access. Front Desk is also read-only, for the same reason.

**"My booking was refused with an overlap error, but the calendar looked empty there."**
The overlap check counts the **resurfacing buffer** after the existing booking, not just its visible end time — a slot that looks free right after another booking may still fall inside its ice-make window. Check the facility's ice-make setting (or that rink's override) on the Settings/Facility Setup tabs.

**"Why does this booking have no price, or show $0.00 for the wrong reason?"**
A blank/"—" price means no rate card covers that date at all — add one, or extend an existing card's date range. A **genuine** $0.00 only happens for a non-billable booking type (e.g. Maintenance Block) or an explicit $0 per-type override; those are two different situations and the UI distinguishes "unpriced" (null) from "free" (zero) throughout.

**"I edited a rate card and now an old invoice looks wrong to me."**
It shouldn't have changed — every booking snapshots the rate it was priced at when saved, and every invoice snapshots its own tax and line amounts at generation. Editing a rate card only affects bookings priced *after* the edit.

**"A recurring series skipped some dates when I created it."**
That's the conflict-safe design: previewing a series shows every occurrence and defaults any date that collides with an existing booking to **Skip**, so you can review before anything is written. Choose "book anyway" on a previewed occurrence if you want it created despite the collision (it will still be refused at commit time if the conflict is still there).

**"Plan cuts skipped a gap I expected a cut in."**
Either the gap is shorter than the configured cut duration, it already has a resurface booking in it (or immediately next to one — cutting twice around a cut is treated as noise), or it isn't *between* two rentals (RinkReports never proposes a cut before the first booking of the day or after the last one — schedule opening/closing floods yourself).

**"I lost the address for a lobby display / request form."**
There's no way to look it up again — only a hash is stored. **Revoke** the old link and create a new one; revoking takes effect immediately.

**"Someone's calling about an ice-time request/waitlist entry and I can't find it."**
New public requests land under **Requests & Waitlist → Requests**; once decided (approved or declined) they drop into the "Decided recently" list (last 20). Waitlist entries never expire on their own — resolve or remove them once they're satisfied or no longer wanted.

**"An invoice's status looks wrong after I recorded a payment."**
Status is always **computed** from the payment total against the invoice total — you cannot set it directly. If a payment amount was wrong, **reverse** it (a reversal is its own negative payment record) rather than trying to edit or delete the original; the status recalculates automatically.

**"The calendar showed something different when I went offline."**
`/offline-rink-schedule` shows whatever was last cached the last time you viewed the calendar **online** on that device — it can be up to a day (or more) stale, and the banner says so. Reconnect and reopen the live calendar to refresh it; you cannot create or edit anything while offline, on any screen in this module.

---

## Source (footnote)

Admin config: `src/app/admin/rink-scheduling/{page.tsx,actions.ts,types.ts}`, `_lib/{config.ts,config.test.ts}`, `_components/{facility-setup-tab,rate-cards-tab,lists-tab,displays-tab,settings-tab,seed-defaults-card}.tsx`, `schedule/page.tsx`.

Admin booking calendar surface: `src/app/reports/rink-scheduling/_components/{calendar-client.tsx,booking-sheet.tsx,series-sheet.tsx,plan-cuts-sheet.tsx,find-slot-sheet.tsx,locker-room-panel.tsx,use-grid-drag.ts,rink-schedule-readonly.tsx,offline-rink-schedule.tsx,not-available.tsx}`, `_lib/{grid-model.ts,month-model.ts,drag-model.ts,find-slot.ts,series.ts,rate-engine.ts,rate-engine.test.ts,insights.ts,desk-agenda.ts,load-calendar.ts,types.ts}` and their test files.

Staff/front-desk/customer-facing pages and actions: `src/app/reports/rink-scheduling/{page.tsx,desk/page.tsx,requests/page.tsx,contracts/page.tsx,insights/page.tsx,invoices/page.tsx,invoices/[invoiceId]/page.tsx,invoices/[invoiceId]/pdf/route.tsx}`, `_components` under `requests/`, `contracts/`, `invoices/` (`request-inbox`, `waitlist-panel`, `contract-card`, `contract-form`, `invoice-table`, `invoice-detail`, `new-invoice-panel`, `aging-table`), and `actions.ts`, `contract-actions.ts`, `invoice-actions.ts`, `find-slot-actions.ts`, `locker-actions.ts`, `request-actions.ts`, `resurface-actions.ts`, `resurface-plan-actions.ts`, `series-actions.ts`.

Domain logic: `src/lib/rink-scheduling/{booking-request.ts,booking-email.ts,contract-invoices.ts,coverage.ts,coverage-sweep.ts,buffer.ts,resurface.ts,resurface-plan.ts,invoice-generation.ts,invoice-pdf.tsx,invoice-pdf-data.ts,invoice-email.ts,overdue.ts,overdue-reminders.tsx,season-contracts.ts,waitlist-match.ts,locker-display.ts,ice-schedule-display.ts,display-rate-limit.ts,public-tokens.ts,ar.ts,deliver-booking-email.ts,deliver-invoice-email.tsx}` and their test files.

Public tokened surfaces: `src/app/display/[token]/page.tsx`, `src/app/api/display/[token]/route.ts`, `src/app/api/rink-ics/[token]/route.ts`, `src/app/request-ice/[token]/page.tsx`, `src/app/offline-rink-schedule/{page.tsx,layout.tsx}`.

Permission model: `src/lib/permissions/actions.ts`, `src/lib/permissions/check.ts`, `src/lib/auth/require-module-admin.ts`, `src/components/admin/nav-config.ts`.
