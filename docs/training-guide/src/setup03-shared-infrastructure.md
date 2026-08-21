# 3. Shared Infrastructure

Several lists are shared across modules. Configure them once, early, and the module setup screens that follow will already have their pickers populated.

## 3.1 Departments

**Admin → Departments** groups shifts for the Employee Schedule's department filter and shift assignment (e.g. Ice Crew, Front Desk, Concessions). Per department: **Name**, **Slug** (auto-generated if blank), **Color**, **Sort order**. Reorder with the arrow buttons.

Deactivating is non-destructive — existing shifts keep their department; it just leaves the pickers for new assignments.

## 3.2 Facility Spaces

**Admin → Facility Spaces** is the shared list of physical areas feeding the location pickers in **Incident Reports, Accident Reports, and Air Quality**. Options:

- **Seed defaults** — a generic starter set: Main Rink, Lobby, Locker Room, Pro Shop, Parking Lot, Ice Surface, Bench, Concession, Boardroom, Other. Idempotent; never overwrites your edits.
- **Add space** individually (Name, Slug, Sort order).
- **Bulk import (CSV)** — columns `name[, slug][, sort_order]`; duplicates are skipped, never overwritten.

Once a space is referenced by reports, deletion is blocked ("Cannot delete; in use by N report(s)"). The habit to build: **deactivate, never delete**.

## 3.3 Lists

**Admin → Lists** holds per-facility option lists for dropdowns. Today that's the **Timezones** list — the IANA zones offered in the Facility settings picker. **Seed defaults** loads the canonical set; add manually only if you need an unusual zone (keys must be real IANA identifiers like `America/New_York`).

## 3.4 Facility Paperwork

**Admin → Facility Paperwork** (under Module Admin) is where you load the documents staff browse read-only — handbooks, emergency action plans, policies. **Bulk Upload**: pick a **Category** (Emergency Action Plan, Employee Handbook, Staff Manual, Policy Document, Safety Document, Other), select files (PDF, Office formats, text, images; 25 MB each — invalid files are rejected in the browser with a reason), optional shared description, **Upload documents**.

Per document you can later **Hide/Show** (takes it off the staff page without deleting — prefer this over Delete), **Edit**, or **Delete**.

Uploading here requires the explicit Admin Center grant, not just role-based console access — if you hit *"…not the facility admin permission required to manage documents"*, fix it in the Permissions matrix (super admin required).
