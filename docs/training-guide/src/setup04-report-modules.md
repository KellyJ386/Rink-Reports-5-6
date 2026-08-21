# 4. Configure the Report Modules

Each module's admin console lives under **Module Admin** in the sidebar. This chapter covers only what must be configured *before staff can submit* — the day-to-day review workflows are covered in the companion training guide. Every console requires the module's own Admin grant on top of Admin Center access.

## 4.1 Daily Reports

Staff can't submit until an area, a template, and area access exist.

1. **Areas** — the work areas staff pick from (name, color, sort order). Capped at **30 active areas**; bulk CSV upload available.
2. **Templates** — per area, the shift checklists ("Opening checklist", "Closing checklist"), each with a description and sort order.
3. **Checklist Items** — per template: label, optional description, order. Bulk import supported; items can be moved between templates.
4. **Area Access** — the staff × area checkbox matrix controlling who may submit where. Nothing is granted by default; an employee with no boxes sees "No areas assigned." CSV import/export available.
5. **Form Builder** (optional) — versioned custom forms letting staff file multiple *titled* reports per day. Field types: text, textarea, number, select, multiselect, checkbox, time, date (max 100 fields). Publishing an edit creates a new version; existing reports keep their frozen snapshot.
6. **Assignments** (optional) — enable **area assignment routing** to route areas to specific people each day (resolution: manual override → published schedule → default owners → open), set the pre-close warning window, and per area configure default owners and scheduling job-area mappings.

## 4.2 Incident Reports

Staff submission is blocked until at least one **severity level** exists ("Not configured yet" otherwise).

- **Severity Levels** — seed defaults from the empty-state card, then adjust (key, display name, color, order).
- **Incident Types** (optional dropdown) and **Activities** — both seedable; activities support bulk import.
- Locations come from **Facility Spaces** (chapter 3) — the "Manage locations" header button jumps there.

## 4.3 Accident Reports

Staff submission requires severities, medical-attention options, and body parts. On the **Dropdowns** tab, **seed defaults** creates all five vocabularies: **Injury Type, Body Part, Activity, Medical Attention, Severity**.

Two setup decisions matter:

- **Medical Attention → "Triggers communication alert"** — the checkbox that makes serious injuries notify managers automatically. Seeded on for Medical Office Visit, Emergency Room, and Hospitalization.
- **Workers' Comp tab** — write the instruction text staff must read and acknowledge when filing a comp claim. Until you do, the form shows "No instructions configured."

## 4.4 Ice Depth

1. **Rinks** — one per sheet of ice; mark one default.
2. **Diagrams** — per rink, a measurement layout; the point editor places each numbered point (label, X/Y position). Staff can't submit until a rink has a diagram with points. A seed card creates starter settings/layouts when everything is empty.
3. **Overlays** (optional) — door markers (door types are seedable) and a center-ice logo (transparent PNG/SVG/WebP, max 2 MB) rendered as a watermark on every report.
4. **Settings** — measurement unit (inches/mm), **low** and **high thresholds** (defaults 1 and 1.5 in), **alert on** (low / high / any — this drives the dashboard status bubble), severity colors, alerts on/off, default severity. Sessions snapshot the unit and thresholds at submit time — later changes never reclassify history.

## 4.5 Ice Operations

On the **Setup** tab (a seed button creates a starter config):

