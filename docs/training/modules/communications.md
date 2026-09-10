# Communications

*RinkReports training guide — Communications module*

---

## 1. What this module is for

Communications is the facility's messaging and alerting hub. It does two distinct jobs under one roof:

- **Alerts.** Other modules — Ice Operations, Refrigeration, Air Quality, Accident Reports, Incident Reports, Scheduling, Rink Scheduling — automatically raise an **alert** when something trips a configured trigger (an out-of-range refrigeration reading, an air-quality exceedance, a severity-flagged incident, and so on). Alerts land in this module's inbox for everyone with access to see, and **routing rules** decide who additionally gets notified by in-app message and email.
- **Messaging.** Staff send in-app messages to recipient **groups** (and reply to messages they've received); admins can **broadcast** to groups, a role, or the whole facility, either immediately or on a schedule; and admins can set up **recurring reminders** that resend a template on a cron-like schedule.

Behind those two staff-facing jobs sits the admin configuration that makes them work: **Templates** (reusable subject/body presets), **Groups** (named recipient lists), **Routing** rules (which alerts notify whom, how, and when), **Reminders**, a **Deliveries** view for retrying failed sends, and an **Audit Log**.

**How a submission becomes an alert, in five steps:**

1. A staff member submits a report elsewhere in the app. If it trips a configured trigger, that module raises a **communication_alert**.
2. **Routing rules** match the alert (by source module, severity, and optionally area) and fan it out to their targets on the rule's timing — immediately, in an end-of-day digest, or weekly.
3. Matched recipients get an **in-app message** and an **email**; if the rule attaches a PDF, a rendered PDF of the source submission is linked in the message and attached to the email.
4. If the rule requires acknowledgement, recipients must acknowledge it from their inbox — admins can watch the acknowledgement list on the alert.
5. Background jobs run every few minutes to render PDFs, drain the notification queue, and send emails, retrying automatically; anything that fails permanently for good surfaces in **Deliveries** for a manual retry.

One thing that surprises new admins: **routing rules control who gets *notified*, not who can *see* an alert.** Every alert your facility generates shows up in the Alerts inbox for **every** employee with view access to Communications — routing only decides who additionally receives an in-app message + email for it. With no routing rules configured at all, alerts still appear in the inbox; they simply don't fan out to anyone's message list.

> **You only see data for your own facility — this is automatic.** There's no facility switcher, and you can't see another rink's alerts, messages, groups, or routing rules.

---

## 2. Who can use it

Access is **permission-driven**, not tied to a job title: an administrator grants each person **view**, **submit**, and/or **admin** on the `communications` module independently, per facility (`user_permissions`). Note that "editing" someone else's sent message isn't a thing this module supports at all — messages and alerts aren't edited in place by anyone, staff or admin (see §8).

| Role tier (doc vocabulary) | Typical access to Communications |
|---|---|
| **super_admin** | Full: sees the facility's Alerts/Messages/Sent inbox, composes and sends messages, plus the full admin console (Broadcast, Templates, Groups, Routing, Reminders, Deliveries, Audit Log). |
| **facility_manager** (live role: `admin`) | Same, for their own facility — **provided** their account also holds the module-scoped **communications `admin`** permission (see note below); passing the general Admin Center gate is not by itself enough. |
| **supervisor** (live role: `manager`, or a custom role) | ⚠ VERIFY — typically granted `view` and `submit` on Communications by default: sees the inbox, acknowledges alerts/messages, composes and replies. Reaches the admin console only if separately granted the module's `admin` permission. |
| **staff** (live role: `staff`, or a custom role) | Sees the inbox and can acknowledge alerts/messages if granted **view**; can compose new messages and reply if granted **submit**. **No access** to the admin console (Broadcast, Templates, Groups, Routing, Reminders, Deliveries, Audit Log). |

Notes confirmed in code:

- The staff inbox (`/reports/communications`) requires the **view** permission for `communications`. Without it: *"You don't have permission to view communications."*
- Composing or replying (`/reports/communications/compose`) requires **submit**. Without it, the "New message" button doesn't appear, and hitting the compose URL directly shows *"You don't have permission to send messages."*
- Staff sends are restricted to **groups flagged "Staff can message this group"** — an admin's own compose (Broadcast) isn't limited that way. A **reply** is the one exception to "groups only": a non-admin may reply directly to the sender of a message they actually received, and only to that sender.
- The **admin console** (`/admin/communications`) is gated **twice**: `requireAdmin()` (general Admin Center access — see the Admin Control Center chapter) **and** `requireModuleAdmin("communications")`, the module-scoped `admin` grant that the RLS write policies also key off (`has_module_admin_access('communications')`). Someone with general admin access but not this specific grant is sent to `/forbidden` before the console even renders. Every admin server action re-checks the same grant server-side and, if it's missing, returns: *"Your account has admin console access but not the communications module's admin permission. Ask an administrator to grant it under Admin → Permissions."*
- A **deactivated** employee account can't see or do anything in this module — the staff pages look for an active `employees` row and show *"Account not set up"* if there isn't one.

---

## 3. How to get there

**Staff (inbox, compose, reply):**

- Sidebar (desktop) or the **Menu** tab (mobile) → **Communications**. This opens `/reports/communications`, defaulting to the **Alerts** tab; append `?inbox=messages` or `?inbox=sent` to land on another tab directly (the in-page tab links do this for you).
- **New message**: the **New message** button on the inbox (visible only with `submit`) goes to `/reports/communications/compose`. A reply from a message's detail page goes to `/reports/communications/compose?replyTo=<message id>`.
- After sending, you land on `/reports/communications/compose/done?id=<message id>`.

**Admins (configuration and oversight):**

- Admin Center → **Module Admin** → **Communications**, at `/admin/communications`. It opens on the **Inbox** tab; the other seven — **Broadcast, Templates, Groups, Routing, Reminders, Deliveries, Audit Log** — are `?tab=` query params on the same URL (`/admin/communications?tab=routing`, etc.), so a tab's URL is bookmarkable and shareable.

---

## 4. Setup & configuration (admins)

Every admin action in this module is double-gated: `requireAdmin()` plus the module-scoped **communications `admin`** permission (`ensureCommsAdmin()` in `actions.ts`), so an admin who can reach other consoles but lacks this specific grant is turned back with the message quoted in §2. Configuration below is spread across five of the eight admin tabs — **Templates, Groups, Routing, Broadcast,** and **Reminders**. (Inbox, Deliveries, and Audit Log are operational views, covered in §5.)

### Templates tab

Templates are reusable subject + body + acknowledgement presets, used by staff compose, admin Broadcast, and Reminders alike.

- **Add template** captures **Name** (required), **Slug** (auto-derived from the name if left blank, must be lowercase letters/digits/hyphens and unique per facility), **Category** (free text — e.g. "safety", "ops" — not a fixed list), **Subject** (optional), **Body** (required), and a **Requires acknowledgement** checkbox.
- Existing templates get **Edit**, **Deactivate/Activate**, and **Delete**. **Delete is blocked** if any active **Reminder** still references the template ("Template in use by N reminders; deactivate instead.").
- Picking a template on the staff compose form or the admin Broadcast form fills in its subject, body, and acknowledgement setting in one click — the sender can still edit any of it before sending.

### Groups tab

Groups are named recipient lists — the unit that both staff compose and admin Broadcast (and Routing/Reminders targets) address messages to.

- **Add group**: **Name** (required), **Slug** (auto-derived, unique per facility), **Description** (optional), and the **"Staff can message this group"** checkbox — this is the switch that decides whether an ordinary staff member sees this group as a compose destination at all. Admins can always address any active group from Broadcast regardless of this flag.
- Selecting a group from the left-hand list opens its detail pane: **Edit** (name/slug/sort order/description/staff-can-message), **Deactivate/Activate**, **Delete**, and a **Members** panel where you add or remove employees one at a time from a dropdown of active, not-yet-member employees.
- **Delete is blocked** if the group is still referenced by a routing rule or a reminder ("Group is referenced by routing rules or reminders; deactivate instead.").

### Routing tab

Routing rules are the heart of the alerting story: each rule decides which alerts get **fanned out as notifications** (in-app message + email), to whom, how urgently, and with what extras. Every rule has:

- **Name** (optional, for your own reference).
- **Source module** — which module's alerts this rule watches: Ice Operations, Refrigeration, Accident Reports, Air Quality, Incident Reports, Scheduling, Communications, Daily Reports, Ice Depth, Dasher Boards, or Rink Scheduling.
- **Severity filter** — `info` / `warn` / `high` / `critical`, or **Any** to match every severity from that module.
- **Area (optional)** — scopes the rule to one location/area within the source module. For modules with a real area list wired up — **Daily Reports** (its Areas) and **Air Quality** (its Facility Spaces/locations) — you get a proper dropdown of that module's areas, plus an "Any area" option. Every other module falls back to a raw-UUID text box, because there's no unified areas table to enumerate across modules; ⚠ VERIFY whether the module you're routing for actually stamps an `area_id` on its alerts at all — if it never does, an area-scoped rule for it will simply never match.
- **Target** — exactly one of:
  - **Group** — an existing communication group.
  - **Role** — every active employee holding that role key (`super_admin`, `admin`, `manager`, or `staff`).
  - **Employee** — one specific person.
  - **Department** — every active employee in that department.
- **Timing** — **Immediate** (send now), **End of day digest**, **Weekly (next Monday)**, or **Manual** (queued into `notification_outbox`, no automatic send — a scheduler drains due rows). End-of-day and weekly timings work the same way: they queue rather than send immediately.
- **Attach PDF of the submission** — renders a PDF of the underlying source record, links it from the in-app message, and attaches it to the outbound email.
- **Require recipient acknowledgement** — recipients must explicitly acknowledge the resulting message; use this for anything genuinely critical (e.g. a critical-severity accident report).
- **Priority** — a plain integer; higher-priority rules apply first when several rules could match the same alert.

Rules render as a list, newest-priority first, each with **Preview recipients**, **Edit**, **Activate/Deactivate**, and **Delete**. **Preview recipients** calls the `resolve_rule_recipients` database function live and shows exactly who the rule currently resolves to (name + email) — use it before saving a rule, or any time membership changes, to sanity-check that a rule targets who you think it does; an empty result (with the message "No active employees match this rule") usually means an empty group, a role nobody currently holds, or a department with no assigned employees.

With **zero routing rules**, alerts still land in every viewer's Alerts inbox (see §1) — they just never generate an in-app message or email to anyone specifically.

### Broadcast tab

Broadcast is the admin's own compose tool — unlike staff compose, it isn't limited to `staff_can_message` groups, and it can also target a role or the whole facility.

- **Use a template (optional)** pre-fills subject/body/acknowledgement from any active template; you can still edit before sending.
- **Subject** (optional) and **Message** (required body).
- **Send to** — one of three mutually exclusive scopes:
  - **Groups** — check one or more active groups; delivered to the union of their members.
  - **Everyone with a role** — pick one role; delivered to every active employee holding it.
  - **Whole facility** — every active employee in the facility.
- **Send later (optional)** — a date/time picker. Leave blank to send immediately. Set it, and the broadcast is instead queued as one `notification_outbox` row per resolved recipient with `scheduled_for` set to that time; the notifications-drain cron converts the batch into a single message + recipient fan-out once it's due. A scheduled broadcast **arrives as a system message** — it does not carry your name as sender, unlike an immediate send.
- **Requires acknowledgement** checkbox, same meaning as everywhere else in this module.

Scheduled broadcasts appear in a **Scheduled broadcasts** card above the compose form, each showing its subject, send time, and resolved recipient count, with a **Cancel** button. Cancelling flips every **still-pending** row of that batch to `cancelled` — rows the drain cron already converted (i.e., already delivered) are untouched, so cancelling only ever stops what hasn't gone out yet. If nothing is left to cancel you'll see: *"Nothing left to cancel — it may have already been sent."*

Sending (immediate or scheduled) reuses the exact same `persistMessage` pipeline staff sends use — the delivery mechanics, read/ack tracking, and email fan-out are identical either way; only the sender-restriction rules differ (admin broadcast has none).

### Reminders tab

Recurring reminders resend a template to a target on a repeating schedule — think shift-change checklists, weekly safety reminders, or a recurring maintenance nudge.

- **Add reminder**: **Name** (required), a **5-field cron schedule** (`minute hour day-of-month month day-of-week`, e.g. `0 8 * * 1` = every Monday at 08:00, evaluated in the facility's timezone), a **Template** to send (only active templates are offered, unless the reminder already points at one that's since been deactivated — that one still appears, marked "(inactive)"), an optional **Next run** timestamp, and a **Target**: **Group** or **Role** (the same two target kinds Routing offers, minus Employee/Department).
- Each row shows its **Last run** and **Next run** timestamps and offers **Edit**, **Activate/Deactivate**, and **Delete**.
- The scheduler that actually fires reminders runs every few minutes in the background; it is app-level cron logic (⚠ VERIFY the exact cron/worker mechanism — the schema comment on `schedule_cron` notes it's "interpreted by the app worker, not pg_cron").
- With **no active templates** in the facility, the Reminders tab tells you to add one on the Templates tab first rather than showing an unusable form.

> **Cross-reference — Admin Control Center.** Whether Communications shows in staff navigation at all is set on the **Modules** page; the four permission actions (view/submit/admin, and the module-scoped `admin` grant this console specifically requires) are set under **Permissions**. See the Admin Control Center chapter for those shared screens.

---

## 5. Screen-by-screen walkthrough

### A. Staff inbox (`/reports/communications`)

A tab bar — **Alerts**, **Messages**, and **Sent** (Sent only shown if you hold `submit`) — each with an unread-count badge. **New message** appears top-right if you hold `submit`.

- **Alerts tab.** A search box, **Source** and **Severity** filter-pill rows (multi-select, click to toggle), and **Unread only** / **Hide resolved** checkboxes, all client-side over up to the 100 most recent alerts. Each row shows the source-module badge, severity badge, an "Ack required" badge if unacknowledged and required, a "Resolved" badge if closed, an unread dot, the title, a relative timestamp, and a body excerpt. Tapping a row opens the alert.
- **Messages tab.** Search plus **Unread only**, over your received messages (most recent 100). Rows show sender, relative time, subject (or a body excerpt if no subject), an unread dot, and an "Ack required" badge if applicable.
- **Sent tab** (submit-holders only). Your own authored messages with **recipient / read / acknowledged** counts rolled up right on the row.

### B. Alert detail (`/reports/communications?alert=<id>`)

Shows the module badge, severity, resolved/ack-required badges, title, full body, when it was created and by whom (if attributable), the area id if any (raw, not resolved to a name — ⚠ VERIFY whether staff ever see a human-readable area name here), and — if resolved — when and by whom. If the alert requires acknowledgement and you haven't yet, an **Acknowledge this alert** card appears with an optional notes field; once acknowledged, it instead shows your acknowledgement time and any notes you left, permanently.

### C. Message detail (`/reports/communications?message=<id>`)

Shows sender, sent time, subject, body, and a **Download PDF attachment** link if the message carries one (a routing-rule PDF attachment or otherwise). Opening the page automatically marks the message read (fire-and-forget, no button — see §8). If acknowledgement is required and outstanding, an **Acknowledge this message** card appears the same way alerts' does. A **Reply** button appears only if the message has a real employee sender (system-authored messages, e.g. a drained scheduled broadcast, have none to reply to).

### D. Sent-message receipts (`/reports/communications?sent=<id>` and the post-compose `done` screen)

Shows what you sent, then a **Receipts** list: every recipient with a **Read** / **Unread** badge and, if acknowledgement was required, an **Acknowledged** / **Awaiting ack** badge with timestamps. This is server-rendered and relies on an RLS extension (migration 170) that lets a message's sender read its own recipients' rows even though those rows otherwise belong to each recipient.

### E. Compose / Reply (`/reports/communications/compose`)

Described field-by-field in §7. In **reply mode** (`?replyTo=<id>`), the recipient is locked to the original sender (shown as a read-only "To:" chip) and the group picker is hidden entirely — you cannot broaden a reply into a group send.

### F. Admin — Inbox tab (`/admin/communications?tab=inbox`)

Two views via a toggle, **Alerts** and **Messages** (`?inbox=alerts` / `?inbox=messages`), each with URL-driven filters (source module, severity, resolved/open, free-text search, and a date range defaulting to the last 30 days) and a **Load more** link once the current window (200 rows) is exhausted.

- **Alerts view**: each row is a link into a drilldown with the full alert plus its acknowledgement list, and **Resolve** / **Re-open** / **Delete** actions. Resolving stamps `resolved_at` + who resolved it; deleting an alert also deletes its acknowledgement records and prompts *"Resolving is usually the better way to close out a real alert."*
- **Messages view**: a table of every facility message with recipient/read/ack rollups and a **Delete** action per row (deletes read/ack records with it).

### G. Admin — Deliveries tab (`/admin/communications?tab=deliveries`)

Two tables, shown only when non-empty: **Failed email deliveries** (`communication_recipients` rows whose `email_status` reached `failed` after exhausting the automatic retry backoff) and **Failed queued notifications** (`notification_outbox` rows the drain cron marked `failed`). Each row shows the recipient, subject, attempt count / error text, and queued/scheduled time, with a **Retry** button that resets the attempt counter and re-queues the row for the next scheduled cron run. If nothing has ever failed, the tab shows a single "No failed deliveries" card.

### H. Admin — Audit Log tab (`/admin/communications?tab=audit`)

A filterable (entity type, action, actor, date range), paginated (500-row window, **Load more**) append-only log of every mutation across this module — template/group/routing-rule/reminder create/update/delete/activate/deactivate, alert resolve/reopen/delete, message delete, message sent, broadcast scheduled/cancelled, and failed-delivery retries. Each row can be expanded (**Diff**) to show its `before`/`after` JSON snapshots side by side.

---

## 6. Step-by-step: common tasks

**Send a message to a group (staff).**
1. **Communications** → **New message**.
2. Optionally pick a template to pre-fill subject/body/acknowledgement.
3. Write your **Message** (required).
4. Check one or more **Recipient groups** (only groups flagged staff-messageable appear).
5. Optionally check **Requires acknowledgement**.
6. Tap **Send message** (or, offline, **Save offline** — see §8).

**Reply to a message (staff).**
1. Open the message from **Messages** and tap **Reply**.
2. The recipient is locked to the original sender; write your reply and send.

**Acknowledge a required alert or message (staff).**
1. Open the alert/message; if acknowledgement is required and outstanding, an **Acknowledge** card appears.
2. Optionally add notes, then tap **Acknowledge**. This is permanent — there is no un-acknowledge.

**Route a module's alerts to an on-call group (admin).**
1. Admin → Communications → **Routing** → **Add routing rule**.
2. Pick the **Source module** and, if you want to narrow it, a **Severity** and/or **Area**.
3. Pick a **Target** — Group / Role / Employee / Department.
4. Pick a **Timing**, and check **Attach PDF** / **Require acknowledgement** as needed.
5. **Add rule**, then click **Preview recipients** on the saved rule to confirm it resolves to who you expect.

**Send an immediate broadcast to the whole facility (admin).**
1. Admin → Communications → **Broadcast**.
2. Write (or template-fill) a **Subject** and **Message**.
3. Under **Send to**, choose **Whole facility**.
4. Leave **Send later** blank and click **Send broadcast**.

**Schedule and later cancel a broadcast (admin).**
1. Compose the broadcast as above, but set **Send later** to a future date/time, then **Schedule broadcast**.
2. It appears under **Scheduled broadcasts**; click **Cancel** any time before it fires to stop delivery to whichever recipients haven't received it yet.

**Set up a weekly reminder (admin).**
1. Ensure an active **Template** exists (Templates tab).
2. Communications → **Reminders** → **Add reminder**.
3. Name it, set **Schedule** to something like `0 8 * * 1` (Mondays at 8 AM, facility time), pick the **Template** and a **Group** or **Role** target.
4. **Add reminder** — it fires automatically from its next scheduled run.

**Retry a failed email (admin).**
1. Communications → **Deliveries**.
2. Find the row under **Failed email deliveries**, click **Retry**.

---

## 7. Field reference

| Field | Where | Required? | Notes |
|---|---|---|---|
| Subject | Staff/admin compose | No | Free text. Reply mode auto-prefixes "Re:" from the original subject. |
| Message (body) | Staff/admin compose | **Yes** | Free text; empty body is rejected with "Please enter a message." |
| Recipient groups | Staff compose | **Yes**, unless replying | Must pick ≥1 group flagged `staff_can_message`, or be in reply mode. |
| Requires acknowledgement | Compose / template / rule | No (default off) | Recipients must explicitly acknowledge before the message is considered handled. |
| Use a template | Compose | No | Pre-fills subject/body/ack from an active template; still editable after. |
| Send to (scope) | Admin Broadcast | **Yes** | Groups / Everyone with a role / Whole facility — exactly one. |
| Send later | Admin Broadcast | No | Future date/time; queues per-recipient outbox rows instead of an immediate send. |
| Name | Group / Template / Routing rule / Reminder | Varies (required for Group, Template, Reminder; optional for Routing rule) | Free text. |
| Slug | Group / Template | Auto from name if blank | Lowercase letters/digits/hyphens, unique per facility. |
| Staff can message this group | Group | No (default off) | Gates whether ordinary staff see the group as a compose destination. |
| Category | Template | No | Free text, not a fixed list (e.g. "safety", "ops"). |
| Source module | Routing rule | **Yes** | One of the modules listed in §4. |
| Severity | Routing rule | No (default "any") | `info` / `warn` / `high` / `critical`. |
| Area | Routing rule | No | Real picker for Daily Reports / Air Quality; raw UUID box for other modules. |
| Target kind + value | Routing rule / Reminder | **Yes** | Group / Role / Employee / Department (Reminder: Group or Role only). |
| Timing | Routing rule | No (default "immediate") | Immediate / End-of-day digest / Weekly / Manual. |
| Attach PDF | Routing rule | No (default off) | Renders + links/attaches a PDF of the source submission. |
| Priority | Routing rule | No (default 0) | Integer; higher applies first among matching rules. |
| Schedule (cron) | Reminder | **Yes** | 5 fields: minute hour day-of-month month day-of-week, evaluated facility-local. |
| Next run | Reminder | No | Optional override of the next scheduled fire time. |

---

## 8. Locking, saving & offline

There's no draft/edit-window concept anywhere in this module — no message, alert, template, group, rule, or reminder is ever edited "in place" after the fact by its original author or a recipient. What each side can do instead:

- **Messages and alerts are immutable content.** A staffer can't edit a message after sending it, and can't edit an alert at all (alerts are system-generated). Admins can **resolve/re-open** an alert (a status flag, not a content edit) and **delete** either one outright; there is no partial edit.
- **Acknowledgements and the audit log are append-only** — the database has no UPDATE/DELETE policy on either table. Once you acknowledge something, that record and its timestamp are permanent; the only "undo" is that admins can still see and act on the underlying alert/message independently.
- **Admin configuration (Templates, Groups, Routing rules, Reminders) saves immediately** on submit — no draft state, no publish step. Every create/update/delete/activate/deactivate writes a best-effort row to the Audit Log; a failure to write that audit row never blocks or rolls back the actual change.
- **Scheduled broadcasts** are the one place with a genuine in-between state: queued rows sit in `notification_outbox` until their `scheduled_for` time, and can be cancelled up to the moment the drain cron converts them into a real, delivered message (see §4 and §6).

**Offline — confirmed for compose, staff-side only.** Composing or replying goes through the same offline queue described in the app's PWA architecture: when `ComposeForm` detects `navigator.onLine === false`, it blocks the normal form POST and instead calls `enqueueSubmission({ moduleKey: "communications", action: "submit", payload })` from `src/lib/offline/use-sync-queue.ts` — the client never writes to `offline_sync_queue` directly. The submit button relabels to **Save offline**, and after queuing you see a **"Saved on this device"** confirmation ("this message is queued and will send automatically once you're back online"). Once connectivity returns, the service worker replays the queued submission to `/api/offline-sync`, which for `moduleKey === "communications"` dispatches to `handleMessageReplay()` in `src/app/reports/communications/_lib/offline.ts`. That handler re-runs the *exact* same parse → validate → permission → persist pipeline as the online action (`persistMessage` in `_lib/submit.ts`), re-resolving `isAdmin` fresh from the replaying user's live session, and is idempotent via the queue's `local_id` claim — a duplicate replay (e.g. the service worker retrying after a lost response) is a no-op rather than a second send.

**Everything else in this module is online-only.** Acknowledging an alert (`acknowledgeAlert`), acknowledging a message (`acknowledgeMessage`), and the automatic mark-as-read on opening a message (`markMessageRead`) are plain server actions with no `enqueueSubmission` call anywhere in their components — unlike compose, there is no offline queueing path for them at all. ⚠ VERIFY the exact behavior a staffer sees tapping **Acknowledge** while offline (the code has no special offline handling for it, so it most likely surfaces as a generic failed-request error rather than a friendly "saved for later" message); the practical guidance is to acknowledge alerts and messages only once you have a live connection. The entire **admin console** (Broadcast, Templates, Groups, Routing, Reminders, Deliveries, Audit Log) is likewise plain server actions with no offline path — it's an admin workstation tool, not a floor-level PWA flow.

---

## 9. Troubleshooting & FAQ

**"You don't have permission to view communications."** Your account lacks **view** on the Communications module. Ask an admin to grant it (Admin → Permissions).

**"You don't have permission to send messages."** You have **view** but not **submit**. Ask an admin to grant submit access, or ask someone who has it to send on your behalf.

**"Account not set up" / "Your account isn't fully set up yet."** Your login isn't linked to an active employee record in this facility. Contact your administrator.

**"There aren't any active groups to send to in this facility."** No group is both active and flagged "Staff can message this group" (unless you're replying, which doesn't need a group). Ask an admin to create or flag one on the Groups tab.

**"Can't reply to that message."** The message either isn't in your inbox, or it was sent by the system (no human sender to reply to) — e.g. a scheduled broadcast that already went out.

**Why can't I message a specific person directly?** Ordinary staff sends are group-only, with one exception: replying, which is locked to the original sender. Direct arbitrary messaging isn't a feature for non-admins — ask an admin to add the person to a shared group, or to broadcast on your behalf.

**"Your account has admin console access but not the communications module's admin permission."** You reach the Admin Center but haven't been granted the module-scoped `admin` action specifically for Communications. Ask a super admin or another facility admin to grant it under Admin → Permissions.

**An alert I care about never generated a message or email.** Check the **Routing** tab: alerts always show up in everyone's inbox regardless of rules, but only a matching, active routing rule fans one out as a notification. Use **Preview recipients** on the rule to confirm it resolves to the people you expect, and check the rule's severity/area filters aren't excluding this alert.

**"Nothing left to cancel — it may have already been sent."** The scheduled broadcast's send time already passed and the drain cron already converted it into a delivered message before you clicked Cancel.

**"Template in use by N reminders; deactivate instead." / "Group is referenced by routing rules or reminders; deactivate instead."** You can't delete a template or group that something else still points at. Deactivate it instead — it stays available to whatever references it but drops out of new pickers.

**A failed email/notification won't go away.** Go to **Deliveries** and click **Retry** — it resets the attempt counter and re-queues the row for the next scheduled send/drain run. If it keeps failing, the underlying error text (shown in the row) is your best clue — usually a bad email address or an email-provider error.

**Can I attach a photo or file to a message?** No. Compose has no file/photo upload; a routing rule can attach a **generated PDF of the source submission**, but that's system-produced, not something a sender uploads.

**I submitted a message while offline — did it send?** It's saved on your device ("Saved on this device") and sends automatically once you reconnect, going through the same checks as an online send. You'll find it in your **Sent** tab once it syncs. Acknowledging alerts/messages, by contrast, needs a live connection (see §8).

---

## Source (footnote)

*Staff flow:* `src/app/reports/communications/page.tsx`, `actions.ts`, `types.ts`, `compose/page.tsx`, `compose/done/page.tsx`, and `_components/` (`acknowledge-alert-form.tsx`, `alerts-list.tsx`, `compose-form.tsx`, `format.ts`, `inbox-tabs.tsx`, `message-detail.tsx`, `messages-list.tsx`, `receipts-list.tsx`, `sent-list.tsx`). Pure/tested logic: `_lib/compose.ts` + `_lib/compose.test.ts`. Server-only pipeline: `_lib/submit.ts`, `_lib/offline.ts`, and the `moduleKey === "communications"` dispatch in `src/app/api/offline-sync/route.ts`.

*Admin flow:* `src/app/admin/communications/page.tsx`, `actions.ts`, `types.ts`, `_lib/validate.ts` (+ `validate.test.ts`), and `_components/` (`audit-tab.tsx`, `broadcast-tab.tsx`, `deliveries-tab.tsx`, `groups-tab.tsx`, `inbox-tab.tsx`, `reminders-tab.tsx`, `routing-tab.tsx`, `templates-tab.tsx`).

*Schema / RLS / permissions:* `supabase/migrations/00000000000009_communications_schema.sql` (base schema + RLS), `…045`/`…063` (routing rule columns: `target_department_id`, `timing`, `attach_pdf`, `requires_acknowledgement` — as referenced in `admin/communications/types.ts`), `…059_communication_groups_staff_can_message.sql`, `…170_communications_security_remediation.sql`, `src/lib/permissions/actions.ts` (module/action model), `src/lib/permissions/check.ts` (`currentUserCan`).

*Adapted from:* `docs/training-guide/src/ch06-admin-modules.md`, §6.9 "Communications Admin" and §6.10 "How a submission becomes an alert (the pipeline)" — reused for the pipeline explanation in §1 and the admin-tab overview in §4, cross-checked against the source files above.
