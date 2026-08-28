"use client"

import { useRouter } from "next/navigation"
import { useState, useTransition } from "react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { formatMoney, toCents, type InvoiceStatus } from "@/lib/rink-scheduling/ar"

import {
  addManualLine,
  deleteLine,
  recordPayment,
  reversePayment,
  emailInvoice,
  sendInvoice,
  voidInvoice,
} from "../../invoice-actions"
import { StatusBadge } from "./invoice-table"

type Invoice = {
  id: string
  number: string
  status: InvoiceStatus
  issueDate: string
  dueDate: string
  subtotal: number
  taxAmount: number
  taxRate: number | null
  total: number
  amountPaid: number
  notes: string | null
  voidReason: string | null
  customerName: string
}

type Line = {
  id: string
  description: string
  quantityHours: number
  unitRate: number
  amount: number
  isManual: boolean
}

type Payment = {
  id: string
  amount: number
  paymentDate: string
  methodName: string | null
  referenceNumber: string | null
  isReversal: boolean
  notes: string | null
}

export function InvoiceDetail({
  invoice,
  lines,
  payments,
  paymentMethods,
}: {
  invoice: Invoice
  lines: Line[]
  payments: Payment[]
  paymentMethods: Array<{ id: string; name: string }>
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [voiding, setVoiding] = useState(false)
  const [voidReason, setVoidReason] = useState("")

  const isDraft = invoice.status === "draft"
  const isVoid = invoice.status === "void"
  const outstandingCents = toCents(invoice.total) - toCents(invoice.amountPaid)

  function onSend() {
    startTransition(async () => {
      const r = await sendInvoice(invoice.id)
      if (!r.ok) {
        toast.error(r.error)
        return
      }
      // The message says whether the customer was actually emailed — a send
      // that couldn't deliver is still a send, but the biller should know.
      toast.success(r.message)
      router.refresh()
    })
  }

  function onEmail() {
    startTransition(async () => {
      const r = await emailInvoice(invoice.id)
      if (!r.ok) {
        toast.error(r.error)
        return
      }
      toast.success(r.message)
    })
  }

  function onVoid() {
    startTransition(async () => {
      const r = await voidInvoice(invoice.id, voidReason)
      if (!r.ok) {
        toast.error(r.error)
        return
      }
      toast.success("Invoice voided. Its bookings can be invoiced again.")
      setVoiding(false)
      router.refresh()
    })
  }

  return (
    <div className="flex flex-col gap-6">
      {isVoid && (
        <p className="border-border bg-muted/40 rounded-md border p-3 text-sm">
          This invoice is void
          {invoice.voidReason ? `: ${invoice.voidReason}` : "."} Its bookings
          have been released and can be billed on a new invoice.
        </p>
      )}

      <Card>
        <CardContent className="flex flex-col gap-4 py-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={invoice.status} />
              <span className="text-muted-foreground text-sm">
                issued {invoice.issueDate} · due {invoice.dueDate}
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button asChild variant="outline" size="sm">
                <a
                  href={`/reports/rink-scheduling/invoices/${invoice.id}/pdf`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  PDF
                </a>
              </Button>
              {isDraft && (
                <Button size="sm" onClick={onSend} disabled={pending}>
                  {pending ? "Sending…" : "Send invoice"}
                </Button>
              )}
              {!isDraft && !isVoid && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={onEmail}
                  disabled={pending}
                >
                  {pending ? "Emailing…" : "Email invoice"}
                </Button>
              )}
              {!isVoid && !voiding && (
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => setVoiding(true)}
                  disabled={pending}
                >
                  Void…
                </Button>
              )}
            </div>
          </div>

          {voiding && (
            <div className="border-destructive/40 flex flex-col gap-2 rounded-md border p-3">
              <Label htmlFor="void-reason">Reason for voiding</Label>
              <Input
                id="void-reason"
                value={voidReason}
                onChange={(e) => setVoidReason(e.target.value)}
                placeholder="Billed to the wrong customer"
              />
              <p className="text-muted-foreground text-xs">
                Voiding releases every booking on this invoice so they can be
                billed again. Payments already recorded stay on the record.
              </p>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={onVoid}
                  disabled={pending || !voidReason.trim()}
                >
                  {pending ? "Voiding…" : "Void this invoice"}
                </Button>
                <Button size="sm" variant="outline" onClick={() => setVoiding(false)}>
                  Keep it
                </Button>
              </div>
            </div>
          )}

          <LineTable
            lines={lines}
            invoice={invoice}
            editable={isDraft}
            pending={pending}
            onChanged={() => router.refresh()}
          />
        </CardContent>
      </Card>

      <PaymentsCard
        invoiceId={invoice.id}
        payments={payments}
        paymentMethods={paymentMethods}
        outstandingCents={outstandingCents}
        canRecord={!isDraft && !isVoid && outstandingCents > 0}
        blockedReason={
          isDraft
            ? "Send the invoice before recording a payment against it."
            : isVoid
              ? "This invoice is void, so no further payments can be recorded."
              : outstandingCents <= 0
                ? "This invoice is paid in full."
                : null
        }
        onChanged={() => router.refresh()}
      />
    </div>
  )
}

