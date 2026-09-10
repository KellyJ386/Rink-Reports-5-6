# Dasher Boards

## 1. What this module is for

Dasher Boards is a **spatial condition tracker** for the physical perimeter around a sheet of ice — every board panel, glass panel, and door, in the order they actually run around the rink. It is not a report-writing form like Daily Reports or Incidents. It's a tap-a-segment-on-a-diagram tool: the diagram *is* the record.

Each segment carries its own **persistent condition**. Tap a panel, report what's wrong, and it stays flagged on the diagram — red, yellow, or coral depending on severity — until someone resolves it. There's no "submission" that closes the loop by itself; an open issue just sits there, visible to the next person who opens the map, until it's fixed.

Layered on top of that is an **optional inspection walk**: a facility can require a periodic (daily/weekly/monthly/yearly, per checklist item) sweep of the perimeter that ends in a sign-off. But the walk is an overlay, not a gate — tapping a bad panel and reporting an issue works identically whether or not a walk is open. The model is exception-based: when a walk *is* signed off, every segment nobody tapped is implicitly attested "OK."

The module is **per-rink**. A facility with multiple sheets of ice configures each rink's perimeter separately, and staff pick which rink's map they're looking at.

A few things worth knowing up front:
- **Labels are permanent identity.** Every board, glass, and door position gets a label (B1, G1, D1…) the first time it's created, and that label is never reused or reassigned to a different physical position — even if the position is later removed, converted, or the rink's whole layout is edited. This is deliberate: a door labeled "D4" stays "D4" in every issue report and every history row forever, so a supervisor reading last year's report can still tell exactly which physical door it was about.
- **Custom labels, glass numbers, and zones are a separate DISPLAY layer** on top of that permanent identity — a facility can rename what staff see ("Zam Gate Left," or "42" instead of "G42") without touching the identity issue history is keyed to.
- Dasher Boards writes queue through the same offline sync mechanism as the rest of the PWA (see §8) — a walk started in a dead zone under the stands still gets recorded.

You only see data for your own facility — this is automatic.

## 2. Who can use it

Access follows the app-wide permission model: four cumulative actions — **view, submit, edit, admin** — granted per user, per module, per facility (`src/lib/permissions/actions.ts`). An admin can grant or remove any of these independently of job title.

| Action | What it lets you do in Dasher Boards |
|---|---|
| **view** | See the condition map, open issues, and walk history. No interaction. |
| **submit** | Tap a segment and report an issue; start/continue a walk; run the guided walkthrough; sign off a walk; mark a non-critical (B/C) issue fixed. |
| **edit** | Everything submit does, plus: acknowledge a severity-A issue, mark *any* issue (including A) fixed, set a glass/door replacement spec, and (in the admin console) manage custom labels, aliases, zones, and out-of-service flags. |
| **admin** | Everything edit does, plus the full **Admin → Dasher Boards** console: build/edit the perimeter, convert boards ↔ doors, configure glass numbering, manage the checklist, door subtypes, and issue categories. |

The canonical role defaults (migration 193) map onto this as:

| Role | Default action |
|---|---|
| **super_admin / admin** | admin |
| **manager** | edit |
| **staff / driver** (and similar custom roles) | submit |

⚠ VERIFY — the seed migration also lists `supervisor` at `edit` and `gm` at `admin`, but the current live role model per this codebase's own guidance is `super_admin / admin / manager / staff` (plus custom roles like `driver`); treat `supervisor`/`gm` here as legacy entries carried in the canonical-grants table rather than roles you'll see on a new facility.

Notes that hold true in code:
- Reaching the **Admin → Dasher Boards** console requires both general Admin Center access (`requireAdmin()`) **and** the module-scoped `dasher_boards` **admin** grant — the two are checked separately (`requireModuleAdmin("dasher_boards")`), same pattern as Ice Operations. An admin console user without the module grant is turned back with an explicit message rather than a silent no-op.
- Setting a **glass or door replacement spec** is available to the **edit** tier even without admin console access (`ensureDasherBoardsEditor` — managers hold `edit` but not `admin`). Structural changes (relabeling, board↔door conversion, inserting/removing positions) require the **admin** tier.
- On the *severity-A* issue pipeline specifically: **submit** can report an A issue and later mark a **B or C** issue fixed, but only **edit** can acknowledge an A issue or close it out — a staff member can't self-close a safety-critical finding.