- **Rinks** (for resurfacing runs) and **Equipment** — name, type (**Ice Resurfacer, Edger, Hand Edger, Other** — don't create "blade set" rows; blade changes are logged against the resurfacer, and old blade-set entries show a "Blade Set (retired)" badge), model, serial, hours count, **tank capacity** (enables the %-of-tank water unit on ice makes), and **fuel type**.
- **Fuel types** and **Circle-check templates** — templates are matched to a machine's fuel type when staff run a circle check (capped at 4 per facility, bulk item import). The legacy flat **circle check items** list (scoped to all equipment or one unit) serves machines without a matching template.
- **Settings** — alerts on/off, default severity, and **Visible operations**: which of the four built-in operations staff can log (**Ice Make, Circle Check, Edging, Blade Change** — at least one must stay on). Propane tank changes are no longer a separate operation: they're a **"Propane Tank Change" toggle on the Ice Make form**.

## 4.6 Refrigeration

The reading structure is a hierarchy you build on the **Setup** tab: **Sections → Equipment → Fields → Thresholds**.

- **Seed defaults** creates the six standard sections: Compressors, Pumps, Condensers, Supply/Return, Machine Hours, Alarms — plus a settings row.
- Per section, add **Equipment** (the units staff read) and **Fields** (numeric, text, boolean, select, computed — with units; numeric temperature fields participate in the staff °F/°C toggle).
- **Thresholds** per field: scope (all equipment or one unit — the specific wins), min, max, severity (warn / high / **critical** — critical breaches force staff to enter a corrective-action note before submitting).
- **Settings** — out-of-range alerts on/off (off by default), default alert severity, **readings per shift** (caps the staff Round # field).

One policy note: refrigeration is no longer strictly immutable. A refrigeration admin can **correct a numeric reading** on a submitted report (pencil icon, with a required reason); every correction — and any recalculated computed value — lands in the append-only change log. Corrections require the admin to have an active employee record in the facility. If your setup includes seeded computed-deviation thresholds (±2 °F, warn), treat them as *starting defaults to tune*, not commissioned values.

## 4.7 Air Quality

1. Locations come from **Facility Spaces**; per location (or facility-wide) add **Equipment** (monitors: name, model, serial).
2. **Reading types** — label, key, unit, decimals, required flag (e.g. CO in ppm, NO2 in ppm). Reading types carry no thresholds — those live in the compliance profile.
3. **Compliance** — pick the **jurisdiction profile** (badged Binding or Guidance; 1-hour TWA or Single-sample method), choose metrics tracked, and set **threshold overrides** per tier (Corrective / Notification / Evacuation) — you may *tighten but never loosen* below the regulatory floor. Write the **escalation steps** text operators see at each tier. Without a profile, no automated compliance evaluation runs.
4. **Settings** — testing frequency text shown to staff, default jurisdiction, alerts on/off, default alert severity.

## 4.8 Dasher Boards

A first-run wizard generates the whole perimeter from what you enter — nothing is hardcoded: rink **Name**, **Template**, **Length/Width (ft)**, **Perimeter anchor** (e.g. "Zamboni gate"), **Direction** (clockwise/counterclockwise), **Inspection weekday**.

Then, on the tabs:

- **Perimeter** — tap positions to mark doors (with subtypes), toggle glass, relabel, and enter **replacement specs** (a "No spec on file" badge flags gaps; a bulk glass-spec tool fills ranges). Labels are permanent identity — the editor never renumbers existing assets.
- **Checklist** — the inspection weekday plus cadenced items (weekly / monthly / yearly; daily is deliberately empty — the tap-the-problem model carries daily coverage).
- **Lists** — a **Seed defaults** card (shown while the lists are empty) fills both vocabularies in one click: door subtypes (Bench, Scoreboard, Public Skate, Zamboni) and per-asset issue categories (boards: Cracked, Loose/rattling, Gouged, Hardware missing; glass: Cracked, Chipped, Loose in frame, Clouded/scratched; doors: Latch faulty, Hinge damaged, Gap at seal, Does not close flush). Only empty lists are filled — **rinks and the perimeter are never seeded**; those you build in the wizard and editor.

## 4.9 The pattern to remember

Every module follows the same setup rhythm: **seed → adjust → set thresholds/alerts → grant permissions → test-submit as a staff user**. The last step matters: use the **Preview** button on an employee row (or a test account) and submit one real report per module before go-live — it verifies area access, thresholds, and routing in one pass.
