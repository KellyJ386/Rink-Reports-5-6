# RinkReports — Operations & Training Manual

**RinkReports**

*Version 5-6 · Generated 2026-06-27*

Brand: primary green **#4DFF00** · navy **#002244**

---

RinkReports is a progressive web app (PWA) for ice-rink facility operations. It replaces the clipboards and binders at the rink desk with structured, mobile-first digital flows: daily checklists, refrigeration and air-quality readings, ice operations logs, ice-depth measurements, incident and accident reports, and employee scheduling — all configured per facility from a single Admin Control Center.

**You only see data for your own facility — this is automatic.** There is no facility switcher for staff or facility admins; the app keeps each rink's records separate on its own. (The one exception is the platform-wide Super Admin console.)

---

## Table of contents

### Onboarding guides (start here)

- [Admin onboarding — stand up a new facility](./ONBOARDING-ADMIN.md)
- [Supervisor onboarding — day-to-day oversight](./ONBOARDING-SUPERVISOR.md)
- [Staff onboarding — here's how to do your job](./ONBOARDING-STAFF.md)

### Module chapters

1. [Admin Control Center](./modules/admin-control-center.md)
2. [Daily Reports](./modules/daily-reports.md)
3. [Refrigeration Logs](./modules/refrigeration-logs.md)
4. [Incident Reporting](./modules/incident-reporting.md)
5. [Ice Operations](./modules/ice-operations.md)
6. [Air Quality](./modules/air-quality.md)
7. [Ice Depth](./modules/ice-depth.md)
8. [Employee Scheduling](./modules/employee-scheduling.md)

### Reference

- [How RinkReports is organized](#how-rinkreports-is-organized)
- [Module summaries](#module-summaries)
- [Glossary of cross-module terms](#glossary-of-cross-module-terms)
- [Open questions / ⚠ VERIFY items](#open-questions--️-verify-items)

---

## How RinkReports is organized

### The eight modules

RinkReports is built from eight core modules. An admin turns each one on or off for the facility, and each appears in the staff menu only when enabled and the person has permission.

1. **Admin Control Center** — the back office: facility settings, employees, roles, permissions, lists, exports, retention, and the audit log.
2. **Daily Reports** — digital shift checklists, one per work area, ticked off and submitted each shift.
3. **Refrigeration Logs** — structured readings for the refrigeration plant, checked live against normal ranges.
4. **Incident Reporting** — records of something that went wrong (slip, collision, medical), reviewed and tracked by managers.
5. **Ice Operations** — the maintenance logbook: ice makes, edging, blade changes, and circle-check inspections.
6. **Air Quality** — CO / NO₂ / CO₂ readings checked live against the facility's compliance thresholds.
7. **Ice Depth** — point-by-point ice thickness measured against a tappable rink diagram.
8. **Employee Scheduling** — shift planning (admin grid) plus staff self-service (availability, time off, swaps, open shifts).

### Role tiers

This manual uses a five-tier vocabulary, highest to lowest:

| Doc tier | One-line description |
|---|---|
| **super_admin** | Platform owner. Cross-facility access; the only tier that sees the Super Admin console, creates facilities, and hard-deletes records. |
| **org_admin** | A multi-facility / organizational administrator sitting between super_admin and a single facility admin. |
| **facility_manager** | The person who runs the Admin Control Center for one facility — configures modules, employees, and settings. |
| **supervisor** | A mid-tier overseer with some elevated approval/review rights (e.g. scheduling decisions, submission review). |
| **staff** | Front-line workers who submit reports and use self-service scheduling. |

> **⚠ VERIFY — role mapping.** The live application does **not** use those five fixed tiers. The real model is **super_admin / admin / manager / staff**, plus optional **per-facility custom roles** (e.g. `driver`). Access is resolved **per module and per action** (View / Submit / Edit / Admin) through a permissions system — roles only seed default permissions, and an admin can override any individual person's access. The closest mapping:
>
> | Doc tier (this manual) | Live app role | Notes |
> |---|---|---|
> | super_admin | `super_admin` (platform flag) | Cross-facility; sees the Super Admin console. |
> | org_admin | *(no exact equivalent)* | **⚠ VERIFY** — the app has **no separate org/multi-facility admin tier**. Treat as super_admin for now. |
> | facility_manager | `admin` (facility administrator) | Runs the Admin Center for one facility. |
> | supervisor | `manager` (or a custom role) | Some elevated rights — **but permission-driven, not title-driven**. |
> | staff | `staff` (or a custom role) | Submits reports; self-service scheduling. |
>
> Because access is permission-driven, two people with the same title can have different access if an admin has customized it. Read every "tier X can do Y" statement as "a user with the matching permission can do Y."

### You only see your own facility's data

This is automatic and not configurable by staff or facility admins. There is no facility switcher, no way to view another rink's records, and nothing to set up — the separation is built in. Only the platform-wide Super Admin console works across facilities.

---

## Module summaries

Each summary links to the full chapter. The chapters hold the screen-by-screen detail, field references, and per-module troubleshooting.

**[Admin Control Center](./modules/admin-control-center.md)** — The configuration hub for one rink. Here a facility_manager sets the facility's information, turns report modules on or off, adds and manages employees, assigns roles and per-person permissions, manages shared lists (departments, facility spaces, dropdowns), and controls system settings for exports, data retention, and the audit log. Nothing a staff member sees is hardcoded — it all flows from here. Facility creation and granting Admin-module Admin access are super_admin-only.

**[Daily Reports](./modules/daily-reports.md)** — The digital shift-checklist clipboard. The facility is divided into **work areas**; each area has one or more checklist **templates** ("shifts"). Staff pick an area and shift, tick off tasks, leave an optional note, and submit. Every submission is an independent, append-only record auto-tagged with the facility's local date; reports auto-delete after 14 days. Submit access is granted area-by-area.

**[Refrigeration Logs](./modules/refrigeration-logs.md)** — Structured readings for the refrigeration plant (compressors, pumps, condensers, brine, machine hours, alarms). Admins build sections, equipment, and reading fields, and set thresholds (normal ranges). Staff enter a round of readings, see "Normal: min – max" hints live, and must write a corrective-action note for any critically out-of-range value. A °F/°C toggle changes display only. Append-only.

**[Incident Reporting](./modules/incident-reporting.md)** — Records of something that went wrong: when/where, what happened, severity, whether an ambulance was called, who was involved, and up to three witnesses. Uniquely, the reporter can **edit their own report for 24 hours**, after which it locks. No photo/file upload. Admins review in History, change status, and add follow-up notes.

**[Ice Operations](./modules/ice-operations.md)** — The maintenance logbook covering four built-in operation types: **Ice Make**, **Edging**, **Blade Change**, and **Circle Check** (a pass/fail inspection where failed items require a note and raise an alert). A facility chooses which types to show; equipment and circle-check items are admin-configured. Append-only.

**[Air Quality](./modules/air-quality.md)** — CO / NO₂ / CO₂ (and more) readings, checked live against the facility's compliance profile with colored range badges (Within range / Corrective / Notification / Evacuation). Thresholds derive from a regulatory jurisdiction and can be **tightened but never loosened**. Over-threshold readings are exceedances and require a corrective-action note. Append-only.

**[Ice Depth](./modules/ice-depth.md)** — A two-phase (measure → review) flow that records ice thickness point-by-point against a tappable USA-Hockey rink diagram, tuned for Bluetooth calipers. Each point colors live by severity. Measures **depth, not temperature** (unit is inches or mm — no °F/°C toggle). Submitted sessions are immutable, with PDF / print / send options.

**[Employee Scheduling](./modules/employee-scheduling.md)** — Two sides: the **admin grid** (drag-build shifts, assign people, publish via a two-person request/approve flow) and the **staff app** (my shifts, availability, time off, claim open shifts, request swaps). Runs cert/hour-cap/overtime rule checks. **No payroll, timekeeping, or clock-in/out** — it is assignment only.

---

## Glossary of cross-module terms

- **Area / work area** — A zone of the facility. In Daily Reports it's the checklist scope (and the "tabs" staff see); submit access is granted area-by-area. In scheduling, **job areas** are positions people are scheduled into.
- **Template / checklist** — A named, ordered set of tickable items. In Daily Reports a template is a "shift" within an area; in Ice Operations a circle-check template; in scheduling a reusable shift pattern.
- **Threshold** — An admin-defined normal range (and severity) for a numeric reading. Drives the "Normal: min – max" hint (Refrigeration), the live range badges (Air Quality), and severity colors (Ice Depth).
- **Exceedance** — A reading that crosses a threshold. Flagged on the report, counted on the confirmation screen, and (if alerts are on) raised to managers. In Air Quality an exceedance forces a corrective-action note.
- **Corrective-action note** — A required free-text note describing what was done about an out-of-range / failed reading. Required for critical refrigeration breaches, air-quality exceedances, and failed circle-check items; blocks submit until written.
- **Draft / published** — Scheduling states. Drafts are admin-only and freely editable; publishing makes shifts visible to staff and opens unassigned ones for claiming.
- **Publish-lock** — Once a shift is published it can't be freely edited or deleted; changes go through a controlled, audited path that re-checks rules and notifies affected staff.
- **Soft cancel** — Deleting a *published* shift marks it **cancelled** (kept for the record) rather than erasing it. Draft shifts are deleted outright.
- **Append-only** — Each submit creates a new, permanent record that staff cannot edit. To correct, you submit again (incidents' 24-hour window is the exception). Admins add follow-up notes rather than editing.
- **Follow-up note** — An append-only note an admin adds to a submitted report from the History detail panel. Cannot be edited or deleted; the original report stays intact.
- **Offline queue / "Save on this device"** — When you submit offline, the report is saved on your device and syncs automatically when you reconnect, re-running the same checks server-side. Each queued item has a unique id so a retry can't create a duplicate.
- **Facility scoping** — The automatic rule that you only ever see and act on your own facility's data. Not configurable; built in.
- **Retention / purge** — Per-module rules (Admin → Data Retention) that permanently delete records older than a set number of days, optionally each night. Destructive; gated behind a warning. (Daily Reports auto-purges after 14 days.)
- **Seed defaults** — A one-click button on many setup screens that creates a standard starter configuration (sections, reading types, roles, etc.), safe to skip and edit afterward.

---

## Open questions / ⚠ VERIFY items

This appendix collects every ⚠ VERIFY flag from the discovery manifest and all eight module chapters. Each should be validated against a real configured facility before publishing hard claims.

### Roles, tiers & permissions (Manifest; Admin Control Center; every module's "Who can use it")

1. **No org_admin tier in the live app.** The five-tier vocabulary (super_admin / org_admin / facility_manager / supervisor / staff) does not match the live model (super_admin / admin / manager / staff + custom roles). There is **no org_admin equivalent** — treat any org_admin need as super_admin. *(Manifest §Role Tiers, §Gaps 1; flagged in every module's role table.)*
2. **Access is permission-driven, not title-driven.** "Supervisor" / `manager` abilities are whatever permission rows an admin enables, not a fixed tier. Two people with the same title can differ. Validate every "tier X can do Y" claim against a configured facility. *(Manifest §2, §Gaps 1; Admin Control Center §2; Refrigeration §2; Incidents §2; Ice Operations §2; Air Quality §2; Ice Depth §2; Scheduling §2.)*
3. **Per-module delete rights.** "Delete = super_admin only" holds for facilities and the general pattern, but per-module delete (an admin deleting an area/template/session) should be confirmed module-by-module. *(Manifest §2, §Gaps 6.)*
4. **Only super_admin can grant Admin-module Admin access and edit facilities.** Confirmed in the Admin chapter as the intended guard; carry it forward as the rule for who can hand out Admin Center access. *(Admin Control Center §2, §5 Permissions, §9.)*
5. **Roles screen navigation.** `/admin/roles` is a real screen but has **no sidebar entry** — it is reached only from the Admin Dashboard's setup checklist ("Canonical roles seeded" / "Role permission defaults") or by typing the address. Confirm this is the intended navigation. *(Manifest §1, §Gaps 5; Admin Control Center §3, §9.)*

### Daily Reports

6. **Area cap is 30, not 20.** Sales material mentions "up to 20 tabs"; the database enforces **30 active areas**. Confirm the exact number and whether "tabs" means areas or templates-within-an-area. *(Manifest §4, §Gaps 2; Daily Reports §4.)*
7. **No end-of-day lock.** The package described an end-of-day lock/single rolling report. The code uses an **append-only** model (one immutable record per submit, facility-date tagged, **auto-deleted after 14 days**) with **no per-day lock**. Describe it that way. *(Daily Reports §8.)*

### Refrigeration

8. **Supervisor / org_admin rows** in the access table are mapped to the live model and should be confirmed per facility (covered by items 1–2). *(Refrigeration §2.)*

### Incident Reporting

9. **24-hour edit window — confirmed.** The reporter can edit their own incident for 24 hours, then it locks read-only; confirmed in code (`edit_window_ends_at = now() + 24h`). *(Incidents §8.)*
10. **Incident Type not collected from staff.** Type appears as a column/filter and on the admin detail, but the current **staff** submission form does **not** present an incident-type picker. Confirm whether your facility expects staff to pick a type before training on it as a staff field. *(Incidents §4, §7.)*

### Ice Operations

11. **Temperature unit setting may be unused on live forms.** A Fahrenheit/Celsius display setting exists, but current staff forms don't collect a temperature; it mainly affects how legacy History readings display. Confirm whether any live staff field uses it. *(Ice Operations §4.)*
12. **Supervisor config rights** default — confirm whether a facility grants supervisors Ice Operations config by default (covered by items 1–2). *(Ice Operations §2.)*

### Air Quality

13. **Thresholds are tighten-only.** Facility overrides may only **lower** (tighten) a regulatory ceiling, never raise it; the app rejects looser values and clamps internally. Confirmed in code, but call it out clearly in training. *(Air Quality §4, §9.)*
14. **Supervisor / org_admin rows** mapped to the live model; confirm per facility (items 1–2). *(Air Quality §2.)*

### Ice Depth

15. **Unit is inches / mm — not cm.** The training brief said "in/cm," but the app's unit options are **inches** and **mm**. *(Ice Depth §4.)*
16. **Offline submit when no service worker is active.** If the device can't queue offline (no service worker), the app blocks the submit and tells the user to reconnect/reload, keeping typed readings on screen. Confirm this fallback behavior. *(Ice Depth §8.)*
17. **Super_admin-only session delete; supervisor rights** per facility (items 1–2). *(Ice Depth §2.)*

### Offline / PWA (Manifest §7)

18. **Offline tech is service worker + IndexedDB — not Dexie.** The package mentioned "Dexie"; no Dexie library is used. Describe it generically ("saved on your device, syncs when you reconnect") and never name Dexie. *(Manifest §7, §Gaps 3.)*
19. **Scheduling offline scope.** Only **availability** and **time-off** queue offline. **Swap requests, swap acceptance, open-shift claims, and the entire admin grid are online-only** by design. Confirmed in code, but the staff-side discovery once suggested swap requests might queue — treat swap/claim as online-only. *(Manifest §7, §Gaps 4; Scheduling §8.)*

### Other

20. **Related modules not deeply mapped.** Accidents, Communications, Facility Paperwork, Departments, Spaces, Lists, Exports, and Audit Log were inventoried at a screen level only; deeper field-level detail may be needed in their own chapters. *(Manifest §Gaps 7.)*
21. **Dashboard & Account pages** were noted as routes but their on-screen content was not fully inventoried; capture if they need training coverage. *(Manifest §Gaps 8.)*

---

*This manual links to, and does not duplicate, the module chapters in [`modules/`](./modules/). Where a chapter and this manual disagree, the chapter (closer to the code) wins — and the discrepancy belongs in the ⚠ VERIFY list above.*
