# 6. The Admin Console — Module Administration

Each report module has its own admin console under **Module Admin** in the sidebar. Two rules apply to all of them:

> **Console access is not module access.** Every module console requires the module's **Admin** action in the permission matrix on top of Admin Center access. Without it, the standard error is: "Your account has admin console access but not the {module}'s admin permission. Ask an administrator to grant it under Admin → Permissions."

> **Original submissions are immutable.** Admins never edit what staff submitted. You append follow-up notes (which can't be edited or deleted), change statuses where a lifecycle exists, or — in Daily Reports only — file a supersession-style correction that leaves the original on record.

Most consoles carry an **Export** dropdown in the header (last-30-days CSV/PDF, plus a link to custom ranges in PDF/Export Settings).

## 6.1 Daily Reports Admin

Configure the daily checklist program and review submissions. Tabs: **Areas · Templates · Checklist Items · Form Builder · Area Access · Assignments · Submissions**.

- **Areas** — the tabs staff pick from: name, slug, color, order, active. Capped at **30 active areas**; bulk CSV upload available.
- **Templates** — per area, the shift checklists ("Opening checklist"), each with its **Checklist Items** (label, description, order — with bulk import and the ability to move items between templates).
- **Form Builder** — versioned custom forms letting staff file multiple *titled* reports per day ("one 'Event Set Up' report per event"). Field types: text, textarea, number, select, multiselect, checkbox, time, date (max 100 fields). Publishing an edit creates a **new version** — existing report instances keep their frozen snapshot, so history never mutates. This tab also hosts the **End-of-day lock**: locking a day makes every report instance for that day read-only, enforced at the database; you can unlock later.
- **Area Access** — a staff × area checkbox matrix controlling who may submit where (CSV import/export supported). Admins always have access.
- **Assignments** — turn on **area assignment routing** and set the pre-close warning window. When on, assignment resolves: *manual override → published schedule → default owners → open*. Per area, set default owners and map scheduling job areas.
- **Submissions** — filter by area/employee/date (default last 14 days). Open one to toggle checklist items, add notes, **Delete submission**, or **File correction**: adjust the items, give a required reason, and the correction supersedes the original — which stays on record with a "Corrected" banner linking to the correction.

Note the number staff see: the module advertises that daily reports auto-delete after **14 days** (the retention page's configurable floor is 30 — verify your deployed retention row before quoting a number in training).

## 6.2 Incident Reports Admin

Review incidents, drive them through a lifecycle, and maintain the dropdowns. Tabs: **History · Incident Types · Severity Levels · Activities**. Locations come from the shared **Facility Spaces** list (a "Manage locations" header button jumps there).

- **History** — filter by status, type, severity, employee, location, and dates. The detail view shows the full original report (read-only) — including the ambulance flag, people involved, witnesses — plus:
  - **Change status**: Submitted → In review → Resolved → Archived.
  - **Follow-up notes** (append-only).
  - **Change log** — the audit trail of every edit, including the reporter's own 24-hour-window edits.
- **Incident Types / Severity Levels / Activities** — the dropdown vocabularies, each with colors and sort order. Seed-defaults buttons appear when a list is empty; activities support bulk import.

## 6.3 Accident Reports Admin

Tabs: **History · Dropdowns · Workers' Comp**.

- **History** — filters include severity, body part, medical attention, and a Workers' Comp Yes/No. The detail is fully read-only (there is deliberately no status lifecycle for accidents) with append-only follow-up notes and a change log.
- **Dropdowns** — five vocabularies: **Injury Type, Body Part, Activity, Medical Attention, Severity** (location comes from Facility Spaces). The important one: medical-attention values have a **"Triggers communication alert"** checkbox — the seeded defaults fire alerts for Medical Office Visit, Emergency Room, and Hospitalization. This is how a serious injury automatically notifies managers.
- **Workers' Comp** — the instruction text staff must read and acknowledge when filing a comp claim. One textarea, newlines preserved, **Save**.

## 6.4 Air Quality Admin

Tabs: **Setup · Compliance · History · Settings**, plus the printable **Monitoring Log**.

- **Setup** — locations come from Facility Spaces; per location (or facility-wide) manage **Equipment** (monitors: name, model, serial) and the **Reading types** (label, key, unit, decimals, required). Reading types carry no thresholds themselves — thresholds live in the compliance profile.
- **Compliance** — pick a **jurisdiction profile** (badged Binding or Guidance, 1-hour TWA or Single-sample method), choose the metrics tracked, and set **threshold overrides** per tier — **Corrective, Notification, Evacuation** — which you may *tighten but never loosen* below the regulatory floor. Write the **escalation steps** text operators see at each tier. A separate panel keeps a free-text library of compliance rules by jurisdiction.
- **History** — filter by employee, location, equipment, reading type, exceedance, dates, and notes text. Exceedance flags are computed at submit time and frozen. Append-only follow-up notes; deleting a report is super-admin-only.
- **Settings** — testing frequency text shown to staff, default jurisdiction, the alerts on/off switch, and the default alert severity.
- **Monitoring Log** (`Printable monitoring log →` from History) — an inspector-ready table (date, equipment, time, resurfacer count, CO, NO2, alert level, maintenance, recorded by) over any date range, with **Download PDF**, **Print**, and **Send…** — which emails the PDF straight to recipients you type (e.g. an inspector). Bold red values exceeded a threshold at submit time.

## 6.5 Ice Depth Admin

Tabs: **Rinks · Diagrams · Overlays · History · Analytics · Settings**.

- **Rinks** — each sheet of ice, with a default flag.
- **Diagrams** — per rink, the measurement layouts. The point editor places each numbered point by label and X/Y position, with renumbering support.
- **Overlays** — per rink: place **door markers** (typed and colored — door types are seedable) on the diagram, and upload a **center-ice logo** (transparent PNG/SVG/WebP, max 2 MB) rendered as a watermark on every report.
- **History** — sessions filtered by layout, employee, low/high flags, dates. Sessions are immutable; notes are append-only; deleting a session is super-admin-only.
- **Analytics** — average depth, below-min and above-target counts, a **problem-spots heat map** (each point colored by its most common condition, showing its average depth), a per-point breakdown sorted by how often each point reads below minimum, and a daily activity trend.
- **Settings** — measurement unit (inches/mm), low and high thresholds, **alert on** (low / high / any), the three severity colors, alerts on/off, and default severity. Existing sessions snapshot the unit and thresholds at submit time — changing settings never reclassifies history.

## 6.6 Ice Operations Admin

Tabs: **Setup · History · Settings**.

- **Setup** — **Rinks**; **Equipment** (name, type — Ice Resurfacer, Edger, Blade Set, Hand Edger, Other — model, serial, hours count, **tank capacity** which enables the %-of-tank water unit, and fuel type); **Circle check items** (scoped to all equipment or one unit); **Fuel types**; and **Circle-check templates** (fuel-type-matched checklists, capped at 4 per facility, with bulk item import). A seed button creates a starter configuration.
- **History** — filter by operation type, employee, rink, equipment, failed-check, dates, and notes search. Detail views are read-only with append-only notes.
- **Settings** — alerts on/off, default severity, and **Visible operations**: which of the five built-in operations staff can log (the types themselves are fixed; at least one must stay on).

## 6.7 Refrigeration Admin

Tabs: **Setup · History · Settings**.

- **Setup** — the reading structure: **Sections** (a seed button creates the six standard ones: Compressors, Pumps, Condensers, Supply/Return, Machine Hours, Alarms) → per-section **Equipment** → **Fields** (numeric, text, boolean, select, computed; with units and select options) → **Thresholds** per field: scope (all equipment or one unit), min, max, and severity (warn / high / critical). An equipment-specific threshold overrides the section-level one — the same precedence staff see in their range hints.
- **History** — filter by employee, dates, out-of-range (Any/Yes/No), notes. Detail shows every value with **Out of range** badges; notes are append-only; deletion is super-admin-only.
- **Settings** — out-of-range alerts on/off (off by default), default alert severity, and **readings per shift** (caps the staff Round # field and shows "of N" in their form).

## 6.8 Dasher Boards Admin

The spatial module. **Labels are permanent identity — the editor never renumbers existing assets.** Tabs: **Perimeter · Checklist · Lists · Walks**, with a first-run wizard (rink name, template, dimensions, perimeter anchor, direction, inspection weekday) generating the whole perimeter from what you enter.

- **Perimeter** — tap a position to edit it: relabel, convert board↔door, set the door subtype, toggle glass, and enter **replacement specs** (dimensions, thickness, material — a "No spec on file" badge flags gaps, and a bulk glass-spec tool fills ranges at once). You can move the start point and change the glass numbering scheme — the numbers printed on the diagram change, but nothing is relabeled.
- **Checklist** — the inspection weekday plus cadenced items (weekly / monthly / yearly; daily ships empty by design — the tap-the-problem model carries daily coverage). Due items must be answered before a walk can sign off, and flagged items create issues in the same pipeline as spatial reports.
- **Lists** — door subtypes (Bench, Scoreboard, Zamboni…) and per-asset-type issue categories (boards, glass, doors).
- **Walks** — read-only inspection history with fail counts, rendered in the rink's glass numbering so it matches what the crew used on the floor.

One permission nuance: entering glass **specs** is available to the edit tier (managers), while structural perimeter changes stay admin-only.

## 6.9 Communications Admin

The hub that ties every module's alerts together. Tabs: **Inbox · Broadcast · Templates · Groups · Routing · Reminders · Deliveries · Audit Log**.

- **Inbox** — two views. **Alerts**: every alert from every module, filterable by source module, severity (info/warn/high/critical), open/resolved, and dates; drill in to **Resolve**, **Re-open**, or Delete (resolving is usually the better close-out), and see the per-person **acknowledgements** list. **Messages**: all staff messages with read/ack rollups.
- **Broadcast** — send to **groups**, **everyone with a role**, or the **whole facility**; start from a template; optionally **Send later** (scheduled broadcasts queue and can be cancelled until they go out); optionally require acknowledgement.
- **Templates** — reusable subject/body/ack presets, used by broadcasts, staff compose, and reminders.
- **Groups** — named recipient lists with members; the **"Staff can message this group"** toggle controls which groups staff see in their compose screen.
- **Routing** — the heart of the alerting story. Each rule: name, **source module**, severity filter, optional area (daily-report area or air-quality location), a single **target** (group, role, employee, or department), a **timing** (Immediate, End-of-day digest, Weekly, or Manual), and two checkboxes — **Attach PDF of the submission** (renders a PDF of the source record onto the email and message) and **Require recipient acknowledgement**. A **Preview Recipients** action shows who a rule will actually hit before it fires. With no rules, alerts still land in this inbox — they just don't fan out to people.
- **Reminders** — recurring scheduled sends: a 5-field cron schedule (e.g. `0 9 * * 1` = 9:00 AM every Monday, evaluated in the facility's timezone), a template, and a group/role target.
- **Deliveries** — failed email and notification sends that exhausted their automatic retries, each with a **Retry** button that re-queues it.
- **Audit Log** — the communications-scoped audit trail.

## 6.10 How a submission becomes an alert (the pipeline)

Worth a whiteboard minute in any admin training:

1. A staff member submits a report. If it trips a configured trigger — an out-of-range refrigeration value, an air-quality exceedance, a failed circle check, an alert-flagged medical-attention level, a severity-A dasher issue — the module raises an **alert**.
2. **Routing rules** match it (module, severity, area) and fan it out to their targets on their timing — immediately, in an end-of-day digest, or weekly.
3. Recipients get an **in-app message** and an **email**; if the rule attaches a PDF, a rendered PDF of the submission is linked in-app and attached to the email.
4. If the rule requires acknowledgement, recipients must acknowledge in their inbox — and admins can watch the ack list on the alert.
5. Background jobs run every few minutes to render PDFs, drain the queue, and send emails, with automatic retries; anything that fails permanently surfaces in **Deliveries** for a manual retry.

Individual accident/incident PDFs reach people exactly two ways: as a routing-rule attachment, or inside a date-range export. There's no per-report download button on those admin detail pages.
