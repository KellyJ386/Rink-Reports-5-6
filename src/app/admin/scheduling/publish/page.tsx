import Link from "next/link"

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { PageHeader } from "@/components/ui/page-header"
import { requireAdmin } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"

import { formatDateTime } from "../_lib/datetime"
import type { EmployeeLite, PublishEventRow } from "../_lib/types"

export const dynamic = "force-dynamic"

export const metadata = { title: "Publish Schedule | MFO / Rink Reports" }

export default async function PublishHistoryPage() {
  const current = await requireAdmin()
  const profile = current.profile
  const facilityId = profile?.facility_id ?? null

  if (!facilityId) {
    return (
      <div className="flex flex-col gap-6 p-4 md:p-6">
        <Header />
        <Card>
          <CardHeader>
            <CardTitle>No facility yet</CardTitle>
            <CardDescription>
              Create a facility before publishing schedules.
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

  const supabase = await createClient()

  const [{ data: eventsRaw }, { data: facilityRow }] = await Promise.all([
    supabase
      .from("schedule_publish_events")
      .select("*")
      .eq("facility_id", facilityId)
      .order("created_at", { ascending: false })
      .limit(200),
    supabase
      .from("facilities")
      .select("timezone")
      .eq("id", facilityId)
      .maybeSingle<{ timezone: string | null }>(),
  ])
  // Server-rendered timestamps: pin to the facility zone, not the server's.
  const tz = facilityRow?.timezone ?? null

  const events = (eventsRaw ?? []) as PublishEventRow[]

  const empIds = Array.from(
    new Set(
      events
        .map((e) => e.published_by_employee_id)
        .filter((x): x is string => !!x)
    )
  )

  let employees: EmployeeLite[] = []
  if (empIds.length > 0) {
    const { data } = await supabase
      .from("employees")
      .select("id, first_name, last_name, is_minor, is_active")
      .in("id", empIds)
    employees = (data ?? []) as EmployeeLite[]
  }
  const empById = new Map(employees.map((e) => [e.id, e]))

  // Acknowledgment roll-up (migration 168): schedule_published notifications
  // carry publish_event_id, so each event can report "acknowledged N of the
  // M employees notified". Events published before the migration show "—".
  const ackByEvent = new Map<
    string,
    { notified: Set<string>; acked: Set<string> }
  >()
  if (events.length > 0) {
    const { data: ackRaw } = await supabase
      .from("schedule_notifications")
      .select("publish_event_id, employee_id, acknowledged_at")
      .in(
        "publish_event_id",
        events.map((e) => e.id)
      )
      .limit(5000)
    for (const n of (ackRaw ?? []) as {
      publish_event_id: string | null
      employee_id: string
      acknowledged_at: string | null
    }[]) {
      if (!n.publish_event_id) continue
      const bucket = ackByEvent.get(n.publish_event_id) ?? {
        notified: new Set<string>(),
        acked: new Set<string>(),
      }
      bucket.notified.add(n.employee_id)
      if (n.acknowledged_at) bucket.acked.add(n.employee_id)
      ackByEvent.set(n.publish_event_id, bucket)
    }
  }

  return (
    <div className="flex flex-col gap-6 p-4 md:p-6">
      <Header />

      {events.length === 0 ? (
        <div className="bg-card rounded-md border p-8 text-center">
          <h3 className="text-lg font-medium">No publish events yet</h3>
          <p className="text-muted-foreground mt-1 text-sm">
            Publishing a draft window will record a row here.
          </p>
        </div>
      ) : (
        <div className="overflow-auto rounded-md border">
          <table className="w-full border-collapse text-sm">
            <thead className="bg-muted/60 sticky top-0 z-10">
              <tr className="text-left">
                <th className="border-b px-3 py-2 font-medium">When</th>
                <th className="border-b px-3 py-2 font-medium">Range start</th>
                <th className="border-b px-3 py-2 font-medium">Range end</th>
                <th className="border-b px-3 py-2 font-medium">Shifts</th>
                <th className="border-b px-3 py-2 font-medium">Acknowledged</th>
                <th className="border-b px-3 py-2 font-medium">Published by</th>
              </tr>
            </thead>
            <tbody>
              {events.map((e) => {
                const emp = e.published_by_employee_id
                  ? empById.get(e.published_by_employee_id) ?? null
                  : null
                return (
                  <tr key={e.id}>
                    <td className="border-b px-3 py-2 tabular-nums">
                      {formatDateTime(e.created_at, tz)}
                    </td>
                    <td className="border-b px-3 py-2 tabular-nums">
                      {formatDateTime(e.range_starts_at, tz)}
                    </td>
                    <td className="border-b px-3 py-2 tabular-nums">
                      {formatDateTime(e.range_ends_at, tz)}
                    </td>
                    <td className="border-b px-3 py-2 tabular-nums">
                      {e.shift_count}
                    </td>
                    <td className="border-b px-3 py-2 tabular-nums">
                      {(() => {
                        const ack = ackByEvent.get(e.id)
                        if (!ack || ack.notified.size === 0) {
                          return <span className="text-muted-foreground">—</span>
                        }
                        return `${ack.acked.size}/${ack.notified.size}`
                      })()}
                    </td>
                    <td className="border-b px-3 py-2">
                      {emp ? (
                        `${emp.first_name} ${emp.last_name}`
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function Header() {
  return (
    <PageHeader
      title="Publish history"
      description="Append-only log of scheduling publish events for this facility."
    />
  )
}
