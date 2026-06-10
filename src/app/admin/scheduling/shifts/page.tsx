import Link from "next/link"

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { requireAdmin } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"

import { resolveOperatingHours } from "../_lib/operating-hours"
import type { EmployeeLite, JobAreaLite, ShiftRow } from "../_lib/types"
import type { GridShiftDTO, GridTemplateDTO } from "../_lib/grid-actions"

import { ScheduleGrid } from "./_components/schedule-grid"

export const dynamic = "force-dynamic"

type SearchParams = Promise<{ date?: string }>

// How much shift history/future to preload around the anchor so week-nav has
// data to show without a round-trip (Phase 2 keeps events client-side).
const WINDOW_DAYS = 28

function parseAnchorDate(date: string | undefined): Date {
  if (date) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
    if (m) {
      const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
      if (!Number.isNaN(d.getTime())) return d
    }
  }
  const now = new Date()
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  )
}

export const metadata = { title: "Shift Management | MFO / Rink Reports" }

export default async function ShiftsPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const current = await requireAdmin()
  const facilityId = current.profile?.facility_id ?? null
  const params = await searchParams

  if (!facilityId) {
    return (
      <div className="flex flex-col gap-6 p-4 md:p-6">
        <Header />
        <Card>
          <CardHeader>
            <CardTitle>No facility yet</CardTitle>
            <CardDescription>
              Create a facility before scheduling shifts.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link href="/admin/facility">Go to Facility Settings</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  const anchor = parseAnchorDate(params.date)
  const windowStart = new Date(anchor)
  windowStart.setUTCDate(anchor.getUTCDate() - WINDOW_DAYS)
  const windowEnd = new Date(anchor)
  windowEnd.setUTCDate(anchor.getUTCDate() + WINDOW_DAYS)

  const supabase = await createClient()

  const [
    employeesRes,
    jobAreasRes,
    facilityRes,
    settingsRes,
    shiftsRes,
    templatesRes,
    templateSlotsRes,
  ] = await Promise.all([
      supabase
        .from("employees")
        .select("id, first_name, last_name, is_minor, is_active, max_weekly_hours")
        .eq("facility_id", facilityId)
        .eq("is_active", true)
        .order("last_name", { ascending: true }),
      supabase
        .from("employee_job_areas")
        .select("id, name, slug, is_active")
        .eq("facility_id", facilityId)
        .eq("is_active", true)
        .order("sort_order", { ascending: true }),
      supabase
        .from("facilities")
        .select("settings")
        .eq("id", facilityId)
        .maybeSingle<{ settings: unknown }>(),
      supabase
        .from("schedule_settings")
        .select("week_start_day")
        .eq("facility_id", facilityId)
        .maybeSingle<{ week_start_day: number }>(),
      supabase
        .from("schedule_shifts")
        .select("*")
        .eq("facility_id", facilityId)
        .gte("starts_at", windowStart.toISOString())
        .lt("starts_at", windowEnd.toISOString())
        .order("starts_at", { ascending: true })
        .limit(1000),
      supabase
        .from("schedule_templates")
        .select("id, name")
        .eq("facility_id", facilityId)
        .eq("is_active", true)
        .order("name", { ascending: true }),
      supabase
        .from("schedule_template_shifts")
        .select("template_id, job_area_id, start_time, end_time, break_minutes")
        .eq("facility_id", facilityId),
    ])

  const employees = (employeesRes.data ?? []) as EmployeeLite[]
  const jobAreas = (jobAreasRes.data ?? []) as JobAreaLite[]
  const operatingHours = resolveOperatingHours(facilityRes.data?.settings)
  const weekStartDay = settingsRes.data?.week_start_day ?? 0

  const shifts: ShiftRow[] = shiftsRes.data ?? []
  const initialShifts: GridShiftDTO[] = shifts.map((s) => {
    return {
      id: s.id,
      starts_at: s.starts_at,
      ends_at: s.ends_at,
      employee_id: s.employee_id,
      job_area_id: s.job_area_id,
      department_id: s.department_id,
      status: s.status as GridShiftDTO["status"],
      break_minutes: s.break_minutes ?? 0,
      role_label: s.role_label,
      notes: s.notes,
    }
  })

  // Single-slot grid templates: pair each active template with its first slot.
  type SlotRow = {
    template_id: string
    job_area_id: string | null
    start_time: string
    end_time: string
    break_minutes: number | null
  }
  const slotByTemplate = new Map<string, SlotRow>()
  for (const s of (templateSlotsRes.data ?? []) as SlotRow[]) {
    if (!slotByTemplate.has(s.template_id)) slotByTemplate.set(s.template_id, s)
  }
  const initialTemplates: GridTemplateDTO[] = (
    (templatesRes.data ?? []) as Array<{ id: string; name: string }>
  )
    .map((t) => {
      const slot = slotByTemplate.get(t.id)
      if (!slot) return null
      return {
        id: t.id,
        name: t.name,
        job_area_id: slot.job_area_id,
        start_time: slot.start_time,
        end_time: slot.end_time,
        break_minutes: slot.break_minutes ?? 0,
      }
    })
    .filter((x): x is GridTemplateDTO => x !== null)

  return (
    <div className="flex flex-col gap-6 p-4 md:p-6">
      <Header />
      <ScheduleGrid
        employees={employees}
        jobAreas={jobAreas}
        initialShifts={initialShifts}
        initialTemplates={initialTemplates}
        operatingHours={operatingHours}
        weekStartDay={weekStartDay}
        defaultDateIso={anchor.toISOString()}
      />
    </div>
  )
}

function Header() {
  return (
    <div className="flex flex-col gap-1">
      <h1 className="text-2xl font-semibold tracking-tight">Shifts</h1>
      <p className="text-muted-foreground text-sm">
        Drag on a day column to paint a shift. Move or resize existing shifts to
        reschedule — changes save automatically.
      </p>
    </div>
  )
}