## 3. How to get there

**Staff:**
- In the sidebar (or the mobile **Menu** tab), choose **Dasher Boards**. This lands you directly on the condition map — `/reports/dasher-boards` resolves your facility's **default rink** (its `is_default` rink, or the first by sort order) and renders that rink's map immediately. There is no separate "pick a rink" screen.
- If your facility runs more than one rink, a **Rink** dropdown appears in the page header next to the title; switching it navigates to `/reports/dasher-boards/[rinkSlug]`, which is also the shareable/bookmarkable URL for a specific rink's map.

**Admins (to configure):**
- Open the **Admin Center**, then choose **Dasher Boards Admin** under Module Admin. This opens the tabbed console at `/admin/dasher-boards`.
- If your facility hasn't created a rink yet, the console skips straight to a "Set up your first rink" wizard (rink basics, then the perimeter sequence builder) instead of showing empty tabs.

## 4. Setup & configuration (admins)

**Admin → Dasher Boards** has five tabs: **Perimeter, Labels & Zones, Checklist, Lists, Walks.** A rink switcher (when there's more than one rink) sits above the tabs; each tab operates on whichever rink is selected. See the **Admin Control Center** chapter for how admin access and modules are managed generally.

### Perimeter tab — building the physical sequence

This is where the board/glass/door sequence around one rink gets built. Nothing about panel counts, doors, or positions is hardcoded — you generate a starting sequence, then edit it by tapping the diagram.

**Two ways to start** (shown when the rink has no positions yet):
- **Standard rink template** — one click applies a pre-built NHL-shaped layout: 33 board panels with 1:1 glass, four 3-segment corner-radius groups, a Zamboni gate, two penalty gates, and two bench gates, with zones pre-assigned (North End, East Side, Penalty Boxes, South End, West Side, Visitor Bench, Home Bench). It's a starting point, not a lock-in — every position can be relabeled, inserted, removed, reassigned, or reconverted afterward.
- **Uniform sequence** — enter a board-position count (1–500) and every position is created as a plain board panel with a 1:1 glass row; you mark doors and exceptions afterward by tapping.

Either way, a **start point** (an anchor label like "Zamboni gate," set by clicking a spot on the diagram) and a **walk direction** (clockwise/counterclockwise) define where sequence position 1 begins and which way the sequence counts — set once, changeable anytime, and purely a rendering choice (it never renumbers or relabels anything).

**Tap a position on the diagram** to select it and open its editing panel:
- **Mark as a door** (or **Convert to board** for an existing door), pick a **door subtype** (Bench, Scoreboard, Public Skate, Zamboni, or a facility-defined one from the Lists tab).
- **Relabel** — override the *permanent* label directly (rare; the display layer on Labels & Zones is the normal way to rename what staff see).
- **Insert a board/door after this position**, or **Remove** it.
- Toggle **glass on/off** at a board position (for sections with no shielding).
- Enter a **replacement spec** (width × height × thickness × material + notes) for the glass at this position, or for a door's own glass.

**The board ↔ door conversion, precisely:** converting a board panel to a door keeps the same underlying row and its issue history, but the position takes the **next available door label** — e.g. `B12` becomes `D5`; `B12` is retired forever and can never be reused, even by a later position. The position's 1:1 glass row is deactivated ("parked"), because the door now carries its own glass spec instead. Converting a door back to a board does the reverse — it takes the next available **board** label, and restores the parked glass row *only if that specific park was caused by this door's original conversion* (a glass row an admin turned off independently, before or since, stays off). Every conversion, relabel, insert, and removal is written to a permanent asset-event audit trail.

**Removing a position:** if the position (or its glass) has any issue history, it's **soft-retired** — the row and its label are preserved (so history stays intact) and the sequence gap closes; a position with zero history is hard-deleted instead. Either way you can't remove a position that still has **open** issues — resolve them first.

**Glass numbering** (its own card) is a separate, purely cosmetic overlay: a prefix, starting number, direction, and whether doors take a number — it changes what the app *prints* on the diagram and in reports, never the underlying permanent `G`-label. Off by default (shows the permanent G-labels). A **bulk glass spec** tool applies one width/height/thickness/material to a range of glass panels at once (e.g. every side-wall panel), with individual overrides afterward for exceptions like corner radius panels or doors.

### Labels & Zones tab

A banner at the top restates the datum: every label, zone assignment, and walkthrough order below is measured from the Perimeter tab's start point and direction, with a shortcut back to change it.

- **Zones** — named groupings (North End, Home Bench, etc.) for faster lookup during a walk and as bulk-labeling targets. Add, rename, reorder, and deactivate (deactivating keeps the assignment history but hides the zone from new assignments).
- **Bulk labeling** — apply a custom **display** label pattern (prefix + start number + step + direction) across a whole zone or a contiguous perimeter range in one pass, e.g. every panel in Home Bench becomes HB1, HB2, HB3…. A live preview flags any collision (case-insensitive, per-rink) before you can apply it. This only ever writes the display-layer `custom_label` — the permanent `label` underneath is untouched, and issue history keeps following the permanent label regardless of what a segment is renamed to.
- **Segments list** — every active position in perimeter order, grouped by zone, with drag-and-drop (or up/down arrows) to **reorder the physical walk sequence itself**. This changes the order the sequence runs in, not any position's permanent label. Expanding a row lets you set its **custom label**, **search aliases** (up to 12, for finding a segment by a nickname), its **zone**, and its **out of service** flag (which flags the segment on walk checklists until cleared).

### Checklist tab

Sets the **inspection weekday** (which day of the week weekly items come due) and manages **checklist items** — a facility-defined list of non-spatial things to check on a cadenced schedule: **daily, weekly, monthly, or yearly** (with a due month for yearly items). Weekly items come due on the configured weekday; monthly items are due until the month's first completed walk answers them; yearly items are due in their configured month until answered that month. The daily cadence ships with no items by design — daily coverage comes from the tap-a-segment model on the map itself, not a checklist.

### Lists tab

Two facility-wide (not per-rink) lists that a walk needs in order to classify what it finds:
- **Door subtypes** — the picker shown when marking a position as a door (ships with Bench, Scoreboard, Public Skate, Zamboni; add your own).
- **Issue categories**, one managed list per asset type (board panel, glass panel, door) — the quick-pick category shown when reporting an issue on that kind of segment.

If a facility has neither list configured yet, a **Seed defaults** card offers to fill in a starter set (four door subtypes, a handful of issue categories per asset type) in one click — it only ever fills empty lists, so it's safe to click even after some manual customization, and it never touches rinks or the perimeter (those are physical layout decisions with no sensible default).

### Walks tab

A read-only drilldown into every inspection walk run on the selected rink — completed and in-progress, newest first, with the inspector, a pass/fail tally, and (when applicable) an "Annual contractor" badge. Selecting a walk opens its detail: every asset check on that walk (fails listed first), the walk's own notes, and — for an annual contractor inspection — the contractor's name and company. An **Export history (CSV)** button pulls the rink's complete inspection/issue history (every walk check and every issue ever logged, with resolution status) for offline recordkeeping — the kind of artifact an ice-rink safety audit (ORFA) wants to see.

## 5. Screen-by-screen walkthrough

### The condition map (`/reports/dasher-boards` or `/reports/dasher-boards/[rinkSlug]`)

This single screen is the whole staff-facing tool:
- A status line: when the rink was last walked (and by whom), or "No completed walks yet," plus "Due today" once a day passes without one.
- The **perimeter diagram** — every board and door as a tappable segment in perimeter order, colored by condition: **red** = an open severity-A issue, **yellow** = an open B/C issue, **coral** = a flagged fail with no issue reported yet, **lime** = a door, **dashed outline + ×** = out of service. A **Glass** toggle overlays the glass layer; a **search box** highlights segments matching a label, custom label, glass number, or alias.
- **Checklist — due today** card (only shown when items are due and you hold submit) — Pass/Fail each due item; a flagged item immediately opens its report-issue sheet, because a flag needs a linked issue before sign-off.
- The **walk bar** — starts collapsed with just a "Start inspection walk" button (plus a secondary "Annual contractor inspection…" option that asks for a contractor name and company) when no walk is open. Once a walk is active it becomes a sticky bar showing elapsed time, due-item progress, a **Guided walkthrough** launcher, and a **Sign off** toggle that expands into the completion form.
- Tapping **any segment** — walk open or not — opens its bottom sheet (see below). Tapping a checklist item opens a similar sheet scoped to that item.

### The asset bottom sheet

Opens when you tap a board, glass, or door position:
- Header: the segment's resolved display label (custom label, or glass number, or the permanent label — whichever applies), its type/subtype badge, an out-of-service badge if flagged, and its zone.
- **Open issues** on this segment, each with severity, category, description, and (permission-gated) Acknowledge/Mark fixed buttons.
- **Report issue** — the default, expanded-by-default form: pick board vs. glass if the position has both, a severity (A/B/C, defaulting to B), a category, a description, and — only for severity A — a required action-taken note and a required supervisor. Submitting collapses the form to a confirmation with a "Report another" option.
- **Condition check** (only while a walk is open) — a separate Pass/Fail with its own optional note, saved immediately on tap.
- A read-only **replacement spec** (dimensions, thickness as a fraction, material, notes) when one is on file.
- A collapsed **issue history** (resolved issues only; online-only), each row flagging when it was logged under a different label than the segment currently shows.

### Guided walkthrough

A full-screen, one-segment-at-a-time overlay for stepping through every active positioned segment in perimeter order — the same order the diagram itself walks. Each screen shows the segment's big display label, type, zone, and aliases, with two giant buttons: **OK** (records a pass and auto-advances to the next *unchecked* segment) and **Flag** (records a fail and opens that segment's report-issue sheet). **Previous** and **Skip** step freely without the "already checked" filter. When every segment has been handled, it hands off straight to the sign-off panel. This is a second way to drive the exact same Pass/Fail persistence the free-tap flow uses — nothing about it is a separate code path.

