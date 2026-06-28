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
