import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

export type OverrideRow = {
  id: string
  createdAt: string
  employeeName: string
  jobAreaName: string
  missingCerts: string[]
  reason: string | null
  overriddenByName: string
}

function formatWhen(iso: string, timeZone: string | null): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  // Server-rendered: pin to the facility zone, not the server's.
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: timeZone ?? undefined,
  })
}

/**
 * Read-only audit list of cert-gate overrides (schedule_assignment_overrides).
 * A facility_manager deliberately assigned someone to a job area despite a
 * missing/expired required cert; each override is recorded and surfaced here.
 */
export function OverridesList({
  rows,
  timeZone,
}: {
  rows: OverrideRow[]
  timeZone: string | null
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Certification overrides</CardTitle>
        <CardDescription>
          When a manager assigns someone to a job area despite a missing or
          expired required certification, it&apos;s logged here.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No certification overrides recorded.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-border text-muted-foreground border-b text-left">
                  <th className="py-2 pr-4 font-medium">When</th>
                  <th className="py-2 pr-4 font-medium">Employee</th>
                  <th className="py-2 pr-4 font-medium">Job area</th>
                  <th className="py-2 pr-4 font-medium">Missing cert(s)</th>
                  <th className="py-2 pr-4 font-medium">Reason</th>
                  <th className="py-2 font-medium">Overridden by</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-border/60 border-b last:border-0">
                    <td className="text-muted-foreground py-2 pr-4 whitespace-nowrap">
                      {formatWhen(r.createdAt, timeZone)}
                    </td>
                    <td className="py-2 pr-4">{r.employeeName}</td>
                    <td className="py-2 pr-4">{r.jobAreaName}</td>
                    <td className="py-2 pr-4">
                      {r.missingCerts.length > 0 ? r.missingCerts.join(", ") : "—"}
                    </td>
                    <td className="text-muted-foreground py-2 pr-4">
                      {r.reason ?? "—"}
                    </td>
                    <td className="py-2">{r.overriddenByName}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