function LineTable({
  lines,
  invoice,
  editable,
  pending,
  onChanged,
}: {
  lines: Line[]
  invoice: Invoice
  editable: boolean
  pending: boolean
  onChanged: () => void
}) {
  const [adding, setAdding] = useState(false)
  const [description, setDescription] = useState("")
  const [qty, setQty] = useState("1")
  const [rate, setRate] = useState("0.00")
  const [busy, startTransition] = useTransition()

  function onAdd() {
    startTransition(async () => {
      const r = await addManualLine({
        invoiceId: invoice.id,
        description,
        quantityHours: Number(qty),
        unitRate: Number(rate),
      })
      if (!r.ok) {
        toast.error(r.error)
        return
      }
      setDescription("")
      setQty("1")
      setRate("0.00")
      setAdding(false)
      toast.success("Line added.")
      onChanged()
    })
  }

  function onDelete(lineId: string) {
    startTransition(async () => {
      const r = await deleteLine(invoice.id, lineId)
      if (!r.ok) {
        toast.error(r.error)
        return
      }
      toast.success("Line removed.")
      onChanged()
    })
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b">
              <th className="px-2 py-2 text-left font-medium">Description</th>
              <th className="px-2 py-2 text-right font-medium">Hours</th>
              <th className="px-2 py-2 text-right font-medium">Rate</th>
              <th className="px-2 py-2 text-right font-medium">Amount</th>
              {editable && <th className="w-16 px-2 py-2"></th>}
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.id} className="border-b">
                <td className="px-2 py-2">
                  {l.description}
                  {l.isManual && (
                    <Badge variant="outline" className="ml-1.5 uppercase">
                      manual
                    </Badge>
                  )}
                </td>
                <td className="px-2 py-2 text-right font-mono text-xs tabular-nums">
                  {l.quantityHours.toFixed(2)}
                </td>
                <td className="px-2 py-2 text-right font-mono text-xs tabular-nums">
                  {formatMoney(l.unitRate)}
                </td>
                <td className="px-2 py-2 text-right font-mono text-xs tabular-nums">
                  {formatMoney(l.amount)}
                </td>
                {editable && (
                  <td className="px-2 py-2 text-right">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => onDelete(l.id)}
                      disabled={busy || pending}
                    >
                      Remove
                    </Button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editable &&
        (adding ? (
          <div className="flex flex-wrap items-end gap-2 rounded-md border p-3">
            <div className="flex min-w-56 flex-1 flex-col gap-1">
              <Label htmlFor="ml-desc">Description</Label>
              <Input
                id="ml-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Skate sharpening — 12 pairs"
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="ml-qty">Quantity</Label>
              <Input
                id="ml-qty"
                inputMode="decimal"
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                className="w-24 font-mono"
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="ml-rate">Unit rate</Label>
              <Input
                id="ml-rate"
                inputMode="decimal"
                value={rate}
                onChange={(e) => setRate(e.target.value)}
                className="w-28 font-mono"
              />
            </div>
            <Button onClick={onAdd} disabled={busy || !description.trim()}>
              {busy ? "Adding…" : "Add line"}
            </Button>
            <Button variant="outline" onClick={() => setAdding(false)}>
              Cancel
            </Button>
          </div>
        ) : (
          <div>
            <Button variant="outline" size="sm" onClick={() => setAdding(true)}>
              Add a manual line
            </Button>
          </div>
        ))}

      <div className="ml-auto flex w-full max-w-xs flex-col gap-1">
        <Row label="Subtotal" value={formatMoney(invoice.subtotal)} />
        {invoice.taxRate !== null && (
          <Row
            label={`Tax (${(invoice.taxRate * 100).toFixed(2)}%)`}
            value={formatMoney(invoice.taxAmount)}
          />
        )}
        <Row label="Total" value={formatMoney(invoice.total)} />
        <Row label="Paid" value={formatMoney(invoice.amountPaid)} />
        <div className="mt-1 flex items-baseline justify-between border-t pt-1">
          <span className="font-medium">Amount due</span>
          <span className="font-mono text-sm font-semibold tabular-nums">
            {formatMoney((toCents(invoice.total) - toCents(invoice.amountPaid)) / 100)}
          </span>
        </div>
      </div>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between">
      <span className="text-muted-foreground text-sm">{label}</span>
      <span className="font-mono text-xs tabular-nums">{value}</span>
    </div>
  )
}