### Sign-off (walk completion)

Expanding "Sign off" in the walk bar shows an optional walk-notes box and a **Complete walk** button. Completing checks three gates server-side and rejects the sign-off (with a specific count in the error) if any fail:
1. any severity-A issue logged during this walk still lacks supervisor acknowledgment;
2. any checklist item due that day is unanswered;
3. any checklist item flagged "needs attention" has no linked issue report.

A signed-off walk is immutable — see §8.

### Walk-complete screen (`/reports/dasher-boards/[rinkSlug]/done?id=…`)

A confirmation screen for one completed walk: pass/fail/issue/checklist stat pills, a read-only diagram colored by that walk's final conditions, the notable condition checks (every fail, plus any pass with a note), the issues logged, the checklist answers, and the walk notes. Action buttons: **Download PDF**, **Print Report** (browser print, chrome hidden automatically), **Send Report** (to the facility's configured Dasher Boards recipients — see §6), and links back to the rink map or the dashboard.

## 6. Step-by-step: common tasks

### Report a problem panel (no walk needed)
1. Open **Dasher Boards** — you land on your rink's map.
2. Tap the board, glass, or door segment that's damaged.
3. In the bottom sheet, fill out **Report issue**: pick board or glass if relevant, choose a severity, a category, and describe it. Severity A also needs a supervisor and the action taken.
4. Tap **Submit issue**. The segment turns red or yellow on the map immediately for everyone who opens it next.

