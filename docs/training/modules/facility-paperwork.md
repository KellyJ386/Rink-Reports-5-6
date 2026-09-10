# Facility Paperwork

*RinkReports training guide — Facility Paperwork module*

---

## 1. What this module is for

**Facility Paperwork** is a read-only document library for staff. Admins upload the facility's own policies, handbooks, and manuals — an Emergency Action Plan, an employee handbook, a safety document, whatever the facility needs everyone to be able to find — and staff browse and download them from their phone or tablet. It replaces a binder at the front desk or an email attachment that goes stale.

There is no submission workflow here — staff don't create anything in this module, they only read. Everything staff see is uploaded and organized by an admin.

> **You only see data for your own facility — this is automatic.** There's no facility switcher, and you can't see another rink's documents.

> **Don't confuse this with the built-in Training &amp; Documentation.** The Rink Reports training manuals, onboarding guides, and PDFs (this document included) ship with the app itself, under **Admin → System → Training &amp; Docs**. Facility Paperwork is for *your* facility's own documents — the ones only your staff need, that nobody at Anthropic or the app's maintainers ever sees.

---

## 2. Who can use it

Access is **permission-driven**, not strictly tied to a job title.

| Tier | Browse &amp; download documents | Upload / manage documents |
|---|---|---|
| **super_admin** | Yes | Yes, for any facility (picks one first if more than one exists) |
| **facility_manager** (the `admin` role) | Yes | Yes, for their own facility |
| **supervisor** / **staff** | Yes, if they have an active employee account | No |

Notes that hold true in code:

- Any signed-in, active employee can open the staff Facility Paperwork page and see their facility's documents — there is no separate `submit`/`view` permission gate for browsing, unlike most other modules.
- Managing documents (upload, edit, hide, delete) requires the **facility admin** permission specifically — the module's own `admin/admin` action — not just general Admin Center access. An admin whose account has admin-console access but lacks that specific grant sees: *"Your account has admin console access but not the facility admin permission required to manage documents. Ask an administrator to grant it under Admin → Permissions."*
- A **deactivated** account is denied everywhere.

---

## 3. How to get there

**Staff (browsing documents):**

- In the sidebar (or the mobile **Menu** tab), choose **Facility Paperwork**. The address is `/reports/facility-paperwork`.

**Admins (managing documents):**

- Open the **Admin Center**, then choose **Facility Paperwork** under **Module Admin**. The address is `/admin/facility-documents`.
- A super admin who hasn't chosen a facility yet is shown a facility picker first (or is sent straight through if there's only one facility).

---

## 4. Setup &amp; configuration (admins)

There are no tabs — the whole admin screen is one page: a **Bulk Upload** card at the top and the document list below it.

### Bulk Upload

- **Category** (required) — one of six fixed categories: Emergency Action Plan, Employee Handbook, Staff Manual, Policy Document, Safety Document, or Other. Every file in one upload batch shares the category you pick.
- **Description** (optional) — applied to every file in this upload.
- **Files** — choose one or more files at once. Accepted types: PDF, Word (`.doc`/`.docx`), Excel (`.xls`/`.xlsx`), PowerPoint (`.ppt`/`.pptx`), plain text, CSV, RTF, and common image formats (PNG, JPG, GIF, WEBP). Each file is capped at **25 MB**.
- Each file's **title** defaults to its filename (underscores/hyphens turned into spaces); rename it afterward from the document list if you want something friendlier.
- If some files in a batch fail (wrong type, too large, a name collision) and others succeed, the upload still completes for the ones that worked and reports which ones didn't, rather than failing the whole batch.

### The document list

- Documents are grouped by category, in the same fixed order as the category dropdown.
- Each row shows the title, file type/size, and (if set) the description, with **Edit**, **Deactivate**, and **Delete** actions.
- **Edit** lets you change the title, category, and description — not the underlying file. To replace a file's contents, delete it and upload the new one.
- **Deactivate** hides a document from staff without deleting it (it stays in the admin list, greyed out, and can be reactivated). **Delete** permanently removes the document record and its stored file.

