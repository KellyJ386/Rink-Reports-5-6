# E2E Test Plan — Coverage Map

Every requested scenario mapped to the spec/test that covers it. Legend:
**✅ full** = asserted directly · **🟡 partial** = asserted with a graceful
skip/`fixme` when seed data is absent (search `TODO(seed)`) · the test still
exists and runs when its prerequisite env/seed is present.

## 1. Authentication — `01-authentication.spec.ts`
| Scenario | Coverage |
| --- | --- |
| Each user can log in | ✅ (parameterized over all 7 roles) |
| Each user lands on correct dashboard | ✅ (`expectedLandingPath`) |
| Inactive users cannot log in | 🟡 (`E2E_INACTIVE_*`) |
| Invalid passwords fail safely | ✅ (asserts error alert, no redirect) |

## 2. Role permissions — `02-role-permissions.spec.ts`
| Scenario | Coverage |
| --- | --- |
| Staff cannot access Admin routes | ✅ (each staff role → `/forbidden`) |
| Managers can review but not edit original submissions | 🟡 (review reachable; edit controls absent) |
| Admins can configure modules | ✅ (admin reaches `/admin/modules`) |
| Employees only see department modules | 🟡 (assigned reachable, ≥1 unassigned denied) |
| Users cannot access another facility's data | → covered in section 9 |

## 3. Daily Reports — `03-daily-reports.spec.ts`
| Scenario | Coverage |
| --- | --- |
| Assigned users can submit | 🟡 (`E2E_DAILY_REPORT_PATH` or area/template pick) |
| Submit with unchecked items | 🟡 |
| Multiple reports per day allowed | 🟡 |
| Submitted reports appear in history | ✅ (history page) |
| Staff cannot edit submitted reports | ✅ (no edit control / immutability) |

## 4. Ice Operations — `04-ice-operations.spec.ts`
| Scenario | Coverage |
| --- | --- |
| Ice Make submits | 🟡 (`ice_make` route) |
| Circle Check pass/fail items | 🟡 |
| Failed items require notes | ✅ (submit disabled / error until note added) |
| Failed items trigger Communications alert | 🟡 `TODO(seed)` (done-page failed badge asserted) |
| End-of-day PDF can be generated | 🟡 |

## 5. Incident & Accident — `05-incidents-accidents.spec.ts`
| Scenario | Coverage |
| --- | --- |
| Required fields enforced | ✅ (submit blocked w/ empty required) |
| Submits when required completed | 🟡 |
| Accident body diagram works | ✅ (diagram interaction) |
| Medical attention triggers alert | ✅ (alert banner on select) |
| Accident editable 24h only | 🟡 (edit window banner / read-only state) |
| Follow-up notes timestamped | 🟡 `TODO(seed)` |
| No photo upload available | ✅ (asserts zero file inputs) |

## 6. Refrigeration & Air Quality — `06-refrigeration-air-quality.spec.ts`
| Scenario | Coverage |
| --- | --- |
| OOR triggers alerts when enabled | 🟡 (alert banner present) |
| OOR does not trigger when disabled | 🟡 (banner absent) |
| Incomplete reports allowed if module allows | 🟡 |
| History filters work | ✅ (admin history filter UI) |

## 7. Ice Depth — `07-ice-depth.spec.ts`
| Scenario | Coverage |
| --- | --- |
| Select layout | 🟡 |
| Enter readings point by point | 🟡 (popover per point) |
| Enter key advances to next point | ✅ (keyboard) |
| Threshold colors display | ✅ (severity labels Optimal/Below min/Above target) |
| PDF & Excel export work | 🟡 (download triggers) |
| Email sends only to configured recipients | 🟡 `TODO(seed)` |

## 8. Admin Control Center — `08-admin-control-center.spec.ts`
| Scenario | Coverage |
| --- | --- |
| Create/edit templates | 🟡 (daily-reports Templates tab) |
| Assign module access | ✅ (permissions matrix reachable) |
| Activate/deactivate employees | ✅ (Deactivate/Reactivate controls) |
| Configure thresholds | ✅ (refrigeration/ice-depth Settings) |
| Configure PDF/export settings | 🟡 (exports/settings reachable) |
| Non-admins cannot access | ✅ (parameterized → `/forbidden`) |

## 9. Multi-tenant security — `09-multi-tenant-security.spec.ts`
| Scenario | Coverage |
| --- | --- |
| Two test facilities | 🟡 (uses Facility A users + `E2E_FACILITY_B_*`) |
| Facility A cannot see Facility B data | 🟡 |
| Direct URL access to B's reports denied | 🟡 (`E2E_FACILITY_B_REPORT_PATH`) |
| API requests denied by RLS | ✅ (direct fetch returns empty/denied) |

