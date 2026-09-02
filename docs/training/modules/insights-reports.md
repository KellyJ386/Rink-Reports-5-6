# Insights (Facility Reports)

## 1. What this module is for

Insights is where you **run reports**: one page that pulls every module's activity into facility-wide compliance and activity numbers for any day, week, month, or year — and exports them as a branded PDF you can hand to a board, an insurer, or an inspector.

It covers nine modules: **Daily Reports, Ice Operations, Ice Depth, Refrigeration, Air Quality, Incident Reports, Accident Reports, Dasher Boards, and Employee Scheduling**. Each one you select appears as a card of metrics for the chosen period (counts of submissions, incidents by severity, exceedances, shifts filled, and so on — whatever that module's registered metrics are).

You only see data for your own facility — this is automatic.

> **Not to be confused with Rink Scheduling → Insights.** The rink-booking module has its own Insights page (ice utilization, revenue, A/R) inside Rink Scheduling. This chapter is about the facility-wide **Insights** entry in the main sidebar.

---

## 2. Who can use it

Insights is gated by its own **Reports** permission, separate from the modules it reports on — being able to *submit* an incident report does not by itself let you run the facility-wide numbers. Two actions matter:

- **view** — open Insights and read reports on screen.
- **edit** — everything view allows, plus **Export PDF**. Exporting is deliberately a higher tier: reading a number on screen is one thing; producing a document that leaves the building is another.

| Role tier | Default access |
|---|---|
| **super_admin** | Full access, including export. |
| **facility_manager** *(the live `admin` role)* | Full access, including export. |
| **supervisor** *(the live `manager` role)* | Full access, including export — Reports is one of the modules where the manager default reaches the top action, so a manager who can't open the Admin Center can still run the monthly report. |
| **staff / driver** | **No access by default.** The Insights item doesn't appear in their sidebar. An administrator can grant an individual the Reports **view** action if a particular staff member should read reports. |

As everywhere in RinkReports, these are role *defaults*, not hard rules — an admin can grant or revoke the Reports permission per person.

---

## 3. How to get there

In the left sidebar, click **Insights** (bar-chart icon, near the top under Dashboard). This opens the reports page at `/insights`.

The item only appears when both are true:

1. Your administrator has the **Reports** module turned on for the facility (Admin Center → **Modules**).
2. You hold at least the Reports **view** permission.

If you navigate to the page directly without permission, you get a "not available" explanation page — not an error, and not a login bounce.

---

## 4. Running a report

The page has three controls; every combination updates the cards below.

1. **Period** — choose **Day**, **Week**, **Month**, or **Year**.
2. **Date** — use the **‹ / ›** arrows to step one period back or forward, or **Today** to jump back to the current period. The header shows the exact date range being reported.
3. **Modules** — the module picker shows every covered module your facility has enabled. All are selected by default; click modules on or off to narrow the report (for example, just Incidents + Accidents for a safety review). Your selection carries through period and date changes.

Each selected module renders a card of its metrics for the period. A module with nothing recorded in the period says **"No activity recorded for this period."** — that's a real answer (zero activity), not an error.

---

## 5. Understanding the numbers

**Days are finalized overnight.** Every night, a rollup job computes and stores each facility's per-day metrics. All reports for past days aggregate those stored, finalized numbers — so a month report is fast, and the same question always gets the same answer.

**Today is live.** If your period includes today, today's portion is computed live from the source records at the moment you load the page, and a note tells you so ("Showing live numbers for today — tonight's rollup has not run yet"). Live numbers can change as staff keep submitting; after tonight's rollup they're finalized.

**Missing days are excluded, and the report says so.** If some days in the period don't have a completed rollup (for example, days before the facility started using RinkReports), an amber coverage banner states how many of the period's days are actually included — e.g. "covers 28 of 31 days." Days without data are *excluded from the totals*, never silently counted as zero. The same statement is printed on any PDF you export, so a reader can't mistake partial coverage for a full month.

**Week and Year follow *your facility's* calendar.**

- **Week** starts on the facility's configured week-start day (the same setting Employee Scheduling uses) — not automatically Monday.
- **Year** is the facility's **fiscal year** (per its configured fiscal-year start month), not necessarily January–December.

**Every date is the facility's local date.** Events are bucketed by the facility's own time zone: an incident at 11:30 PM counts on that calendar day at the rink, even though it's already "tomorrow" in UTC. The PDF's generated-at stamp is in facility time too.

---

## 6. Exporting a PDF

Requires the Reports **edit** permission — the **Export** button simply isn't shown at view tier.

1. Set up the exact report you want on screen (period, date, modules).
2. Click **Export**. The PDF is generated from the same data you're looking at — the exported numbers can never differ from what was on screen.
3. Your browser downloads `insights-<period>-<date>.pdf` (e.g. `insights-month-2026-08-01.pdf`).

**What's on the document:** your facility's name and logo, the configured header and footer text, the period, a per-module metric grid, the coverage statement if any days were missing, a **LIVE** badge if today's live numbers were included, and — what makes it a defensible record rather than a screenshot — **"Generated ⟨date & time, facility-local⟩ by ⟨your name⟩"** stamped on it, with page numbers.

Branding (logo, header text, footer text, Letter vs A4) comes from Admin Center → **Exports**. A facility that has never touched those settings gets clean defaults with a "Generated by RinkReports" footer.

---

## 7. Setup & configuration (admins)

There is almost nothing to configure — the metrics themselves are built in.

- **Turn the module on:** Admin Center → **Modules** → enable **Reports**. (It's enabled by default for new facilities.)
- **Grant access:** role defaults cover manager-and-above automatically. To let a specific staff member read reports, grant them the **Reports → view** action in their permissions.
- **Branding:** set logo, header/footer text, and paper size under Admin Center → **Exports** — the PDF export picks these up automatically.
- **The nightly rollup runs itself.** It's a scheduled server job; there is nothing to start or babysit. If a facility's history ever needs recomputing (e.g. after correcting old records), operations can run an explicit backfill for a facility and date range — that's an on-demand maintenance action, not something the page needs.

---

## 8. Troubleshooting

| Symptom | What it means / what to do |
|---|---|
| **No Insights item in my sidebar** | Either the Reports module is off for the facility (Admin Center → Modules) or you don't hold the Reports view permission. Ask an administrator. |
| **"Not available" page when opening /insights** | Same two causes as above — the page tells you which. If it says your account isn't attached to a facility, an admin needs to fix your account. |
| **A module is missing from the picker** | That module is disabled for your facility. Only enabled modules can be reported on. |
| **"No activity recorded for this period."** | Genuine zero — nothing was submitted in that module for those dates. |
| **Amber "covers X of Y days" banner** | Some days in the period have no finalized rollup and are excluded from totals. Normal for periods reaching back before the facility went live on RinkReports. If it appears for recent days, tell your administrator — the nightly job may need attention. |
| **Today's numbers changed since I last looked** | Expected — today is computed live and moves as staff submit. It's finalized by tonight's rollup. |
| **No Export button** | You have view but not edit on Reports. An administrator can raise your Reports permission. |
| **PDF has no logo / wrong header text** | Set them in Admin Center → Exports, then export again. |
