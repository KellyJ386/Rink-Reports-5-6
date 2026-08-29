"use client"

import Link from "next/link"
import { useState, useTransition } from "react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

import {
  activateContract,
  bindSeries,
  cancelContract,
  generateContractInvoiceNow,
  renewContract,
  unbindSeries,
  updateContract,
} from "../../contract-actions"
import { ContractForm, type ContractFormInput, type CustomerOption } from "./contract-form"

export type BoundSeriesView = {
  id: string
  title: string | null
  /** Weekday/time summary, e.g. "Mon, Wed · 6:30 PM – 8:00 PM". */
  summary: string
}

export type ContractInvoiceView = {
  id: string
  number: string
  issueDate: string
  totalLabel: string
  status: string
}

export type ContractCardView = {
  id: string
  name: string
  status: "draft" | "active"
  /** Inside the renewal window with no renewal on file. */
  expiringSoon: boolean
  customerName: string
  seasonLabel: string
  rateLabel: string
  billingLabel: string
  billedThroughLabel: string
  notes: string | null
  // Raw fields the edit form round-trips.
  customerId: string
  seasonStart: string
  seasonEnd: string
  contractRate: number | null
  autoInvoice: boolean
  autoSend: boolean
  invoiceDayOfMonth: number
  boundSeries: BoundSeriesView[]
  bindOptions: Array<{ id: string; label: string }>
  invoices: ContractInvoiceView[]
}

type Panel = "none" | "edit" | "cancel" | "renew"

