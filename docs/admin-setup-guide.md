# RinkReports 5-6 — Admin Setup Guide

A practical, step-by-step guide for getting your ice facility operational with RinkReports. Written for facility managers setting up the system for the first time at **Tennity Ice Skating Pavilion** (the same steps apply to any facility).

> **Before you start:** You need Super Admin credentials. If you don't have them yet, contact whoever installed RinkReports — they create the initial Super Admin account directly in Supabase.

---

## 1. Log in as Super Admin

1. Open your RinkReports URL in a browser (Chrome or Edge recommended).
2. You will land on the **Login** page. If you go to a different page, you'll be bounced to `/login` automatically.
3. Enter your **Super Admin email and password**.
4. Click **Sign In**. You'll be redirected to `/dashboard`.

**If sign-in fails:**
- Check that you're using the email tied to your Super Admin record.
- Use **Forgot password?** to reset via email.
- If you see a "Forbidden" page after login, your account exists but isn't flagged as an admin yet — see Section 3.

---

## 2. Access the Admin Control Center

1. From the dashboard, click your name (top right) → **Admin**, or go directly to `/admin`.
2. The Admin Control Center is your home for everything in this guide. Modules include:
   - **Facilities** — facility info, areas, equipment
   - **Employees** — staff, roles, permissions
   - **Scheduling** — shifts and assignments
   - **Reports** — Daily, Incidents, Accidents, Ice Depth, Ice Operations, Refrigeration, Air Quality, Communications
   - **Retention** — data retention policies
   - **Exports** — CSV/PDF exports for compliance

> Only Super Admins, Admins, and GMs see the Admin Control Center. Regular staff are redirected to `/forbidden` if they try to open it.

---

## 3. Set Facility Information

Set this up **first** — almost everything else (employees, reports, scheduling) is scoped to a facility.

1. In the Admin Control Center, open **Facilities**.
2. Click **+ New Facility** (or open the existing record if RinkReports created one during install).
3. Fill in:
   - **Name:** `Tennity Ice Skating Pavilion`
   - **Address, City, State, ZIP**
   - **Time Zone:** select your local zone (this drives report timestamps)
   - **Contact phone / email**
   - **Operating hours** (per day of week)
4. Add **Areas** — the physical zones inside the facility (each becomes a slug used in report URLs):
   - `main-rink`
   - `studio-rink` (if applicable)
   - `locker-rooms`
   - `mechanical-room`
   - `lobby`
   - `pro-shop`
5. Click **Save**. The facility now appears in the dropdown at the top of the admin shell.

> **Tip:** Set the facility's time zone before staff start submitting reports. Changing it later will shift the displayed timestamps on historical reports.

---

## 4. Create Roles and Permissions

RinkReports ships with a role-based permission model. Roles control **what someone can see and do**; permissions are attached to roles, not individuals.

### Built-in roles

| Role key | Typical title | Sees Admin Center? |
|---|---|---|
| `super_admin` | Owner / IT lead | Yes |
| `admin` | Facility Director | Yes |
| `gm` | General Manager | Yes |
| `supervisor` | Shift Supervisor | No (sees Reports + Scheduling) |
| `staff` | Rink Attendant / Skate Guard | No (submits reports only) |

### Adjust permissions

1. Open **Admin → Employees → Roles**.
2. Click a role to open its permission matrix.
3. Toggle module permissions per role. Common starting points:
   - **Staff:** can *submit* Daily, Incidents, Ice Depth. Cannot view others' reports.
   - **Supervisor:** can *view* all reports for their facility, can *edit* same-day submissions.
   - **Admin / GM:** full read/write on all modules for their facility.
4. Click **Save**.

### Create a custom role (optional)

1. **Roles → + New Role**.
2. Give it a `key` (lowercase, no spaces — e.g. `ice_tech`) and a display name.
3. Set permissions, save.

> Permissions are enforced both in the UI and at the database (Row-Level Security). A staff member cannot bypass the UI to view another facility's data.

---

## 5. Configure the Ten Daily Report Tabs

The Daily Report is what most staff will touch every shift. Configure the ten tabs once for Tennity, and they apply to every daily submission going forward.

1. Open **Admin → Reports → Daily → Templates**.
2. Select the **Tennity Ice Skating Pavilion** facility from the top filter.
3. You'll see ten tabs. Configure each one in order:

   1. **Opening Checklist** — doors unlocked, lights on, restrooms cleaned, lobby walk-through.
   2. **Ice Conditions** — ice surface check, edge condition, debris, photo upload.
   3. **Ice Depth** — depth readings at predefined points (add the points under the **Ice Depth** module first).
   4. **Refrigeration** — brine temp, header pressure, compressor run hours, ammonia alarm test.
   5. **Air Quality** — CO and NO₂ readings (set thresholds that trigger an alert).
   6. **Resurfacer Log** — flood times, water temp, blade condition, fuel/charge level.
   7. **Locker Rooms & Restrooms** — cleaned, restocked, damage noted.
   8. **Pro Shop / Skate Rental** — inventory snapshot, sharpening log.
   9. **Public Skate & Programs** — attendance counts per session, incidents flag.
   10. **Closing Checklist** — ice covered, doors locked, alarm armed, lights off, equipment shut down.

4. For each tab:
   - Click **Edit Fields**.
   - Add the questions/fields you want staff to answer (text, number, yes/no, photo, signature).
   - Mark required fields with the red asterisk toggle.
   - Set **threshold alerts** where applicable (e.g. ice depth < 1.0" pages the GM).
5. Click **Publish Template**. The new layout is live for the next submission.

> **Tip:** Keep required fields to the minimum that satisfies your insurance/health-dept requirements. Staff abandon long forms — every extra field is a missed entry on a busy Saturday.

---

## 6. Add Staff Members

1. Open **Admin → Employees → + Add Employee**.
2. Fill in:
   - **Full name**
   - **Email** (this is their login)
   - **Phone**
   - **Facility:** Tennity Ice Skating Pavilion
   - **Role:** pick from Section 4
   - **Start date**
   - **Active:** yes
3. Click **Send Invite**. The staff member receives an email with a link to set their password.
4. After they accept, their row shows **Active** with a green dot.

### Bulk add

For a full roster, use **Employees → Import CSV**. Required columns: `email, full_name, role_key, phone`. Each row triggers an invite email.

### Day-one checklist for new staff

- [ ] Account created and invite accepted
- [ ] Role assigned (and verified — try logging in as them in an incognito window if unsure)
- [ ] Added to at least one scheduled shift in **Scheduling**
- [ ] Walked through submitting one Daily Report on their phone (it's a PWA — they can "Add to Home Screen")

---

## You're Operational

At this point Tennity Ice Skating Pavilion has:

- A configured facility with areas and hours
- A role/permission model that matches your org chart
- A ten-tab Daily Report template tailored to your operation
- Staff accounts that can log in and submit reports — including offline, since RinkReports queues submissions in the service worker and syncs when the connection returns

### Where to go next

- **Scheduling** — build recurring shift patterns so the Daily Report knows who's on the floor.
- **Retention** — set how long submissions, photos, and exports are kept (defaults are conservative; check with your insurer).
- **Exports** — schedule a monthly CSV/PDF export for compliance and insurance.
- **Incidents / Accidents** — review the templates; these are the reports your insurer will actually ask for.

### Getting help

- Forgot your Super Admin password? Use the **Forgot password?** link on `/login`.
- Locked out entirely? Whoever has Supabase access can re-flag your user as Super Admin in the `users` table (`is_super_admin = true`).
- Bug or feature request? Open an issue on the project's GitHub repo.
