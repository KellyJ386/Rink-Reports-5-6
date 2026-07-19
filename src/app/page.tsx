import Image from "next/image"
import Link from "next/link"
import { redirect } from "next/navigation"

import { getCurrentUser } from "@/lib/auth"
import { RequestInformationButton } from "@/components/splash/request-information"

// Shared button styles for the splash page CTAs.
const SIGN_IN_BUTTON_STYLE = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 10,
  padding: "17px 36px",
  borderRadius: 10,
  background: "linear-gradient(180deg, #3FA0FF 0%, #0066CC 100%)",
  color: "#ffffff",
  fontWeight: 700,
  fontSize: 17,
  textDecoration: "none",
  boxShadow: "0 2px 0 0 #004A99, 0 4px 16px rgba(0,102,204,0.32)",
  letterSpacing: "0.01em",
  minHeight: 56,
} as const

const SIGN_IN_BUTTON_NAV_STYLE = {
  ...SIGN_IN_BUTTON_STYLE,
  padding: "11px 22px",
  fontSize: 15,
  minHeight: 0,
}

// ── Module definitions ────────────────────────────────────────────────────────

const MODULES = [
  {
    key: "daily",
    title: "Daily Reports",
    desc: "Submit daily checklists for every area of your facility.",
    icon: '<path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/><rect width="6" height="4" x="9" y="3" rx="1" ry="1"/><path d="M9 12h6"/><path d="M9 16h4"/>',
    bullets: [
      "Up to 20 admin-configurable tabs, one for every area of your facility",
      "Each tab saves independently — no waiting on other departments to finish",
      "Reports lock and submit at end of day for a clean, tamper-proof record",
      "Full historical archive with PDF export",
    ],
  },
  {
    key: "incidents",
    title: "Incident Reports",
    desc: "Report on-ice incidents and unusual occurrences in real time.",
    icon: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><circle cx="12" cy="17" r="1"/>',
    bullets: [
      "Document on-ice incidents and unusual occurrences in real time",
      "Interactive body diagram for precise injury location",
      "Photo uploads and witness statements attached to every report",
      "Trend tracking to spot recurring problem areas",
    ],
  },
  {
    key: "refrig",
    title: "Refrigeration Plant",
    desc: "Track compressor readings, system temps, and alarms.",
    icon: '<path d="M14 4v10.54a4 4 0 1 1-4 0V4a2 2 0 0 1 4 0z"/>',
    bullets: [
      "Compressor count and readings-per-shift configured by your admin, not hardcoded",
      "Log suction, discharge, and oil pressure, amps, oil temp, and brine supply/return/flow",
      "Normal operating ranges displayed inline as staff enter readings",
      "Complete compliance history, audit-ready at any time",
    ],
  },
  {
    key: "air",
    title: "Air Quality Monitoring",
    desc: "Monitor CO, NO₂, and ventilation across all ice surfaces.",
    icon: '<path d="M17.7 7.7a2.5 2.5 0 1 1 1.8 4.3H2"/><path d="M9.6 4.6A2 2 0 1 1 11 8H2"/><path d="M12.6 19.4A2 2 0 1 0 14 16H2"/>',
    bullets: [
      "Jurisdiction-aware CO and NO₂ thresholds — the system knows your state's regulatory floor",
      "Four-tier escalation from routine logging to alarm response",
      "Admins can tighten standards, never loosen them",
      "Audit-ready exceedance and compliance history",
    ],
  },
  {
    key: "iceops",
    title: "Ice Operations Log",
    desc: "Log ice resurfacer runs, blade changes, circle checks, and edging.",
    icon: '<line x1="2" x2="22" y1="12" y2="12"/><line x1="12" x2="12" y1="2" y2="22"/><path d="m20 16-4-4 4-4"/><path d="m4 8 4 4-4 4"/><path d="m16 4-4 4-4-4"/><path d="m8 20 4-4 4 4"/>',
    bullets: [
      "Four-tab structure covering every ice activity: resurfacer runs, circle checks, edging, blade changes",
      "Operation and equipment types are admin-configurable to match your fleet",
      "Operator assignment and automatic timestamps on every entry",
      "Complete maintenance history for every sheet of ice",
    ],
  },
  {
    key: "icedepth",
    title: "Ice Depth Monitoring",
    desc: "Measure depth at numbered points on your custom rink layout.",
    icon: '<path d="M21.3 8.7L15.3 2.7a1 1 0 0 0-1.4 0L2.7 13.9a1 1 0 0 0 0 1.4l6 6a1 1 0 0 0 1.4 0L21.3 10.1a1 1 0 0 0 0-1.4z"/><path d="m8 18-2-2"/><path d="m12 14-2-2"/><path d="m16 10-2-2"/><path d="m10 16-2-2"/><path d="m14 12-2-2"/>',
    bullets: [
      "Interactive rink diagrams with admin-built measurement point templates",
      "Bluetooth caliper integration — readings flow straight from the tool to the app",
      "Numbered measurement points on your custom rink layout",
      "Historical trend analysis to catch buildup and thin spots early",
    ],
  },
  {
    key: "scheduling",
    title: "Employee Scheduling",
    desc: "Build, publish, and manage staff schedules across your facility.",
    icon: '<path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/><path d="M8 14h.01"/><path d="M12 14h.01"/><path d="M16 14h.01"/><path d="M8 18h.01"/><path d="M12 18h.01"/><path d="M16 18h.01"/>',
    bullets: [
      "Built for facilities with up to 1,000 employees",
      "Shift management with role-based access at every level",
      "Published schedules locked against unauthorized changes",
      "Mobile sign-off so staff confirm shifts from anywhere",
    ],
  },
  {
    key: "accidents",
    title: "Accident Reports",
    desc: "Log staff and patron injuries with workers' comp documentation.",
    icon: '<path d="M10 10H6"/><path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2"/><path d="M19 18h2a1 1 0 0 0 1-1v-3.28a1 1 0 0 0-.684-.948l-1.923-.641a1 1 0 0 1-.578-.502l-1.539-3.076A1 1 0 0 0 16.382 8H14"/><circle cx="17" cy="18" r="2"/><circle cx="7" cy="18" r="2"/>',
    bullets: [
      "Separate workflows for staff and patron injuries",
      "Workers' comp documentation captured at the time of the incident",
      "Structured forms ensure nothing is missed under pressure",
      "Injury trends and reporting for insurance and risk management",
    ],
  },
  {
    key: "comms",
    title: "Communications Center",
    desc: "Send facility alerts, messages, and shift reminders to staff.",
    icon: '<rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>',
    bullets: [
      "Facility-wide alerts pushed to all staff instantly",
      "Shift reminders tied directly to the published schedule",
      "Targeted messages by role, department, or facility",
      "Message history so nothing gets lost in a group text",
    ],
  },
  {
    key: "admin",
    title: "Admin Panel",
    desc: "Configure every module and control access across your organization.",
    icon: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>',
    bullets: [
      "User management across the full five-tier role hierarchy",
      "Permission controls down to the module level",
      "System configuration for every module — tabs, thresholds, equipment, templates",
      "Analytics dashboard with facility-wide visibility",
    ],
  },
]

