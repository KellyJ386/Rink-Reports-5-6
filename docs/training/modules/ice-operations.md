# Ice Operations

## 1. What this module is for

Ice Operations is the digital logbook for the day-to-day maintenance your crew performs on the ice and on the machines that maintain it. Instead of paper sheets pinned by the resurfacer, your team logs each job on a phone or tablet — and every entry is automatically stamped with who did it and when.

The module covers four kinds of jobs ("operation types"):

- **Ice Make** — a resurfacing run: which rink, which machine, water used, machine hours, and how much snow was taken.
- **Edging** — time spent running the edger around the boards.
- **Blade Change** — swapping the blade on a machine, recording the old blade's hours and the new blade's ID.
- **Circle Check** — a structured pre-use safety/condition inspection of a machine, with a pass/fail checklist. Failed items raise an alert so a manager knows right away.

Two important things to understand up front:

- **Your facility chooses which of these four operation types it uses.** An admin can hide any of them, so your tabs may show all four or just one or two. (The four types themselves are built in — they can't be renamed or added to — but visibility is yours to control.)
- **Equipment is your own list.** The machines you pick from (resurfacers, edgers, blade sets, etc.) and their "types" are set up by your admin for your facility — nothing is hard-coded.

**You only see data for your own facility — this is automatic.**

## 2. Who can use it

Access is permission-driven, not a fixed rank. The table shows the typical default for each tier; an admin can widen or narrow any one person's access per action (view / submit / configure). Treat the tiers as defaults, not hard rules.

| Tier | Typical access to Ice Operations |
|---|---|
| super_admin | Full access everywhere, plus all admin configuration. |
| org_admin | ⚠ VERIFY — the live app has no separate org-admin tier; treat as super_admin. |
| facility_manager (the `admin` role) | Submit reports **and** run all admin setup, history, and settings for their facility. |
| supervisor (the `manager` role, or a custom role) | Submit reports if granted the `submit` permission. Admin setup only if also granted the module's `admin` permission. ⚠ VERIFY whether your facility grants supervisors config rights by default. |
| staff (or a custom role such as `driver`) | Submit reports if granted the `submit` permission. **No access** to the admin setup/history/settings screens. |

To log an operation you must have an active employee account at the facility and the `submit` permission for Ice Operations. If you lack it, the form shows a "No permission" notice instead of the tabs. If your account isn't fully set up, you'll see an "Account not set up" notice — contact your administrator.

## 3. How to get there

- **Staff side (logging jobs):** open **Ice Operations** from the left sidebar (or the **Menu** tab on mobile). The link only appears if the module is turned on for your facility and you have access. The URL is `/reports/ice-operations`; it lands you on the first enabled operation tab automatically.
- **Admin side (configuring):** admins open the **Admin Center**, then **Ice Operations Admin** under Module Admin (`/admin/ice-operations`).

From the staff screen, admins also get a **Configure Forms** button in the header that jumps straight to the admin Setup tab.

## 4. Setup & configuration (admins)

Everything in this section lives in **Admin Center → Ice Operations Admin**, which has three tabs: **Setup**, **History**, and **Settings**. The page header reminds you that submitted reports are immutable — admins review and annotate, they don't rewrite. For broader admin topics (employees, permissions, exports, retention, the Modules on/off switch), see the **Admin Control Center** chapter.

If your facility has nothing configured yet, the Setup tab offers a **Seed defaults** button. It creates a starter settings row plus five starter circle-check items (four for ice resurfacers, one for the edger). You can edit or add to everything afterward.

### Setup tab — what you configure

The Setup tab is a stack of cards. Each card lists existing items with **Edit / Deactivate / Delete** buttons and an "Add" form at the bottom. "Deactivate" hides an item from staff without erasing its history; "Delete" removes it (with a confirmation prompt).

- **Rinks** — the surfaces ice operations are performed on (name and an optional slug, with a sort order). Rinks are required for Ice Make.
- **Fuel types** — power sources for resurfacers (e.g. Electric, Gas, Propane). Each fuel type can anchor one circle-check template.
- **Equipment** — your machines, grouped by **equipment type**. The built-in types are **Ice Resurfacer, Edger, Blade Set, Hand Edger, and Other**. For each machine you can set a name, type, slug, model, serial number, an **hours count** (admin-maintained — it does **not** auto-update from submissions), an optional fuel type, and sort order. The equipment type is what decides which operation tab a machine shows up under (resurfacers → Ice Make / Circle Check, edgers → Edging, blade sets → Blade Change).
- **Circle-check items** — the individual inspection items staff see during a circle check. Each item has a label, optional description, an "applies to" scope (All equipment, or one equipment type), and a response type of **Pass / Fail** or **Text response** (optionally required). Items can be reordered with up/down arrows, toggled active, deleted, and **bulk-imported** (up to 50 per facility).
- **Circle-check templates** — an optional, more structured alternative to the flat item list. You create **one template per fuel type** (up to **4 templates** per facility), give it a name/description, and add its own list of checklist **fields** (also bulk-importable). When an operator picks a resurfacer whose fuel type matches a template, that template's fields replace the generic item list for that check.

### Settings tab

- **Visible operations** — checkboxes for Ice Make, Circle Check, Edging, Blade Change. Check the ones your facility uses; **leaving all unchecked shows every operation** (the default). This is what controls which tabs staff see.
- **Temperature unit** — Fahrenheit or Celsius, display only. (Values are stored in Celsius internally.) Note: the current staff forms don't collect a temperature, so this setting mainly affects how older/legacy readings display in History. ⚠ VERIFY whether any live staff field uses this unit today.
- **Enable ice operations alerts** — when on, a failed circle check raises a facility alert.
- **Default alert severity** — warn / high / critical, used when a circle-check failure alert is raised without its own severity.

## 5. Screen-by-screen walkthrough

### The Ice Operations shell

Every staff screen sits inside a shared shell:

- A **page header** with the "Ice Operations" title and breadcrumb (Reports › Ice Operations).
- Header buttons: **Show Activity Feed** (toggles a "Recent activity" panel of the last few submissions — each row shows the operation type, the rink/machine, a "failed" badge if a circle check had failures, and the time), **Back**, **Dashboard**, and — for admins only — **Configure Forms**.
- A **tab row** with one tab per **enabled** operation type. The tabs follow a fixed order: Ice Make, Circle Check, Edging, Blade Change.

If a needed prerequisite is missing, you'll see a friendly notice inside the shell instead of a form — e.g. "No rinks configured" (Ice Make needs at least one rink), "No machines configured" (no equipment of the right type), or "No checklist items" (Circle Check with no items and no template). These point you to ask an administrator.

**Auto-timestamp & operator:** you never type who you are or stamp the time by hand. Each form captures the current date/time when it loads (shown as "When it happened"), and the submission is recorded against **your** logged-in employee account. The confirmation screen shows "Submitted by" with your name.

### Ice Make form

Fields: **Rink** (required), **Machine** (required — only resurfacers appear), **Water Used (gallons)**, **Machine Hours**, **Snow Taken (%)** (0–100), **Time On**, **Time Off**, and **Notes**. Submit button reads **Submit resurface**.

### Edging form

Fields: **Machine** (required — only edgers appear), **Hours Run**, and **Notes**. Submit button reads **Submit edging report**.

### Blade Change form

Fields: **Machine** (required — only blade sets appear), **Old Blade Hours**, **New Blade ID** (free text — serial number or ID), and **Notes**. The person who performed the change is recorded automatically as you (the logged-in user); there is no "who did it" dropdown. Submit button reads **Submit blade change**.

### Circle Check form

1. Pick a **Machine** (required). Until you do, the checklist area says "Select a machine to view the checklist."
2. The app loads the right checklist:
   - If the machine has a fuel type whose **template** exists, that template's fields are shown ("Using template: …").
   - If the machine has **no** fuel type assigned but templates exist, a **Fuel type** dropdown appears so you can pick one for this check.
   - Otherwise, the generic **circle-check items** that apply to that machine's type are shown.
3. For each item, tap **Pass** (green) or **Fail** (red). When you mark an item **Fail**, a required **"What's wrong?"** note box appears beneath it.
4. Add optional **General Notes**.
5. **Submit circle check.** The button stays disabled (with a red reminder) until every failed item has a note.

A failed circle check is flagged on the confirmation screen, recorded with a failed-item count, and — if alerts are enabled — raises a manager alert listing the failed items.

### Confirmation ("done") screen

After any submit you land on a **Submitted!** screen with a green checkmark, the operation label, and (for a circle check with failures) a "_N_ failed items" badge. Below it: when it happened, when it was submitted, the rink, the equipment, and who submitted it. Buttons: **Submit another** and **Back to home**.

## 6. Step-by-step: common tasks

**Log an Ice Make (resurface)**
1. Open **Ice Operations** → **Ice Make** tab.
2. Choose the **Rink** and the **Machine**.
3. Fill in water used, machine hours, snow %, and time on/off as appropriate (these are optional).
4. Add notes if needed → **Submit resurface**.

**Run a Circle Check**
1. Open **Ice Operations** → **Circle Check** tab.
2. Select the **Machine** (and a **Fuel type** if prompted).
3. Tap **Pass** or **Fail** for each checklist item; write a note for every **Fail**.
4. Add general notes if needed → **Submit circle check**. Failures notify your managers.

**Log a Blade Change**
1. Open the **Blade Change** tab → select the **Machine**.
2. Enter the **Old Blade Hours** and the **New Blade ID** → **Submit blade change**.

**Enable or disable an operation type (admin)**
1. Admin Center → **Ice Operations Admin** → **Settings**.
2. Under **Visible operations**, check the types you want staff to see (uncheck to hide). Leaving all unchecked shows every type.
3. **Save settings.** The staff tabs update accordingly.

**Add a resurfacer (or other machine) to equipment (admin)**
1. Admin Center → **Ice Operations Admin** → **Setup**.
2. In the **Equipment** card's "Add equipment" form, enter a **Name**, choose the **Type** (e.g. Ice Resurfacer), optionally set model/serial/hours and a **Fuel type**, then **Add equipment**.
3. The machine now appears in the matching operation tab for staff.

**Build a circle-check template (admin)**
1. Setup tab → add a **Fuel type** (if you haven't).
2. In **Circle check templates**, add a template for that fuel type, then add its **fields** (typed in, or bulk-uploaded).
3. Assign that fuel type to the relevant resurfacers in the **Equipment** card so operators load the template automatically.

## 7. Field reference

| Operation type | Field | Required | Notes |
|---|---|---|---|
| **Ice Make** | Rink | Yes | Active rinks only |
| | Machine | Yes | Ice Resurfacer equipment only |
| | Water Used (gallons) | No | Decimal |
| | Machine Hours | No | Decimal |
| | Snow Taken (%) | No | 0–100 |
| | Time On / Time Off | No | Time of day |
| | Notes | No | Free text |
| **Edging** | Machine | Yes | Edger equipment only |
| | Hours Run | No | Decimal |
| | Notes | No | Free text |
| **Blade Change** | Machine | Yes | Blade Set equipment only |
| | Old Blade Hours | No | Decimal |
| | New Blade ID | No | Free text (serial/ID) |
| | Performed by | (auto) | Recorded as the logged-in user |
| | Notes | No | Free text |
| **Circle Check** | Machine | Yes | Ice Resurfacer equipment only |
| | Fuel type | Only if machine has none | Loads the matching template |
| | Checklist items | Per template/config | Pass/Fail each |
| | Failure note ("What's wrong?") | Yes for each failed item | Blocks submit if missing |
| | General Notes | No | Free text |

All four types also capture an automatic **occurred-at timestamp** and the **operator** (you).

## 8. Locking, saving & offline

- **Append-only / no editing.** Every submission is a permanent record. The form itself says "You can't edit this after submitting." There is no edit button — to correct something, submit a new entry. Admins can review entries and add **follow-up notes** from the History tab, but they cannot alter the original.
- **Offline.** All four forms work offline. If you submit while your device is offline, the report is **saved on this device** (you'll see a "Saved on this device" confirmation) and **queued**. When you reconnect, it syncs automatically and the exact same checks run server-side then — including the rink/machine and failed-note validation. Each queued item is tracked so a retry can't create a duplicate. You can keep working in the meantime; pending items also appear in your offline queue.
- **Validation is the same online and offline.** Required machine, a valid occurred-at time, and a note on every failed circle-check item are enforced either way.

## 9. Troubleshooting & FAQ

**A tab I expected is missing.** Your facility has that operation type unchecked in Settings → Visible operations. An admin can re-enable it.

**"No machines configured" / "No rinks configured."** No equipment of the needed type (or no rink, for Ice Make) has been set up yet. Ask an admin to add it in Setup.

**"No checklist items" on Circle Check.** No circle-check items and no template fields are configured. An admin adds items (or a template) in Setup.

**The Submit button on a circle check is greyed out.** You marked an item **Fail** but didn't write a note. Add a note in the "What's wrong?" box under each failed item.

**The Circle Check shows no checklist after I pick a machine.** The machine's fuel type may have no template yet, or no generic items apply to its type. Pick a fuel type if prompted, or ask an admin to configure items/templates.

**I'm offline — will my report be lost?** No. It's saved on your device and syncs when you're back online.

**I made a mistake after submitting.** You can't edit a submitted entry. Submit a corrected new entry; for context, an admin can add a follow-up note to the original in History.

**"You don't have permission to submit."** Your account doesn't have the Ice Operations `submit` permission. An admin grants it from Permissions.

**Who got my circle-check failure alert?** Failed circle checks raise a facility alert (if alerts are enabled in Settings) at the configured default severity, listing the failed items — your managers see it in the Communications/alerts area.

## Source

- Staff: `src/app/reports/ice-operations/page.tsx`, `src/app/reports/ice-operations/[operationType]/page.tsx`, `src/app/reports/ice-operations/[operationType]/_components/{ice-make-form,edging-form,blade-change-form,circle-check-form,ice-ops-shell,offline-queued-card,use-offline-submit,shared}.tsx|ts`, `src/app/reports/ice-operations/[operationType]/done/page.tsx`, `src/app/reports/ice-operations/actions.ts`, `src/app/reports/ice-operations/_lib/{submit,compute,offline}.ts`, `src/app/reports/ice-operations/types.ts`.
- Admin: `src/app/admin/ice-operations/page.tsx`, `src/app/admin/ice-operations/_components/{setup-tab,settings-tab,history-tab,history-filters,submission-detail,seed-defaults-card,circle-check-import}.tsx|ts`, `src/app/admin/ice-operations/{actions,types}.ts`.
- Manifest: `docs/training/00-MANIFEST.md`.
