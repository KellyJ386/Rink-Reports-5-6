import Link from "next/link"

import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { SignOutButton } from "@/components/staff/sign-out-button"
import { requireUser } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"

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

const MODULE_COLORS: Record<ModuleKey, string> = {
  daily_reports:    "#4527A0",
  incident_reports: "#B71C1C",
  accident_reports: "#C62828",
  refrigeration:    "#0277BD",
  air_quality:      "#E65100",
  ice_operations:   "#1B5E20",
  ice_depth:        "#003B6F",
  communications:   "#5D4037",
  scheduling:       "#00695C",
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
}

// ── Module tile ───────────────────────────────────────────────────────────────

function ModuleTile({
  moduleKey,
  href,
  title,
}: {
  moduleKey: ModuleKey
  href: string
  title: string
}) {
  const bg = MODULE_COLORS[moduleKey]
  const iconPath = MODULE_ICONS[moduleKey]
  const DISPLAY_FONT =
    "var(--font-anton), Anton, Impact, 'Arial Narrow', sans-serif"

  return (
    <Link
      href={href}
      style={{ textDecoration: "none", outline: "none" }}
      className="group focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-2xl"
    >
      <div
        style={{
          background: bg,
          borderRadius: 16,
          minHeight: 200,
          padding: 22,
          display: "flex",
          flexDirection: "column",
          position: "relative",
          overflow: "hidden",
          boxShadow: "0 4px 14px rgba(0,0,0,0.18)",
          transition:
            "transform 0.18s cubic-bezier(.4,0,.2,1), box-shadow 0.18s",
        }}
        className="group-hover:-translate-y-0.5 group-hover:shadow-2xl"
      >
        <div
          style={{
            width: 44,
            height: 44,
            borderRadius: 12,
            background: "rgba(255,255,255,0.15)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            marginBottom: "auto",
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
            // eslint-disable-next-line react/no-danger
            dangerouslySetInnerHTML={{ __html: iconPath }}
          />
        </div>

        <div
          style={{
            fontFamily: DISPLAY_FONT,
            fontSize: 28,
            lineHeight: 1,
            letterSpacing: "0.01em",
            textTransform: "uppercase",
            color: "#ffffff",
            marginTop: 40,
          }}
        >
          {title}
        </div>

        <div
          style={{
            position: "absolute",
            bottom: 0,
            left: 0,
            right: 0,
            height: 4,
            background: "#4DFF00",
            opacity: 0.7,
          }}
        />
      </div>
    </Link>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function DashboardPage() {
  const current = await requireUser()
  const supabase = await createClient()

  const { data: employeeRow } = await supabase
    .from("employees")
    .select("id, first_name, facility_id")
    .eq("user_id", current.authUser.id)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle()

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

  const { data: modulePerms } = await supabase
    .from("module_permissions")
    .select("module_key, can_view, can_submit")
    .eq("employee_id", employeeRow.id)

  const submittableKeys = new Set(
    (modulePerms ?? [])
      .filter((row) => row.can_submit || row.can_view)
      .map((row) => row.module_key),
  )

  const modules = (Object.keys(KNOWN_MODULES) as ModuleKey[]).filter((key) =>
    submittableKeys.has(key),
  )

  const DISPLAY_FONT =
    "var(--font-anton), Anton, Impact, 'Arial Narrow', sans-serif"
  const firstName = employeeRow.first_name

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8">
      <div className="mb-8">
        <h1
          style={{
            fontFamily: DISPLAY_FONT,
            fontSize: "clamp(36px, 6vw, 52px)",
            lineHeight: 1,
            letterSpacing: "0.01em",
            textTransform: "uppercase",
            color: "var(--foreground)",
            margin: 0,
          }}
        >
          {firstName ? `Hi, ${firstName}` : "Welcome"}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Pick a module to get started.
        </p>
      </div>

      {modules.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>No modules assigned yet</CardTitle>
            <CardDescription>
              You don&apos;t have access to any staff modules yet. Talk to your
              supervisor.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
            gap: 16,
          }}
        >
          {modules.map((key) => (
            <ModuleTile
              key={key}
              moduleKey={key}
              href={KNOWN_MODULES[key].href}
              title={KNOWN_MODULES[key].title}
            />
          ))}
        </div>
      )}
    </div>
  )
}
