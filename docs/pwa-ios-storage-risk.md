# iOS Storage Eviction Risk — Offline Queue

**Question:** can iOS silently delete the offline submission queue if a
staffer doesn't open Rink Reports for a week?

**Short answer:** for the *installed* (home-screen) app — the deployment
model we're pushing staff toward — no, this is exempt from the 7-day rule.
For staff who keep using Rink Reports **in a Safari tab instead of
installing it**, yes: the 7-day cap applies and unsynced reports can be
lost. The pilot mitigation is "install the app, open it every shift."

## What the 7-day rule actually is

Safari's Intelligent Tracking Prevention (ITP) deletes all
**script-writable storage** for a website after **7 days of Safari use**
without the user interacting with that site. Script-writable storage
includes IndexedDB, `localStorage`, service worker registrations, and
Cache Storage. Two scope details matter for us:

1. The clock counts *days on which the person used Safari*, not calendar
   days — a phone left in a drawer accrues nothing.
2. **Home-screen web apps are exempt.** WebKit's announcement of the
   policy (March 2020) states that web apps added to the home screen get
   their own storage that is *not* subject to the 7-day cap, and since
   iOS 16.4 installed web apps run in an even more isolated container.
   Our service worker additionally calls `navigator.storage.persist()`
   on activate (best-effort; see `public/sw.js`).

Independent of ITP, iOS can still evict *any* site's storage under severe
device-storage pressure. Rare, but not zero.

## What eviction would destroy here

The offline queue lives in IndexedDB (`rink-offline-queue` database),
owned by the service worker. There is **no Dexie layer** — the SW's
IndexedDB store is the single and *only* copy of a report submitted
offline until it successfully replays to `/api/offline-sync`. Eviction
therefore means:

- **Unsynced reports are gone, silently.** Daily reports, incident and
  accident narratives queued offline are unrecoverable — they exist
  nowhere else.
- The service worker registration and shell caches are also purged. This
  is only an inconvenience (re-registers on next visit); the queue is the
  real loss.
- The offline schedule/forms caches (also IndexedDB) are wiped — again
  recoverable on next sync.

Login is *less* exposed than the queue: the Supabase auth cookies are
re-issued via server `Set-Cookie` on every request through `src/proxy.ts`,
and server-set cookies are not subject to the 7-day script-writable-storage
purge. A staffer might have to log in again in edge cases; that's
annoying, not data loss.

## Realistic worst case

A staffer works a shift with no signal, queues two incident reports in a
**Safari tab** (never installed the app), then goes on vacation while
using Safari daily for other browsing. Day 8, the queue is gone and nobody
is told. The same scenario in the **installed app** should survive.

This asymmetry is why the install guide and the in-app banner push
installation, and why the guide says "open the app at least once per
shift" and "don't delete the icon while reports are pending."

## Test plan (real iPhone, before pilot)

Use a real device — simulators don't reproduce ITP or standalone storage.
You need one iPhone you can leave alone for 8+ days (Test C), or two to
run tab-vs-installed in parallel.

**A. Queue survives normal lifecycle (installed app) — 15 min**
1. Install via Safari → Share → Add to Home Screen; log in.
2. Enable Airplane Mode. Submit a test daily report. Confirm the pending
   badge shows 1.
3. Force-quit the app (swipe away), reboot the phone, reopen from the
   icon *still in Airplane Mode*. Pending count must still be 1.
4. Disable Airplane Mode, reopen/foreground the app. The report should
   sync (pending returns to 0) and appear in the admin console.

**B. Same lifecycle in a Safari tab — 10 min**
Repeat A but never install; keep it as a Safari tab. Establishes the
baseline that queueing works in-tab before the soak.

**C. 7-day soak — 8+ calendar days, passive**
1. On the test phone: queue one unsynced test report in the **installed
   app** and (if using one phone for both) one in a **Safari tab**, both
   in Airplane Mode for that origin session; then leave the app/tab alone.
   Turn Airplane Mode off but do not visit the site in either form.
2. Use Safari daily on that phone for unrelated browsing (this is what
   advances the ITP clock — required for a valid test).
3. Day 8: check Settings → Safari → Advanced → Website Data for the
   app's domain (in-tab storage often disappears from this list when
   purged). Then open the Safari tab version: expected result under ITP
   is pending count 0 (queue purged) and possibly a fresh login. Open the
   installed app: expected result is pending count 1, report syncs.
4. Record actual behavior for both — Apple has changed ITP details
   between iOS versions, so trust the device over the documentation.

**D. Storage-pressure spot check (optional)**
Fill the phone near capacity (record 4K video), queue a report in the
installed app, leave it overnight, and confirm the queue survives.

**Pass criteria for pilot:** A and C-installed must pass. If C-installed
*fails* (queue lost in the installed app), stop and re-plan — that would
mean per-shift sync discipline is a hard requirement, and we should add a
"you have unsynced reports" re-engagement mechanism before rollout.
