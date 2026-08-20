"use client"

import Link from "next/link"
import { useState } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { formatMoney, toCents, type InvoiceStatus } from "@/lib/rink-scheduling/ar"

export type InvoiceRow = {
  id: string
  number: string
  customerName: string
  status: InvoiceStatus
  issueDate: string
  dueDate: string
  total: number
  amountPaid: number
}

const FILTERS: ReadonlyArray<{ key: "all" | InvoiceStatus; label: string }> = [
  { key: "all", label: "All" },
  { key: "draft", label: "Draft" },
  { key: "sent", label: "Sent" },
  { key: "partially_paid", label: "Part paid" },
  { key: "paid", label: "Paid" },
  { key: "void", label: "Void" },
]

export function InvoiceTable({
  rows,
  todayKey,
}: {
  rows: InvoiceRow[]
  todayKey: string
}) {
  const [filter, setFilter] = useState<"all" | InvoiceStatus>("all")
  const visible = filter === "all" ? rows : rows.filter((r) => r.status === filter)

  function onExport() {
    // Built in the browser from what is on screen, so the export matches the
    // filter the user is looking at.
    const header = [
      "Invoice",
      "Customer",
      "Status",
      "Issued",
      "Due",
      "Total",
      "Paid",
      "Outstanding",
    ]
    const body = visible.map((r) => [
      r.number,
      r.customerName,
      r.status,
      r.issueDate,
      r.dueDate,
      r.total.toFixed(2),
      r.amountPaid.toFixed(2),
      ((toCents(r.total) - toCents(r.amountPaid)) / 100).toFixed(2),
    ])
    const csv = [header, ...body]
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
    a.download = `invoices-${todayKey}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 py-4">
        <div className="flex flex-wrap items-center gap-1.5">
          {FILTERS.map((f) => (
            <Button
              key={f.key}
              size="sm"
              variant={filter === f.key ? "default" : "outline"}
              onClick={() => setFilter(f.key)}
            >
              {f.label}
            </Button>
          ))}
          <Button size="sm" variant="outline" className="ml-auto" onClick={onExport}>
            Export CSV
          </Button>
        </div>

        {visible.length === 0 ? (
          <p className="text-muted-foreground py-6 text-center text-sm">
            No invoices here yet.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="px-2 py-2 text-left font-medium">Invoice</th>
                  <th className="px-2 py-2 text-left font-medium">Customer</th>
                  <th className="px-2 py-2 text-left font-medium">Status</th>
                  <th className="px-2 py-2 text-left font-medium">Due</th>
                  <th className="px-2 py-2 text-right font-medium">Total</th>
                  <th className="px-2 py-2 text-right font-medium">Outstanding</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((r) => {
                  const outstanding = toCents(r.total) - toCents(r.amountPaid)
                  const overdue =
                    r.status !== "draft" &&
                    r.status !== "void" &&
                    r.status !== "paid" &&
                    r.dueDate < todayKey
                  return (
                    <tr key={r.id} className="hover:bg-muted/40 border-b">
                      <td className="px-2 py-2">
                        <Link
                          href={`/reports/rink-scheduling/invoices/${r.id}`}
                          className="font-mono text-xs tabular-nums underline-offset-2 hover:underline"
                        >
                          {r.number}
                        </Link>
                      </td>
                      <td className="max-w-56 truncate px-2 py-2">{r.customerName}</td>
                      <td className="px-2 py-2">
                        <StatusBadge status={r.status} />
                      </td>
                      <td className="px-2 py-2">
                        <span className="font-mono text-xs tabular-nums">{r.dueDate}</span>
                        {overdue && (
                          <Badge variant="secondary" className="ml-1.5 uppercase">
                            overdue
                          </Badge>
                        )}
                      </td>
                      <td className="px-2 py-2 text-right font-mono text-xs tabular-nums">
                        {formatMoney(r.total)}
                      </td>
                      <td className="px-2 py-2 text-right font-mono text-xs tabular-nums">
                        {outstanding > 0 ? formatMoney(outstanding / 100) : "—"}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

export function StatusBadge({ status }: { status: InvoiceStatus }) {
  const label = status.replace(/_/g, " ")
  if (status === "paid") {
    return (
      <Badge variant="outline" className="uppercase">
        {label}
      </Badge>
    )
  }
  return (
    <Badge variant="secondary" className="uppercase">
      {label}
    </Badge>
  )
}