export function ContractCard({
  contract,
  customers,
}: {
  contract: ContractCardView
  customers: CustomerOption[]
}) {
  const [pending, startTransition] = useTransition()
  const [panel, setPanel] = useState<Panel>("none")
  const [bindId, setBindId] = useState("")
  const [cancelReason, setCancelReason] = useState("")
  const [renewName, setRenewName] = useState("")

  function togglePanel(next: Panel) {
    setPanel((p) => (p === next ? "none" : next))
  }

  function onActivate() {
    startTransition(async () => {
      const r = await activateContract(contract.id)
      if (!r.ok) {
        toast.error(r.error)
        return
      }
      toast.success("Contract activated — monthly invoicing is live.")
    })
  }

  function onGenerate() {
    startTransition(async () => {
      const r = await generateContractInvoiceNow(contract.id)
      if (!r.ok) {
        toast.error(r.error)
        return
      }
      toast.success(r.message)
    })
  }

  function onBind() {
    if (!bindId) return
    startTransition(async () => {
      const r = await bindSeries(contract.id, bindId)
      if (!r.ok) {
        toast.error(r.error)
        return
      }
      toast.success("Series bound — its ice now bills on this contract.")
      setBindId("")
    })
  }

  function onUnbind(seriesId: string) {
    startTransition(async () => {
      const r = await unbindSeries(seriesId)
      if (!r.ok) {
        toast.error(r.error)
        return
      }
      toast.success("Series unbound.")
    })
  }

  function onRenew() {
    startTransition(async () => {
      const r = await renewContract(contract.id, renewName)
      if (!r.ok) {
        toast.error(r.error)
        return
      }
      toast.success("Renewal drafted — next season, same terms.")
      setRenewName("")
      setPanel("none")
    })
  }

  function onCancel() {
    if (!cancelReason.trim()) {
      toast.error("Give a reason for cancelling this contract.")
      return
    }
    startTransition(async () => {
      const r = await cancelContract(contract.id, cancelReason)
      if (!r.ok) {
        toast.error(r.error)
        return
      }
      toast.success("Contract cancelled.")
      setCancelReason("")
      setPanel("none")
    })
  }

  function onSave(input: ContractFormInput) {
    startTransition(async () => {
      const r = await updateContract(contract.id, input)
      if (!r.ok) {
        toast.error(r.error)
        return
      }
      toast.success("Contract saved.")
      setPanel("none")
    })
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-4 py-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="font-semibold">{contract.name}</p>
            <p className="text-muted-foreground text-sm">{contract.customerName}</p>
          </div>
          <div className="flex items-center gap-1.5">
            <Badge variant={contract.status === "active" ? "success" : "neutral"}>
              {contract.status}
            </Badge>
            {contract.expiringSoon && <Badge variant="warning">expiring soon</Badge>}
          </div>
        </div>

        <div className="rounded-lg border p-3">
          <p className="text-sm font-medium">{contract.seasonLabel}</p>
          <p className="text-muted-foreground text-sm">
            {contract.rateLabel} · {contract.billingLabel}
          </p>
          <p className="text-muted-foreground text-sm">{contract.billedThroughLabel}</p>
        </div>

        {contract.notes ? (
          <p className="text-muted-foreground text-sm whitespace-pre-wrap">
            {contract.notes}
          </p>
        ) : null}

        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold tracking-tight">Bound series</h3>
          {contract.boundSeries.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              No series bound yet — bound series bill their ice on this contract.
            </p>
          ) : (
            <ul className="divide-border divide-y overflow-hidden rounded-lg border">
              {contract.boundSeries.map((s) => (
                <li
                  key={s.id}
                  className="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{s.title ?? s.summary}</p>
                    {s.title ? (
                      <p className="text-muted-foreground text-xs">{s.summary}</p>
                    ) : null}
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => onUnbind(s.id)}
                    disabled={pending}
                  >
                    Unbind
                  </Button>
                </li>
              ))}
            </ul>
          )}
          {contract.bindOptions.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={bindId}
                onChange={(e) => setBindId(e.target.value)}
                aria-label="Series to bind"
                className="border-input bg-background h-9 min-w-0 flex-1 rounded-md border px-2 text-sm"
              >
                <option value="">Bind one of this customer’s series…</option>
                {contract.bindOptions.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </select>
              <Button size="sm" variant="outline" onClick={onBind} disabled={pending || !bindId}>
                Bind
              </Button>
            </div>
          )}
        </section>

        {contract.invoices.length > 0 && (
          <section className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold tracking-tight">Billing history</h3>
            <ul className="divide-border divide-y overflow-hidden rounded-lg border">
              {contract.invoices.map((i) => (
                <li
                  key={i.id}
                  className="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <Link
                      href={`/reports/rink-scheduling/invoices/${i.id}`}
                      className="font-mono text-xs tabular-nums underline-offset-2 hover:underline"
                    >
                      {i.number}
                    </Link>
                    <span className="text-muted-foreground text-xs">{i.issueDate}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs tabular-nums">{i.totalLabel}</span>
                    <Badge
                      variant={i.status === "paid" ? "outline" : "secondary"}
                      className="uppercase"
                    >
                      {i.status.replace(/_/g, " ")}
                    </Badge>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        <div className="flex flex-wrap items-center gap-2">
          {contract.status === "draft" && (
            <Button onClick={onActivate} disabled={pending}>
              {pending ? "Working…" : "Activate"}
            </Button>
          )}
          {contract.status === "active" && (
            <>
              <Button onClick={onGenerate} disabled={pending}>
                {pending ? "Working…" : "Generate invoice now"}
              </Button>
              <Button variant="outline" onClick={() => togglePanel("renew")} disabled={pending}>
                Renew…
              </Button>
            </>
          )}
          <Button variant="outline" onClick={() => togglePanel("edit")} disabled={pending}>
            Edit
          </Button>
          <Button variant="ghost" onClick={() => togglePanel("cancel")} disabled={pending}>
            Cancel contract…
          </Button>
        </div>

        {panel === "renew" && (
          <div className="flex flex-col gap-2 rounded-lg border p-3">
            <Label htmlFor={`renew-${contract.id}`}>Name the renewal</Label>
            <Input
              id={`renew-${contract.id}`}
              value={renewName}
              onChange={(e) => setRenewName(e.target.value)}
              placeholder="e.g. 2027–28 Youth League"
              maxLength={160}
            />
            <p className="text-muted-foreground text-xs">
              Drafts next season a year on — same customer, rate, and billing
              settings. Bind series once next season’s ice is scheduled.
            </p>
            <div>
              <Button size="sm" onClick={onRenew} disabled={pending || !renewName.trim()}>
                {pending ? "Working…" : "Draft renewal"}
              </Button>
            </div>
          </div>
        )}

        {panel === "cancel" && (
          <div className="flex flex-col gap-2 rounded-lg border p-3">
            <Label htmlFor={`cancel-${contract.id}`}>Reason for cancelling</Label>
            <Input
              id={`cancel-${contract.id}`}
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              placeholder="Kept on the contract record"
              maxLength={500}
            />
            <p className="text-muted-foreground text-xs">
              Bound series and their bookings stay on the calendar — the ice may
              still be honored or re-sold.
            </p>
            <div>
              <Button
                size="sm"
                variant="destructive"
                onClick={onCancel}
                disabled={pending || !cancelReason.trim()}
              >
                {pending ? "Working…" : "Cancel contract"}
              </Button>
            </div>
          </div>
        )}

        {panel === "edit" && (
          <div className="rounded-lg border p-3">
            <ContractForm
              idPrefix={`edit-${contract.id}`}
              customers={customers}
              initial={{
                customerId: contract.customerId,
                name: contract.name,
                seasonStart: contract.seasonStart,
                seasonEnd: contract.seasonEnd,
                contractRate: contract.contractRate,
                autoInvoice: contract.autoInvoice,
                autoSend: contract.autoSend,
                invoiceDayOfMonth: contract.invoiceDayOfMonth,
                notes: contract.notes,
              }}
              submitLabel="Save changes"
              pendingLabel="Saving…"
              pending={pending}
              onSubmit={onSave}
              onClose={() => setPanel("none")}
            />
          </div>
        )}
      </CardContent>
    </Card>
  )
}
