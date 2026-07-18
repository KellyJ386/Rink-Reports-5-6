# Device / PWA QA checklist (pre-launch)

Human-run pass on real hardware before go-live (Day 13 of the launch plan).
Run once on a phone (iOS Safari + Android Chrome) and once on the rink-office
kiosk/tablet profile. Check items off per device.

## Setup

- [ ] Install the PWA from the browser ("Add to Home Screen" / install prompt);
      icon, name, and splash render correctly; app opens standalone (no URL bar).
- [ ] Sign in as a staff (non-admin) test user at the production URL.

## Offline round-trip (each of the 9 staff modules)

For each module: go offline (airplane mode), fill + submit, confirm the
"offline — saved on this device" state, go online, confirm auto-replay and
that the submission appears in the matching admin view with correct values.

- [ ] Daily report (checklist + note)
- [ ] Incident report (witnesses + spaces)
- [ ] Accident report (body diagram + witnesses)
- [ ] Refrigeration log (°F/°C toggle, out-of-range + corrective note)
- [ ] Air quality (readings incl. one exceedance → severity badge + alert)
- [ ] Ice depth (tap points, review phase, explicit Send)
- [ ] Ice operations
- [ ] Communications compose
- [ ] Scheduling: availability + time-off request (shift claiming is
      intentionally online-only — verify it says so when offline)

Queue behaviors:

- [ ] `/reports/offline-queue` shows pending items with per-item status while
      offline, and per-item errors after a forced server failure.
- [ ] Double-submit while offline produces two queue entries (not an
      overwrite); replay lands two rows.
- [ ] Killing and reopening the PWA while offline preserves the queue.

## Area assignment routing (daily reports; run with the facility flag ON)

- [ ] `/reports/daily` lands on "My Areas Today"; assigned cards open the
      checklist; "Open areas" collapses/expands; unassigned staff see the
      "No areas assigned — open areas below" empty state.
- [ ] Open `/reports/daily` once online, then airplane mode → `/offline-daily`
      renders the cached areas with the offline banner; after the facility's
      midnight the same cache shows the "previous day" notice instead.
- [ ] Airplane mode on the supervisor board: Assign/Reassign/Open-up are
      disabled with the "changes need a connection" notice (nothing queues).
- [ ] Stale-assignment rejection: queue a daily submission offline, have a
      supervisor reassign that area away, reconnect → the item parks in
      `/reports/offline-queue` as "won't retry" with the assignment-changed
      message (not silently dropped, not endlessly retried).
- [ ] Turn the facility flag OFF (Admin → Daily Reports → Assignments) →
      staff landing reverts to the classic console; widget disappears.

## Long-form guards

- [ ] Refrigeration: enter a reading, try to close the tab / pull-to-refresh →
      browser warns. Submit, then close → no warning.
- [ ] Accidents: same check (any incident detail entered arms the warning).

## Dark-mode sweep

Toggle dark mode (in-app ThemeToggle AND OS-level with `rr-theme` cleared):

- [ ] Staff shell, dashboard, all 9 report forms (fields, hints, banners)
- [ ] Accident body diagram (base/hover/selected fills adapt — no hardcoded
      blue/red remnants)
- [ ] Admin shell + each admin module incl. loading skeletons and the
      Communications → Deliveries tab
- [ ] Error boundaries (force one via a bad URL or dev-thrown error)

## Kiosk / shared-device behavior

- [ ] Logout returns to /login and back-button cannot re-open authed pages
      (network-only navigation — nothing served from cache).
- [ ] Second user signs in on the same device and sees only their own data.
- [ ] A deploy while the app is open shows the update toast; reloading
      mid-queue does NOT lose queued submissions.

## Notifications end-to-end (with production env, post-deploy)

- [ ] Submit a report matching a routing rule → email arrives with PDF;
      `communication_recipients.email_status = 'sent'`.
- [ ] Force a failure (bad recipient address) → row reaches `failed` after
      the backoff ladder → appears in Communications → Deliveries → manual
      Retry re-queues it.

Sign-off: ______________  Date: ______________  Devices: ______________