### Run an inspection walk
1. From the map, tap **Start inspection walk** in the walk bar (or **Annual contractor inspection…** if this is an ORFA-style contractor visit — enter their name and, optionally, company).
2. Either tap segments directly as you walk the rink (Pass/Fail in the bottom sheet's Condition check block), or tap **Guided walkthrough** to step through every segment in order with big OK/Flag buttons.
3. Answer any **due checklist items** shown in their own card.
4. When done, expand **Sign off**, add notes if you like, and tap **Complete walk**. Fix anything the sign-off gate flags (an unacknowledged A, an unanswered due item, a flag with no issue) and try again.
5. You land on the walk-complete screen — download/print/send the report from there if needed.

### Convert a board position to a door (admin)
1. **Admin → Dasher Boards → Perimeter**, tap the board position on the diagram.
2. Pick a **door subtype** (or leave it unset), then tap **Mark as door**.
3. The position keeps its history but takes the next door label; its glass row is parked automatically. Enter the door's own glass spec if it carries one.

### Rename what staff see without losing history (admin)
1. **Admin → Dasher Boards → Labels & Zones**.
2. Either open one segment in the list and set a **Custom label**, or use **Bulk labeling** to rename a whole zone or range at once with a prefix/start/step pattern.
3. The permanent label (shown in parentheses wherever it diverges) keeps every past and future issue tied to the right physical position.

### Seed a new facility's Dasher Boards config (admin)
1. **Admin → Dasher Boards → Lists** — click **Seed defaults** if shown, to get starter door subtypes and issue categories.
2. **Perimeter** tab — apply the **standard rink template** or generate a uniform sequence, then mark doors and adjust by tapping the diagram.
3. **Labels & Zones** — set up zones and any custom labels the facility uses.
4. **Checklist** — add any cadenced items beyond the spatial tap-and-flag coverage.

### Send or download a walk report
On the walk-complete screen (or reached again from Admin → Walks → a walk → the walk detail, ⚠ VERIFY whether the admin detail view itself links back to this screen):
- **Download PDF** for a shareable copy.
- **Print Report** for a clean, chrome-free printout.
- **Send Report** to push it to the facility's configured Dasher Boards recipients (Admin → Communications routing rules). If none are configured, the button says so and names where to set one up.

## 7. Field reference

| Field | Where | What it is |
|---|---|---|
| Rink | Header switcher | Which sheet of ice you're viewing (only shown with more than one active rink). |
| Segment (board / glass / door) | Condition map | A single perimeter position. Tap to open its sheet. |
| Severity | Report issue | **A** (safety-critical — requires a supervisor + action taken), **B** (needs repair), **C** (cosmetic). Defaults to B. |
| Category | Report issue | A quick-pick reason, scoped to the segment's asset type (board/glass/door). |
| Description | Report issue | Free text describing the problem. Required. |
| Action taken / Supervisor | Report issue (severity A only) | Both required before an A issue can be saved. |
| Condition check | Asset sheet, walk only | Pass/Fail (+ optional note) for this segment on the current walk. |
| Walk kind | Walk bar | **Routine** (default) or **Annual contractor** (records a contractor name + company). |
| Checklist item | Due-today card | A cadenced (daily/weekly/monthly/yearly) non-spatial check; Pass or Flag. A flag needs a linked issue before sign-off. |
| Walk notes | Sign-off | Optional free text saved with the completed walk. |
| **Admin — Rink** | | Name, slug, template (NHL/Olympic/custom dimensions), perimeter anchor label + direction, inspection weekday, active/default. |
| **Admin — Perimeter position** | | Type (board/door/corner/post-gap), permanent label, sequence position, subtype (doors), glass spec (width/height/thickness/material/notes). |
| **Admin — Custom label / aliases / zone / out-of-service** | Labels & Zones | Display-layer overrides; never affect the permanent label or issue history. |
| **Admin — Glass numbering** | Perimeter | Prefix, start number, direction, whether doors count; display-only. |
| **Admin — Door subtype** | Lists | The category shown when marking a position as a door. |
| **Admin — Issue category** | Lists | Per-asset-type quick-pick list for issue reports. |
| **Admin — Checklist item** | Checklist | Label, cadence (daily/weekly/monthly/yearly), due month (yearly only). |

## 8. Locking, saving & offline

**Open issues stay open until resolved — there's no auto-expiry.** A reported issue persists on the diagram (coloring that segment red/yellow) until someone with the right tier acknowledges (severity A) and/or marks it fixed. Nothing about tapping a segment "closes" the loop by itself.

**A signed-off walk is immutable.** Once `completeInspection` succeeds, the walk row is locked — the three sign-off gates (unacked A issues, unanswered due items, unlinked flags) are the only thing standing between "in progress" and "final," and once past them there's no editing a completed walk from either the staff or admin side. If something was logged wrong, the fix is a new issue or a new walk, not an edit to the old one.

**Labels never get renumbered or reused**, including on retired/removed positions — see §1 and the Perimeter tab section in §4. This is a deliberate design constraint enforced by the database, not just app-level convention: a relabel, conversion, or removal can shift *sequence*, but never *identity*.

**Offline.** Dasher Boards routes every staff write through the app's standard offline sync queue (`_lib/offline.ts`, mirroring the Ice Depth pattern) — this module is **not** one of the online-only exceptions called out for scheduling in the architecture notes:
- **Reporting an issue**, **starting a walk** (routine or annual contractor), **answering a checklist item**, **saving a Pass/Fail check**, and **signing off a walk** all queue on your device when you're offline and replay automatically once you reconnect.
- An offline-started walk has no server id yet; every queued action targets the *rink*, and replay resolves "my open walk on this rink" server-side — so a queued sequence (start → report issue → answer checklist → sign off) replays in order and lands correctly even though it was all typed with no connection.
- The **sign-off gates re-run at replay time**, not just when you tapped Complete — an offline sign-off that no longer satisfies them (say, an unacknowledged severity-A issue that's still unacknowledged once you're back online) is parked as a failed sync rather than being forced through.
- **Acknowledging or resolving an issue is not a queued offline action** — those are supervisor decisions made against live state and require a connection.
- Viewing walk history, the Admin console, and the walk-complete/PDF screens all require a live connection; only the act of *submitting* is offline-capable.

## 9. Troubleshooting & FAQ

**I don't see Dasher Boards in my menu.** Your facility hasn't turned the module on, or your account lacks the **view** permission. Ask an administrator.

**"No access to Dasher Boards."** You have view access to the app generally but not the Dasher Boards **view** grant specifically. Ask an admin to grant it under Admin → Permissions.

**"Dasher Boards isn't set up yet."** No rink/perimeter has been configured for your facility. An admin needs to build the Perimeter tab first (Admin → Dasher Boards). If you're an admin yourself, opening the module sends you straight into the setup wizard instead of this message.

**I tapped a segment but there's no Report issue form.** You need the **submit** permission to report issues. Viewing is unrestricted at the view tier; reporting requires submit.

**A severity-A issue won't let me mark it fixed.** Severity-A (safety-critical) issues require the **edit** tier to acknowledge or resolve — a staff member with only submit can close out B/C issues but not A. Ask a supervisor or admin.

**Sign-off keeps getting rejected.** Read the error — it names exactly what's blocking it: an unacknowledged severity-A issue, an unanswered due checklist item, or a flagged item with no linked issue. Fix that specific thing and try again.

**Why does converting a board to a door change its label?** Labels are permanent identity tied to what a position *physically is*. A door and a board panel are different kinds of asset, so the conversion assigns the next label in the door sequence (e.g. D5) and permanently retires the old board label (e.g. B12) rather than reusing it — this keeps every prior issue report on that spot traceable.

**I renamed a segment and now the diagram shows something different from an old report.** That's expected — custom labels and glass numbers are a display layer. Every issue and check keeps its `label_snapshot`, the label that was in effect *when it was logged*, so old reports still read correctly even after a rename; the asset sheet and history call this out explicitly when the two diverge.

**"Send Report" says no recipients.** No distribution list is configured for Dasher Boards. An admin sets one up under Admin → Communications.

**Can I edit a signed-off walk?** No. Completed walks are immutable by design (see §8) — log a new issue or start a new walk instead.

**Does the daily checklist cadence do anything?** Not until an admin adds items to it. It ships empty on purpose — daily coverage is meant to come from tapping problems on the map as you notice them, not from a separate daily list.

## Source (footnote)

This chapter was written against the following files (not from memory):

- Admin: `src/app/admin/dasher-boards/{page.tsx,actions.ts,types.ts}`, `src/app/admin/dasher-boards/_components/{perimeter-tab.tsx,labels-tab.tsx,checklist-tab.tsx,lists-tab.tsx,walks-tab.tsx,walk-detail.tsx,rink-settings-card.tsx,seed-defaults-card.tsx,bulk-labeler.tsx}`
- Staff: `src/app/reports/dasher-boards/{page.tsx,actions.ts}`, `src/app/reports/dasher-boards/_components/{rink-screen.tsx,rink-switcher.tsx}`, `src/app/reports/dasher-boards/[rinkSlug]/page.tsx`, `src/app/reports/dasher-boards/[rinkSlug]/_components/{condition-map.tsx,guided-walk.tsx,walk-bar.tsx,due-card.tsx,asset-sheet.tsx,issue-form.tsx,item-sheet.tsx}`, `src/app/reports/dasher-boards/[rinkSlug]/done/page.tsx`, `src/app/reports/dasher-boards/[rinkSlug]/done/_components/{print-walk-button.tsx,send-report-button.tsx}`, `src/app/reports/dasher-boards/[rinkSlug]/done/pdf/route.ts`
- Logic: `src/app/reports/dasher-boards/_lib/{compute.ts,submit.ts,queries.ts,offline.ts,glass-numbering.ts,segment-labels.ts,perimeter-template.ts,display-label.ts}` and their companion `.test.ts` files
- Permissions: `src/lib/permissions/actions.ts`, `supabase/migrations/00000000000193_dasher_boards_module_registration.sql`