## 10. Quality checks — `10-quality-checks.spec.ts`
| Scenario | Coverage |
| --- | --- |
| No console errors | ✅ (console guard across key pages) |
| No broken pages | ✅ (smoke-crawl key routes, assert 2xx + no error UI) |
| Mobile layout works | ✅ (`mobile-chrome` project / @mobile) |
| Forms preserve data during navigation | ✅ (fill → back/forward → values retained) |
| Error messages are clear | ✅ (invalid login surfaces readable alert) |
| Screenshots saved for failed tests | ✅ (config `screenshot: only-on-failure` + reporter) |

## 13. Scheduling — `13-scheduling.spec.ts`

The largest module in the app, previously uncovered.

| Scenario | Covered by |
| --- | --- |
| Landing dashboard renders with all five quick links | `landing page renders the schedule dashboard and its quick links` |
| My Schedule opens (shifts or honest empty state) | `my schedule opens and offers the calendar feed` |
| Time-off page lists requests and exposes the form | `time off lists past requests and exposes the request form` |
| Availability editor renders | `availability page renders the weekly editor` |
| Swaps page separates outgoing from incoming | `swaps page separates outgoing from incoming requests` |
| Notifications render; acknowledging stays explicit | `notifications page renders without a crash and marks nothing by accident` |
| Claim / drop affordances present and enabled | `open-shift claim and shift drop are offered but not driven here` |
| All eleven admin sub-consoles render for admin | `admin scheduling sub-pages all render` |

**Not covered, deliberately.** `scheduling_claim_open_shift`,
`scheduling_request_shift_drop`, and `scheduling_cancel_shift_drop` are
online-only RPCs that re-validate ownership, certs, hour caps, and publish
state at execution time, and they mutate a published schedule other people
depend on. Driving them needs a disposable seeded facility. Same for the admin
grid's drag-create/edit/delete writes.

## 14. Communications — `14-communications.spec.ts`

Owns the notification and email pipeline; previously uncovered.

| Scenario | Covered by |
| --- | --- |
| Inbox renders with alerts and messages tabs | `inbox renders with its alerts and messages tabs` |
| Tab switch changes the view, not just the URL | `switching to the messages tab changes the view, not just the URL` |
| Alert drilldown opens; ack stays an explicit action | `an alert drilldown opens and shows its acknowledge affordance when required` |
| Compose rejects an empty body | `compose validates a required body before sending` |
| Compose sends and reaches the done screen | `compose sends a message and lands on the done screen` |
| All eight admin tabs render | `every admin tab renders` |
| Staff denied the admin console | `staff are denied the communications admin console` |

**Not covered, deliberately.** The admin Broadcast tab is loaded but never
submitted — sending queues real email to real staff, which a test suite should
not do against a shared environment.

## 15. Rink Scheduling & Billing — `15-rink-scheduling.spec.ts`

The most money-critical module in the app; previously the only major one with
no browser coverage.

All scheduling writes live on the admin surface (`/admin/rink-scheduling/schedule`);
the dashboard calendar (`/reports/rink-scheduling`) is read-only for every account.

| Scenario | Covered by |
| --- | --- |
| Calendar renders; all four views reachable | `calendar renders with all four views reachable` |
| Dashboard calendar shows no edit affordance for ANY account | `dashboard calendar is read-only for every account` |
| Edit affordances gate as a set, seed-independently | `edit-tier affordances gate together, not piecemeal` |
| View-tier denied every money page at the route | `money pages deny a non-edit account by rendering the gate, not data` |
| Front Desk renders at view tier | `front desk view is view-tier and renders` |
| Agenda offers the printed daily schedule | `agenda view offers the print button` |
| Dashboard widget renders read-only with freshness stamp | `dashboard shows the read-only ice schedule widget` |
| Admin schedule surface: edit tools + money links | `admin schedule shows the edit surface and the money links` |
| Booking sheet opens/closes without writing | `booking sheet opens from an admin slot and closes without writing` |
| Invoices/Insights/Requests/Contracts render for edit tier | `money pages render for an edit-tier account` |
| Config tabs + admin schedule route all render | `admin console tabs all render` |

**Not covered, deliberately.** Creating, moving, or cancelling a booking, and
every invoice/payment write: the overlap exclusion constraint means a test
booking collides with (or blocks) real ice on a shared environment, and
billing rows are append-only. Driving those flows needs a disposable seeded
facility. Opening the booking sheet is the one interaction driven — it only
reads (the rate preview); nothing is written until "Create booking", which
the spec never clicks.
