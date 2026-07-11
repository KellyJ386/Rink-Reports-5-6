import Link from "next/link"

import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { EmptyState } from "@/components/ui/empty-state"
import { PageHeader } from "@/components/ui/page-header"
import { PreviewBanner } from "@/components/preview-banner"
import { StatusBubble } from "@/components/app/status-bubble"
import { SignOutButton } from "@/components/staff/sign-out-button"
import { requireUser } from "@/lib/auth"
import { getPreviewContext } from "@/lib/auth/preview"
import { getEnabledModuleKeys } from "@/lib/modules/facility-modules"
import { createClient } from "@/lib/supabase/server"

import { hideDashboardModule, showDashboardModule } from "./actions"
import { getDashboardModuleStatus, type ModuleStatus } from "./_lib/status"

export const dynamic = "force-dynamic"
export const metadata = { title: "Dashboard | Rink Reports" }

// ── Module registry ───────────────────────────────────────────────────────────

type ModuleKey =
  | "daily_reports"
  | "incident_reports"
  | "accident_reports"
  | "refrigeration"
  | "air_quality"
  | "ice_operations"
  | "ice_depth"
  | "communications"
  | "scheduling"
  | "facility_paperwork"

// Each module references a CSS var defined in globals.css (--module-*).
// The var carries light + dark values so tiles auto-adapt.
const MODULE_ACCENT: Record<ModuleKey, string> = {
  daily_reports:    "--module-daily",
  incident_reports: "--module-incidents",
  accident_reports: "--module-accidents",
  refrigeration:    "--module-refrig",
  air_quality:      "--module-air",
  ice_operations:   "--module-ice-ops",
  ice_depth:        "--module-ice-depth",
  communications:   "--module-comms",
  scheduling:       "--module-scheduling",
  facility_paperwork: "--module-paperwork",
}

const MODULE_ICONS: Record<ModuleKey, string> = {
  daily_reports:    '<path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/><rect width="6" height="4" x="9" y="3" rx="1" ry="1"/><path d="M9 12h6"/><path d="M9 16h4"/>',
  incident_reports: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><circle cx="12" cy="17" r="1"/>',
  accident_reports: '<path d="M10 10H6"/><path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2"/><path d="M19 18h2a1 1 0 0 0 1-1v-3.28a1 1 0 0 0-.684-.948l-1.923-.641a1 1 0 0 1-.578-.502l-1.539-3.076A1 1 0 0 0 16.382 8H14"/><circle cx="17" cy="18" r="2"/><circle cx="7" cy="18" r="2"/>',
  refrigeration:    '<path d="M14 4v10.54a4 4 0 1 1-4 0V4a2 2 0 0 1 4 0z"/>',
  air_quality:      '<path d="M17.7 7.7a2.5 2.5 0 1 1 1.8 4.3H2"/><path d="M9.6 4.6A2 2 0 1 1 11 8H2"/><path d="M12.6 19.4A2 2 0 1 0 14 16H2"/>',
  ice_operations:   '<line x1="2" x2="22" y1="12" y2="12"/><line x1="12" x2="12" y1="2" y2="22"/><path d="m20 16-4-4 4-4"/><path d="m4 8 4 4-4 4"/><path d="m16 4-4 4-4-4"/><path d="m8 20 4-4 4 4"/>',
  ice_depth:        '<path d="M21.3 8.7L15.3 2.7a1 1 0 0 0-1.4 0L2.7 13.9a1 1 0 0 0 0 1.4l6 6a1 1 0 0 0 1.4 0L21.3 10.1a1 1 0 0 0 0-1.4z"/><path d="m8 18-2-2"/><path d="m12 14-2-2"/><path d="m16 10-2-2"/><path d="m10 16-2-2"/><path d="m14 12-2-2"/>',
  communications:   '<rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>',
  scheduling:       '<rect width="18" height="18" x="3" y="4" rx="2" ry="2"/><line x1="16" x2="16" y1="2" y2="6"/><line x1="8" x2="8" y1="2" y2="6"/><line x1="3" x2="21" y1="10" y2="10"/>',
  facility_paperwork: '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
}

const KNOWN_MODULES: Record<ModuleKey, { title: string; href: string }> = {
  daily_reports:    { title: "Daily Reports",    href: "/reports/daily" },
  incident_reports: { title: "Incident Reports", href: "/reports/incidents" },
  accident_reports: { title: "Accident Reports", href: "/reports/accidents" },
  refrigeration:    { title: "Refrigeration",    href: "/reports/refrigeration" },
  air_quality:      { title: "Air Quality",      href: "/reports/air-quality" },
  ice_operations:   { title: "Ice Operations",   href: "/reports/ice-operations" },
  ice_depth:        { title: "Ice Depth",        href: "/reports/ice-depth" },
  communications:   { title: "Communications",   href: "/reports/communications" },
  scheduling:       { title: "Scheduling",       href: "/reports/scheduling" },
  facility_paperwork: { title: "Facility Paperwork", href: "/reports/facility-paperwork" },
}