---

## 5. Screen-by-screen walkthrough

### Staff — Facility Paperwork (`/reports/facility-paperwork`)

A **Filter by Category** dropdown narrows the list to one category (only categories that actually have documents appear as options); "All Categories" is the default. Documents render as a grid of cards, each showing the title, category + file size, an optional description (truncated to three lines), and a **Download** link. Download links are short-lived signed URLs generated fresh each time the page loads — they aren't permanent links you can bookmark or share.

If the facility hasn't uploaded anything yet, staff see "No documents available." If a filter matches nothing, they see "No documents in this category."

### Admin — Facility Paperwork (`/admin/facility-documents`)

One page: the Bulk Upload card, then the categorized document list described in §4. A card at the top links out to the in-app **Training &amp; Docs** area as a reminder that the built-in Rink Reports manuals don't need to be re-uploaded here.

---

## 6. Step-by-step: common tasks

**Upload your Emergency Action Plan (admin).**

1. Go to **Admin → Facility Paperwork**.
2. In Bulk Upload, choose **Emergency Action Plan** as the category.
3. Choose the file (PDF works well) and, optionally, add a description.
4. Click **Upload**. The document appears in the list below immediately.

**Find a document (staff).**

1. Open **Facility Paperwork** from the menu.
2. Optionally filter by category.
3. Tap **Download** on the document you need.

**Retire an outdated policy without losing the history (admin).**

1. Find the document in the list.
2. Click **Deactivate** rather than **Delete** — staff stop seeing it, but you can still find and reactivate it later if you need to reference the old version.

---

## 7. Field reference

| Field | Notes |
|---|---|
| Category | One of: Emergency Action Plan, Employee Handbook, Staff Manual, Policy Document, Safety Document, Other. Fixed list — not facility-configurable. |
| Title | Defaults from the filename; editable afterward. Max 200 characters. |
| Description | Optional, shown to staff under the title. |
| File | Max 25 MB. Allowed types: PDF, DOC/DOCX, XLS/XLSX, PPT/PPTX, TXT, CSV, RTF, PNG, JPG/JPEG, GIF, WEBP. |
| Active | On by default. Deactivating hides a document from staff without deleting it. |

---

## 8. Locking, saving &amp; offline

- There is no draft/lock concept here — an upload either succeeds or reports which files failed, immediately.
- ⚠ VERIFY — this module does not appear to use the offline submission queue described in the app's PWA architecture (there's nothing for staff to submit; browsing and downloading a document both require a live connection to fetch the file and its signed URL). Treat "download it while you have signal" as the practical guidance for staff working somewhere with unreliable wifi.

---

## 9. Troubleshooting &amp; FAQ

**I don't see Facility Paperwork in my menu.** Your facility has turned the module off, or your employee account isn't active yet. Ask your admin.

**A document won't download / the link says "Unavailable."** Download links expire after a short time. Refresh the page to get a fresh link.

**I'm an admin but I can't upload anything.** You have general Admin Center access but not the specific facility-admin permission this module requires. Ask a super admin or another facility admin to grant it under **Admin → Permissions**.

**I uploaded the wrong file.** Delete the document and upload the correct one — there's no in-place file replacement, only title/category/description edits.

**Can staff upload anything here?** No. This module is admin-managed only; staff have read/download access exclusively.

---

## Source (footnote)

This chapter was written against the following files (not from memory): `src/app/admin/facility-documents/{page.tsx,actions.ts,types.ts}`, `src/app/admin/facility-documents/_components/facility-documents-client.tsx`, `src/app/reports/facility-paperwork/page.tsx`, `src/app/reports/facility-paperwork/_components/documents-browser.tsx`, and the shared helpers in `src/lib/facility-documents.ts`.