function PaymentsCard({
  invoiceId,
  payments,
  paymentMethods,
  outstandingCents,
  canRecord,
  blockedReason,
  onChanged,
}: {
  invoiceId: string
  payments: Payment[]
  paymentMethods: Array<{ id: string; name: string }>
  outstandingCents: number
  canRecord: boolean
  blockedReason: string | null
  onChanged: () => void
}) {
  const [amount, setAmount] = useState("")
  const [methodId, setMethodId] = useState("")
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [reference, setReference] = useState("")
  const [busy, startTransition] = useTransition()

  function onRecord() {
    startTransition(async () => {
      const r = await recordPayment({
        invoiceId,
        amount: Number(amount),
        paymentMethodId: methodId || null,
        paymentDate: date,
        referenceNumber: reference.trim() || null,
        notes: null,
      })
      if (!r.ok) {
        toast.error(r.error)
        return
      }
      setAmount("")
      setReference("")
      toast.success("Payment recorded.")
      onChanged()
    })
  }

  function onReverse(paymentId: string) {
    const reason = window.prompt("Reason for reversing this payment")
    if (!reason) return
    startTransition(async () => {
      const r = await reversePayment(paymentId, reason)
      if (!r.ok) {
        toast.error(r.error)
        return
      }
      toast.success("Payment reversed.")
      onChanged()
    })
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 py-4">
        <h2 className="font-semibold">Payments</h2>

        {payments.length === 0 ? (
          <p className="text-muted-foreground text-sm">Nothing recorded yet.</p>
        ) : (
          <ul className="flex flex-col divide-y">
            {payments.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-3 py-2">
                <span className="w-28 font-mono text-xs tabular-nums">
                  {p.paymentDate}
                </span>
                <span
                  className={`w-24 text-right font-mono text-sm tabular-nums ${
                    p.isReversal ? "text-muted-foreground" : ""
                  }`}
                >
                  {formatMoney(p.amount)}
                </span>
                <span className="text-muted-foreground min-w-0 flex-1 truncate text-sm">
                  {p.isReversal ? "Reversal" : (p.methodName ?? "—")}
                  {p.referenceNumber ? ` · ${p.referenceNumber}` : ""}
                  {p.notes ? ` · ${p.notes}` : ""}
                </span>
                {!p.isReversal && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => onReverse(p.id)}
                    disabled={busy}
                  >
                    Reverse
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}

        {canRecord ? (
          <div className="flex flex-wrap items-end gap-2 rounded-md border p-3">
            <div className="flex flex-col gap-1">
              <Label htmlFor="pay-amount">Amount</Label>
              <Input
                id="pay-amount"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder={(outstandingCents / 100).toFixed(2)}
                className="w-28 font-mono"
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="pay-method">Method</Label>
              <select
                id="pay-method"
                value={methodId}
                onChange={(e) => setMethodId(e.target.value)}
                className="border-input bg-background h-10 rounded-md border px-2 text-sm"
              >
                <option value="">—</option>
                {paymentMethods.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="pay-date">Date</Label>
              <Input
                id="pay-date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="pay-ref">Reference</Label>
              <Input
                id="pay-ref"
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                placeholder="Cheque 1042"
                className="w-36"
              />
            </div>
            <Button onClick={onRecord} disabled={busy || !amount.trim()}>
              {busy ? "Recording…" : "Record payment"}
            </Button>
          </div>
        ) : (
          blockedReason && (
            <p className="text-muted-foreground rounded-md border p-3 text-sm">
              {blockedReason}
            </p>
          )
        )}

        <p className="text-muted-foreground text-xs">
          Payments are never edited or deleted. A mistake is corrected with a
          reversal, so both halves stay on the record.
        </p>
      </CardContent>
    </Card>
  )
}