// Small integer → capitalized English word, so display copy derived from a
// count (e.g. the module-grid subhead) never drifts from the data. Falls back
// to the numeral for counts outside the table.
const NUMBER_WORDS = [
  "Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight",
  "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen",
  "Sixteen", "Seventeen", "Eighteen", "Nineteen", "Twenty",
]

function countWord(n: number): string {
  return NUMBER_WORDS[n] ?? String(n)
}

const WHY_ITEMS = [
  "Purpose-built for ice rink operations",
  "Mobile-first — designed for use on the ice floor",
  "Multi-facility management in one console",
  "Automated compliance exports and PDF reporting",
  "Offline-capable — works without cell coverage",
  "Role-based access for staff and administrators",
]

// ── Components ────────────────────────────────────────────────────────────────

function ModuleIcon({ d }: { d: string }) {
  return (
    <svg
      width="28"
      height="28"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      dangerouslySetInnerHTML={{ __html: d }}
    />
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function Home() {
  const current = await getCurrentUser()
  if (current) redirect("/dashboard")

  return (
    <div
      style={{
        background: "#001A3A",
        minHeight: "100vh",
        fontFamily:
          "var(--font-geist-sans), system-ui, -apple-system, sans-serif",
        color: "#f9fafb",
        overflowX: "hidden",
      }}
    >
      {/* ── TOP NAV ───────────────────────────────────────────────────────── */}
      <nav
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          zIndex: 10,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "20px clamp(16px, 4vw, 40px)",
          background:
            "linear-gradient(180deg, rgba(0,12,28,0.55) 0%, transparent 100%)",
        }}
      >
        <Link
          href="/"
          style={{
            color: "#ffffff",
            fontWeight: 800,
            fontSize: 18,
            letterSpacing: "0.04em",
            textTransform: "uppercase",
            textDecoration: "none",
          }}
        >
          Rink Reports
        </Link>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            flexWrap: "wrap",
            justifyContent: "flex-end",
          }}
        >
          <Link href="/login" style={SIGN_IN_BUTTON_NAV_STYLE}>
            Sign In
          </Link>
          <RequestInformationButton
            style={{
              padding: "11px 22px",
              fontSize: 15,
              minHeight: 0,
            }}
          />
        </div>
      </nav>

      {/* ── HERO ──────────────────────────────────────────────────────────── */}
      <section
        style={{
          position: "relative",
          minHeight: "100dvh",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* Background layers */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            background:
              "linear-gradient(180deg, #0f2440 0%, #0a1d36 50%, #14263f 100%)",
          }}
        />
        {/* Simulated rink interior */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            background:
              "radial-gradient(ellipse 90% 60% at 35% 95%, rgba(220,235,255,0.20) 0%, rgba(180,210,240,0.08) 30%, transparent 65%), radial-gradient(ellipse 60% 40% at 50% 25%, rgba(255,255,255,0.07) 0%, transparent 70%)",
          }}
        />
        {/* Green-to-navy hero overlay */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            background:
              "radial-gradient(ellipse 52% 82% at 0% 50%, rgba(77,255,0,0.52) 0%, rgba(77,255,0,0.18) 35%, transparent 65%), linear-gradient(104deg, rgba(77,255,0,0.42) 0%, rgba(77,255,0,0.0) 38%, rgba(0,59,111,0.38) 60%, rgba(0,26,58,0.92) 100%)",
          }}
        />
        {/* Ice-crystal dot pattern */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            opacity: 0.055,
            backgroundImage:
              "radial-gradient(circle at 20% 30%, #ffffff 0 1px, transparent 1.5px), radial-gradient(circle at 70% 60%, #ffffff 0 1px, transparent 1.5px), radial-gradient(circle at 45% 80%, #ffffff 0 1px, transparent 1.5px)",
            backgroundSize: "220px 220px, 180px 180px, 260px 260px",
            pointerEvents: "none",
          }}
        />

        {/* Hero content */}
        <div
          style={{
            position: "relative",
            zIndex: 4,
            flex: 1,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            padding: "clamp(80px, 12vw, 140px) clamp(16px, 5vw, 48px) 80px",
            textAlign: "center",
          }}
        >
          {/* Eyebrow */}
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 10,
              marginBottom: 32,
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: "0.16em",
              textTransform: "uppercase",
              color: "#4DFF00",
            }}
          >
            <span
              style={{
                display: "inline-block",
                width: 7,
                height: 7,
                borderRadius: "50%",
                background: "var(--rr-green)",
                boxShadow: "0 0 0 4px rgba(77,255,0,0.22)",
              }}
            />
            By Max Facility LLC
          </div>

          {/* Logo wordmark */}
          <h1
            style={{
              margin: "0 0 28px",
              width: "min(740px, 88vw)",
              maxWidth: "100%",
            }}
          >
            <Image
              src="/rink-reports-logo.png"
              alt="Rink Reports"
              width={1352}
              height={594}
              priority
              style={{
                width: "100%",
                height: "auto",
                filter: "drop-shadow(0 8px 40px rgba(0,0,0,0.35))",
              }}
            />
          </h1>

          {/* Tagline */}
          <p
            style={{
              fontSize: "clamp(16px, 1.8vw, 21px)",
              color: "rgba(255,255,255,0.78)",
              maxWidth: 560,
              margin: "0 auto 44px",
              lineHeight: 1.52,
            }}
          >
            The operations platform built for ice rinks. Schedules,
            staff, compliance, and reporting in one place.
          </p>

        </div>

        {/* Scroll nudge */}
        <div
          style={{
            position: "relative",
            zIndex: 4,
            textAlign: "center",
            paddingBottom: 28,
            color: "rgba(255,255,255,0.62)",
            fontSize: 11,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
          }}
        >
          ↓ explore
        </div>
      </section>

      {/* ── MODULE GRID ───────────────────────────────────────────────────── */}
      <section
        style={{
          background: "#001A3A",
          padding:
            "clamp(60px, 8vw, 120px) clamp(16px, 4vw, 48px) clamp(60px, 8vw, 100px)",
        }}
      >
        <div style={{ maxWidth: 1280, margin: "0 auto" }}>
          {/* Section header */}
          <div style={{ textAlign: "center", marginBottom: 64 }}>
            <div
              style={{
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: "0.14em",
                textTransform: "uppercase",
                color: "#4DFF00",
                marginBottom: 16,
              }}
            >
              Platform modules
            </div>
            <h2
              style={{
                fontWeight: 800,
                fontSize: "clamp(30px, 4vw, 52px)",
                lineHeight: 1.06,
                letterSpacing: "-0.02em",
                color: "#ffffff",
                margin: "0 0 16px",
              }}
            >
              Everything a rink needs,
              <br />
              in one console
            </h2>
            <p
              style={{
                fontSize: "clamp(15px, 1.4vw, 19px)",
                color: "rgba(255,255,255,0.72)",
                margin: 0,
                lineHeight: 1.5,
              }}
            >
              {countWord(MODULES.length)} integrated modules. Zero
              spreadsheets.
            </p>
          </div>

          {/* Grid */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
              gap: 22,
            }}
          >
            {MODULES.map((m) => (
              <div
                key={m.key}
                style={{
                  background:
                    "linear-gradient(180deg, #0d2547 0%, #0a1f3c 100%)",
                  border: "1px solid #15315a",
                  borderRadius: 16,
                  padding: "30px 26px",
                  display: "flex",
                  flexDirection: "column",
                  gap: 16,
                  minHeight: 240,
                }}
              >
                {/* Icon */}
                <div
                  style={{
                    width: 54,
                    height: 54,
                    borderRadius: 14,
                    background:
                      "linear-gradient(135deg, #1A9B00 0%, #4DFF00 100%)",
                    display: "grid",
                    placeItems: "center",
                    color: "#fff",
                    boxShadow: "0 6px 14px -4px rgba(77,255,0,0.42)",
                    flexShrink: 0,
                  }}
                >
                  <ModuleIcon d={m.icon} />
                </div>

                {/* Text */}
                <div>
                  <div
                    style={{
                      fontWeight: 700,
                      fontSize: 20,
                      color: "#ffffff",
                      marginBottom: 8,
                      lineHeight: 1.2,
                    }}
                  >
                    {m.title}
                  </div>
                  <div
                    style={{
                      fontSize: 14,
                      lineHeight: 1.55,
                      color: "rgba(255,255,255,0.72)",
                    }}
                  >
                    {m.desc}
                  </div>
                </div>

                {/* Feature bullets */}
                <ul
                  style={{
                    listStyle: "none",
                    padding: 0,
                    margin: "2px 0 0",
                    display: "flex",
                    flexDirection: "column",
                    gap: 10,
                  }}
                >
                  {m.bullets.map((b, i) => (
                    <li
                      key={i}
                      style={{
                        display: "flex",
                        alignItems: "flex-start",
                        gap: 10,
                        fontSize: 13.5,
                        lineHeight: 1.45,
                        color: "rgba(255,255,255,0.82)",
                      }}
                    >
                      <svg
                        width="15"
                        height="15"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="#4DFF00"
                        strokeWidth="3"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                        focusable="false"
                        style={{ flexShrink: 0, marginTop: 3 }}
                      >
                        <path d="M20 6 9 17l-5-5" />
                      </svg>
                      <span>{b}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── WHY SECTION ──────────────────────────────────────────────────── */}
      <section
        style={{
          background: "#001A3A",
          padding:
            "clamp(40px, 6vw, 80px) clamp(16px, 4vw, 48px) clamp(80px, 10vw, 140px)",
        }}
      >
        <div style={{ maxWidth: 1280, margin: "0 auto" }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
              gap: "clamp(40px, 6vw, 80px)",
              alignItems: "start",
            }}
          >
            {/* Feature list */}
            <div>
              <h2
                style={{
                  fontWeight: 800,
                  fontSize: "clamp(30px, 4vw, 50px)",
                  lineHeight: 1.07,
                  letterSpacing: "-0.02em",
                  color: "#ffffff",
                  margin: "0 0 20px",
                }}
              >
                Why Rink Reports?
              </h2>
              <p
                style={{
                  fontSize: 17,
                  color: "rgba(255,255,255,0.72)",
                  lineHeight: 1.6,
                  margin: "0 0 36px",
                  maxWidth: 460,
                }}
              >
                Built by people who understand what it takes to run a clean,
                safe, compliant sheet of ice every shift.
              </p>
              <ul
                style={{
                  listStyle: "none",
                  padding: 0,
                  margin: 0,
                  display: "flex",
                  flexDirection: "column",
                  gap: 18,
                }}
              >
                {WHY_ITEMS.map((item, i) => (
                  <li
                    key={i}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 16,
                      color: "#ffffff",
                      fontSize: 17,
                      fontWeight: 500,
                    }}
                  >
                    <span
                      style={{
                        width: 28,
                        height: 28,
                        borderRadius: "50%",
                        background: "rgba(77,255,0,0.16)",
                        display: "grid",
                        placeItems: "center",
                        flexShrink: 0,
                      }}
                    >
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="#4DFF00"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M20 6 9 17l-5-5" />
                      </svg>
                    </span>
                    {item}
                  </li>
                ))}
              </ul>
            </div>

            {/* CTA card */}
            <div
              style={{
                background: "#0a1f3c",
                border: "1px solid #15315a",
                borderRadius: 20,
                padding: "clamp(28px, 4vw, 44px)",
              }}
            >
              <div
                style={{
                  fontWeight: 700,
                  fontSize: "clamp(22px, 2.5vw, 28px)",
                  color: "#ffffff",
                  margin: "0 0 12px",
                  letterSpacing: "-0.01em",
                  lineHeight: 1.2,
                }}
              >
                Ready to get started?
              </div>
              <p
                style={{
                  fontSize: 15,
                  color: "rgba(255,255,255,0.72)",
                  lineHeight: 1.6,
                  margin: "0 0 28px",
                }}
              >
                Tell us about your facility and we&apos;ll be in touch to
                show you how Rink Reports fits your operation.
              </p>
              <div
                style={{
                  display: "flex",
                  justifyContent: "center",
                }}
              >
                <RequestInformationButton style={{ width: "100%" }} />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── FOOTER ───────────────────────────────────────────────────────── */}
      <footer
        style={{
          background: "#001A3A",
          borderTop: "1px solid #122a4a",
          padding: "26px 24px",
          textAlign: "center",
          color: "rgba(255,255,255,0.62)",
          fontSize: 13,
        }}
      >
        Max Facility LLC · Rink Reports ·{" "}
        {new Date().getFullYear()}
      </footer>
    </div>
  )
}
