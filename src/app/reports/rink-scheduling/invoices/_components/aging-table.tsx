"use client"

import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import {
  AGING_BUCKETS,
  formatMoney,
  type AgingReport,
} from "@/lib/rink-scheduling/ar"

/**
 * Aging by customer. Shows OUTSTANDING balances only — drafts, voids and fully
 * paid invoices are excluded, because this report answers "who owes us what",
 * not "what have we billed".
 */
export function AgingTable({
  report,
  todayKey,
}: {
  report: AgingReport
  todayKey: string
}) {
  function onExport() {
    const header = ["Customer", ...AGING_BUCKETS.map((b) => b.label), "Total"]
    const body = report.rows.map((r) => [
      r.customerName,
      ...AGING_BUCKETS.map((b) => (r.buckets[b.key] / 100).toFixed(2)),
      (r.totalCents / 100).toFixed(2),
    ])
    const footer = [
      "TOTAL",
      ...AGING_BUCKETS.map((b) => (report.totals[b.key] / 100).toFixed(2)),
      (report.grandTotalCents / 100).toFixed(2),
    ]
    const csv = [header, ...body, footer]
      .map((row) =>
        row
          .map((cell) =>
            /[",\r\n]/.test(String(cell)) ? `"${String(cell).replace(/"/g, '""')}"` : cell,
          )
          .join(","),
      )
      .join("\r\n")

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `aging-${todayKey}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 py-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-muted-foreground text-sm">
            Outstanding balances as at {todayKey}. Overdue days are counted from
            each invoice&rsquo;s due date.
          </p>
          <Button size="sm" variant="outline" onClick={onExport}>
            Export CSV
          </Button>
        </div>

        {report.rows.length === 0 ? (
          <p className="text-muted-foreground py-6 text-center text-sm">
            Nothing outstanding. Every issued invoice is settled.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="px-2 py-2 text-left font-medium">Customer</th>
                  {AGING_BUCKETS.map((b) => (
                    <th key={b.key} className="px-2 py-2 text-right font-medium">
                      {b.label}
                    </th>
                  ))}
                  <th className="px-2 py-2 text-right font-medium">Total</th>
                </tr>
              </thead>
              <tbody>
                {report.rows.map((r) => (
                  <tr key={r.customerId} className="hover:bg-muted/40 border-b">
                    <td className="max-w-56 truncate px-2 py-2">{r.customerName}</td>
                    {AGING_BUCKETS.map((b) => (
                      <td
                        key={b.key}
                        className={`px-2 py-2 text-right font-mono text-xs tabular-nums ${
                          b.key === "d90_plus" && r.buckets[b.key] > 0 ? "text-warning" : ""
                        }`}
                      >
                        {r.buckets[b.key] > 0 ? formatMoney(r.buckets[b.key] / 100) : "—"}
                      </td>
                    ))}
                    <td className="px-2 py-2 text-right font-mono text-xs font-semibold tabular-nums">
                      {formatMoney(r.totalCents / 100)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2">
                  <td className="px-2 py-2 font-medium">Facility total</td>
                  {AGING_BUCKETS.map((b) => (
                    <td
                      key={b.key}
                      className="px-2 py-2 text-right font-mono text-xs font-semibold tabular-nums"
                    >
                      {formatMoney(report.totals[b.key] / 100)}
                    </td>
                  ))}
                  <td className="px-2 py-2 text-right font-mono text-sm font-semibold tabular-nums">
                    {formatMoney(report.grandTotalCents / 100)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
