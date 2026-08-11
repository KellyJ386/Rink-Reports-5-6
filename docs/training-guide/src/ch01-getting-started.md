# 1. Welcome & Getting Started

## 1.1 What is Rink Reports?

Rink Reports is your facility's operations platform. It replaces paper logbooks, clipboards, and whiteboards with one app that runs on any phone, tablet, or computer — and keeps working when the rink's Wi-Fi doesn't. Staff use it to submit operational reports (daily checklists, ice depth readings, refrigeration rounds, air-quality logs, incident and accident reports, and more), manage their work schedule, and receive facility communications. Administrators use the Admin Center to configure every module, review submissions, manage employees and permissions, and publish schedules.

Everything in the app is scoped to your **facility**: you only ever see your own rink's data, and every timestamp you see is shown in your facility's local time zone.

## 1.2 Signing in

- There is **no self-signup**. Accounts are created by an administrator in the admin console. If you don't have a login, ask your manager.
- Go to the app's address and sign in with your email and password at the **/login** page. Password resets go through an emailed reset link (the **update-password** flow).
- If you're signed in but see **"Account not ready — Your account is being set up"**, your login exists but your employee record hasn't been activated yet. Contact your administrator.
- If a page says **"No permission"** or you land on a **Forbidden** page, your account works but you haven't been granted access to that module. That's a permissions question for your admin, not a bug.

## 1.3 Finding your way around

**Desktop (large screens).** A left sidebar lists every module your facility has enabled, in this order: Dashboard, Daily Reports, Ice Depth, Ice Operations, Dasher Boards, Refrigeration, Air Quality, Incidents, Accidents, Scheduling, Communications, Facility Paperwork. Admins also see an **Admin Center** entry below a divider. The Communications and Scheduling items show a red badge with your unread count.

**Mobile (phones).** A bottom tab bar gives you four tabs: **Home** (the dashboard), **Reports** (jumps to the first report module your facility has enabled), **Menu** (opens the full module list), and **Account**.

**The header (always visible).** Shows your name, your facility, a live date and clock, and the current outdoor temperature for your facility's location (this is the weather outside — not an ice or building temperature). On the right: the **sync status badge** (see chapter 4 on offline work), a **light/dark theme toggle**, and your user menu with **My Account** and **Sign out**.

> Modules your facility hasn't enabled simply don't appear — no tile, no sidebar entry. If a module you expect is missing, your facility admin has it turned off or you don't have permission to view it.

## 1.4 The Dashboard

The dashboard is your home screen: a grid of large, color-coded tiles, one per module, under a greeting ("Hi, {your name}").

**Status bubbles.** Tiles carry a small red or green "monitoring light" so you can see at a glance whether a module needs attention. What red means per module:

| Module | Red bubble means |
|---|---|
| Refrigeration | The latest report had a reading out of range |
| Air Quality | The latest report recorded an exceedance |
| Ice Operations | The latest submission had a failed circle-check item |
| Ice Depth | The latest session tripped the facility's low/high alert setting |
| Incidents | Reports are waiting for admin review (with a count) |
| Accidents | An accident was submitted in the last 2 days |
| Communications | You have unread messages or unacknowledged alerts |
| Scheduling | You have unread notifications or there are open shifts |
| Dasher Boards | Open safety-critical (severity A) issues or failed checks |

These lights come from thresholds your administrators configured — the app never uses hardcoded limits.

**Personalizing your dashboard.** Every tile has an "×" in its corner: hiding a tile removes it *from your dashboard only*. It doesn't change your permissions, and the module stays reachable from the sidebar. Hidden tiles collect at the bottom of the page as "+" pills — tap one to restore it.

**My areas today.** If your facility uses daily-report area assignments, a widget at the top shows how many of your assigned areas are complete today and which one is next up.

## 1.5 Your account settings

Open **My Account** from the header menu (or the Account tab on mobile). You can edit:

- **Contact** — email and phone number (phone is required).
- **Mailing address** — street, city, state, postal code, country.
- **Emergency contact** — name and phone.
- **Notifications** — a single master switch: "Receive text message notifications." Turning it off stops all SMS to you.

The **Save Changes** button only lights up once you've changed something.

**Changing your email** is a two-step process: the app sends a confirmation link to your *new* address, and your old email keeps working until you click it. An amber notice reminds you while the change is pending.

A few things people look for here that live elsewhere: **password changes** go through the emailed reset flow, the **light/dark theme** toggle is in the header, your **calendar sync link** is in Scheduling → My schedule, and **dashboard tile hiding** is done on the dashboard itself.

## 1.6 Roles and permissions in one minute

- Your access is granted **per module and per action** (view, submit, edit, admin) by your facility's administrators. Roles (staff, manager, admin, plus custom roles your facility defines) mainly seed sensible defaults — the actual source of truth is the permission grants.
- Some modules also scope access **per area** (for example, which daily-report work areas you can submit for).
- **Admins** see the Admin Center. Some admin modules additionally require a *module-scoped* admin grant (for example, scheduling administration) — so an admin can be given the console without every module in it.
- **Super admins** manage facility-level settings that ordinary admins can't touch.

If you can see a module but a button you expect is missing or disabled, that's almost always a permission tier — ask your admin rather than retrying.