function isKnownModuleKey(key: string): key is ModuleKey {
  return Object.prototype.hasOwnProperty.call(KNOWN_MODULES, key)
}

// ── Module tile ───────────────────────────────────────────────────────────────

function ModuleTile({
  moduleKey,
  href,
  title,
  showHideButton,
  status,
}: {
  moduleKey: ModuleKey
  href: string
  title: string
  showHideButton: boolean
  status?: ModuleStatus | null
}) {
  const accentVar = MODULE_ACCENT[moduleKey]
  const iconPath = MODULE_ICONS[moduleKey]
  const DISPLAY_FONT =
    "var(--font-anton), Anton, Impact, 'Arial Narrow', sans-serif"
  // Fixed rather than scaled per-title: sized to fit the longest title
  // ("Communications") within the tightest tile width so every card reads
  // at the same size.
  const TITLE_FONT_SIZE = 20

  const tileStyle: React.CSSProperties = {
    ["--module-accent" as string]: `var(${accentVar})`,
  }

  return (
    <div className="relative" style={tileStyle}>
      <Link
        href={href}
        className="group block rounded-2xl outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--accent-brand)]/55"
      >
        <div
          className="relative flex h-full min-h-[200px] flex-col overflow-hidden rounded-2xl p-5 shadow-[var(--shadow-elev-1)] transition-all duration-200 group-hover:-translate-y-0.5"
          style={{
            background:
              "linear-gradient(160deg, color-mix(in oklab, var(--module-accent) 100%, white 10%) 0%, var(--module-accent) 55%, color-mix(in oklab, var(--module-accent) 85%, black 15%) 100%)",
          }}
        >
          {/* Subtle highlight sheen at the top for the "premium" feel */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 h-1/2"
            style={{
              background:
                "radial-gradient(80% 100% at 20% 0%, rgba(255,255,255,0.18), transparent 70%)",
            }}
          />

          <div
            className="relative flex h-11 w-11 items-center justify-center rounded-xl"
            style={{
              background: "rgba(255,255,255,0.18)",
              backdropFilter: "blur(4px)",
              boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.18)",
            }}
          >
            <svg
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#ffffff"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
              focusable="false"
              dangerouslySetInnerHTML={{ __html: iconPath }}
            />
          </div>

          {/* Bottom scrim — guarantees the white title clears WCAG AA (≥4.5:1)
              even over the lighter dark-mode module accents (e.g. amber/green
              flood tiles), without darkening the accent identity up top. */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 bottom-0 h-2/5"
            style={{
              background:
                "linear-gradient(to top, rgba(0,0,0,0.42), transparent)",
            }}
          />

          <div
            className="relative mt-auto pt-8 text-white"
            style={{
              fontFamily: DISPLAY_FONT,
              fontSize: TITLE_FONT_SIZE,
              lineHeight: 1.05,
              letterSpacing: "0.015em",
              textTransform: "uppercase",
              textShadow: "0 1px 2px rgba(0,0,0,0.25)",
            }}
          >
            {title}
          </div>

          {/* Bottom rail — brand green accent, signature Subzero-style stripe */}
          <div
            aria-hidden
            className="absolute bottom-0 left-0 right-0 h-1"
            style={{
              background:
                "linear-gradient(to right, var(--primary) 0%, color-mix(in oklab, var(--primary) 60%, white 40%) 100%)",
            }}
          />
        </div>
      </Link>

      {/* Top-right cluster: status "monitoring light" + hide control. Lives
          outside the <Link> so neither intercepts the tile navigation. */}
      <div className="absolute right-2.5 top-2.5 z-10 flex items-center gap-1.5">
        <StatusBubble status={status} moduleTitle={title} />
        {showHideButton ? (
          <form action={hideDashboardModule} className="m-0">
            <input type="hidden" name="moduleKey" value={moduleKey} />
            <button
              type="submit"
              aria-label={`Hide ${title} from dashboard`}
              title="Hide from dashboard"
              className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-white/30 bg-black/35 text-white backdrop-blur-sm transition-colors hover:bg-black/55"
            >
              ×
            </button>
          </form>
        ) : null}
      </div>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function DashboardPage() {
  const current = await requireUser()
  const supabase = await createClient()
  const preview = await getPreviewContext()

  // If preview is active, render the dashboard from the target employee's
  // perspective. Otherwise resolve the caller's own employee row.
  let employeeRow:
    | {
        id: string
        first_name: string
        facility_id: string
        hidden_modules: string[]
      }
    | null
  if (preview.active && preview.target) {
    const { data } = await supabase
      .from("employees")
      .select("id, first_name, facility_id, hidden_modules")
      .eq("id", preview.target.id)
      .limit(1)
      .maybeSingle()
    employeeRow = data ?? null
  } else {
    const { data } = await supabase
      .from("employees")
      .select("id, first_name, facility_id, hidden_modules")
      .eq("user_id", current.authUser.id)
      .eq("is_active", true)
      .limit(1)
      .maybeSingle()
    employeeRow = data ?? null
  }

  if (!employeeRow) {
    return (
      <div className="mx-auto flex w-full max-w-xl flex-col gap-6 px-4 py-10">
        <h1 className="text-2xl font-semibold tracking-tight">Welcome</h1>
        <Card>
          <CardHeader>
            <CardTitle>Account not ready</CardTitle>
            <CardDescription>
              Your account is being set up. Contact your administrator to
              finish setup.
            </CardDescription>
          </CardHeader>
          <div className="px-6 pb-6">
            <SignOutButton />
          </div>
        </Card>
      </div>
    )
  }

  // Hide/show controls write to the caller's own employees row via
  // SECURITY DEFINER RPCs keyed on auth.uid(). In preview mode the page
  // renders the target employee's preferences, so showing the controls
  // would let an admin accidentally edit their own hidden list — disable
  // them while previewing.
  const canEditPreferences = !preview.active

  // Per-facility module toggle (facility_modules) — the same source the staff
  // sidebar uses. `null` = show everything (fail-open); otherwise a module that
  // the facility has disabled shows neither a nav link nor a dashboard tile.
  const enabledModules = await getEnabledModuleKeys(employeeRow.facility_id)
  const isFacilityEnabled = (k: ModuleKey) =>
    enabledModules == null || enabledModules.includes(k)

  const allKeys = (Object.keys(KNOWN_MODULES) as ModuleKey[]).filter(
    isFacilityEnabled,
  )
  const hiddenSet = new Set(
    (employeeRow.hidden_modules ?? []).filter(isKnownModuleKey),
  )
  const visibleModules = allKeys.filter((k) => !hiddenSet.has(k))
  const hiddenModules = allKeys.filter((k) => hiddenSet.has(k))

  // Module "monitoring lights". facility_id is the server-resolved value from
  // the employees row above (never client-supplied); reads are RLS-scoped. The
  // helper degrades to {} on any failure, so the dashboard renders fine offline
  // or when status data is unavailable — tiles simply show no bubble.
  const statusMap = await getDashboardModuleStatus(employeeRow.facility_id)

  const DISPLAY_FONT =
    "var(--font-anton), Anton, Impact, 'Arial Narrow', sans-serif"
  const firstName = employeeRow.first_name

  return (
    <>
      <PreviewBanner />
      <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
        <PageHeader
          eyebrow={firstName ? "Operations" : undefined}
          title={
            <span
              style={{
                fontFamily: DISPLAY_FONT,
                fontSize: "clamp(34px, 5.5vw, 48px)",
                lineHeight: 1.05,
                letterSpacing: "0.01em",
                textTransform: "uppercase",
              }}
            >
              {firstName ? `Hi, ${firstName}` : "Welcome"}
            </span>
          }
          description="Pick a module to get started."
        />

        {visibleModules.length === 0 ? (
          <EmptyState
            title="All tiles hidden"
            description="You've hidden every module tile. Restore one below to get back to work."
          />
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {visibleModules.map((key) => (
              <ModuleTile
                key={key}
                moduleKey={key}
                href={KNOWN_MODULES[key].href}
                title={KNOWN_MODULES[key].title}
                showHideButton={canEditPreferences}
                status={statusMap[key]}
              />
            ))}
          </div>
        )}

        {canEditPreferences && hiddenModules.length > 0 ? (
          <section className="mt-12">
            <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              Hidden tiles
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Tap to restore to your dashboard.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {hiddenModules.map((key) => (
                <form action={showDashboardModule} key={key}>
                  <input type="hidden" name="moduleKey" value={key} />
                  <button
                    type="submit"
                    aria-label={`Restore ${KNOWN_MODULES[key].title} to dashboard`}
                    className="inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-card px-3 py-1.5 text-sm text-foreground shadow-[var(--shadow-elev-1)] transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--accent-brand)]/45"
                  >
                    <span aria-hidden="true">+</span>
                    <span>{KNOWN_MODULES[key].title}</span>
                  </button>
                </form>
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </>
  )
}
