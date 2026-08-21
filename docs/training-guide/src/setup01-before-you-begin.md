# 1. Before You Begin

## 1.1 What this guide covers

This guide walks an administrator through standing up Rink Reports for a single facility, from an empty tenant to staff submitting reports — in the order the pieces depend on each other. It covers creating the facility, provisioning people and permissions, the shared infrastructure every module borrows, per-module configuration (including the Rink Scheduling & Billing module), communications routing, and the system settings you should confirm before go-live.

Everything in Rink Reports is **facility-scoped**: each facility gets its own roles, employees, permissions, module configuration, option lists, and data. Setting up a second facility means repeating this process in that facility's context — nothing configured here leaks across tenants.

## 1.2 Who does what

Two levels of administrator split the setup work:

| Task | Who |
|---|---|
| Create the facility record (name, slug, timezone, address) | Super admin |
| Activate/deactivate facilities | Super admin |
| Grant Admin Center access and assign admin-tier roles | Super admin |
| Everything else — people, permissions, module configuration | Facility admin |

A **facility admin** is anyone holding the Admin Center permission (the Admin module's Admin action) for the facility. A **super admin** is a platform-level flag that bypasses module permissions and can work across facilities via the `?facility=` switcher on the admin dashboard.

Module consoles need one more grant: the *module's own* Admin action. Console access alone opens the sidebar but not, say, Refrigeration Admin — if a save fails with *"Your account has admin console access but not the module's admin permission,"* that's the missing grant, fixed in Admin → Permissions.

## 1.3 The setup sequence

Dependencies dictate the order. Follow it and you'll never configure a screen whose prerequisites don't exist yet:

1. **Facility** — a super admin creates the record; canonical roles are seeded automatically.
2. **First admin** — create the admin employee, invite them, grant Admin Center access.
3. **Module visibility** — decide which modules this facility uses (Admin → Modules).
4. **Shared infrastructure** — departments, facility spaces, option lists.
5. **People** — roles and permission defaults, then the staff roster (bulk add), then invites.
6. **Per-module configuration** — each module's setup tab, seeded where a seed button exists.
7. **Scheduling** — settings, job areas and certifications, compliance rules.
8. **Rink Scheduling & Billing** — surfaces, rate cards, customers, displays.
9. **Communications** — groups, templates, routing rules, reminders.
10. **System** — export branding, retention windows, and the go-live checks.

The **admin dashboard's setup checklist** tracks the first stretch of this automatically — six steps (facility info, roles seeded, role defaults, first admin linked, staff added, invites sent) with a "Ready" badge when complete. Start every setup session there.

## 1.4 Seed buttons: use them

Nearly every module ships a **Seed defaults** button on its empty state. Seeding is idempotent — safe to run more than once, and it never overwrites edits you've already made. Always seed first, then adjust, rather than building lists from scratch. This guide notes what each seed creates.

## 1.5 A note on timezones

Set the facility's timezone correctly on day one and never think about it again: every timestamp staff see, every schedule, every cron-driven digest is rendered in facility-local time from that one setting. The facility form derives the timezone from the zip code automatically — override it only if the rink sits on a timezone boundary.
