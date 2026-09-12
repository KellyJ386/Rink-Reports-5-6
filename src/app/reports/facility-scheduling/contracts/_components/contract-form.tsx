"use client"

import { useState, useTransition } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"

import { createContract } from "../../contract-actions"

export type CustomerOption = { id: string; name: string }

/** Mirrors the server action's ContractInput shape exactly. */
export type ContractFormInput = {
  customerId: string
  name: string
  seasonStart: string
  seasonEnd: string
  contractRate: number | null
  autoInvoice: boolean
  autoSend: boolean
  invoiceDayOfMonth: number
  notes: string | null
}

type FormProps = {
  idPrefix: string
  customers: CustomerOption[]
  initial?: Partial<ContractFormInput>
  submitLabel: string
  pendingLabel: string
  pending: boolean
  onSubmit: (input: ContractFormInput) => void
  onClose?: () => void
}

/** The one contract form, used by both the create panel and inline edit. */
export function ContractForm({
  idPrefix,
  customers,
  initial,
  submitLabel,
  pendingLabel,
  pending,
  onSubmit,
  onClose,
}: FormProps) {
  const [customerId, setCustomerId] = useState(initial?.customerId ?? "")
  const [name, setName] = useState(initial?.name ?? "")
  const [seasonStart, setSeasonStart] = useState(initial?.seasonStart ?? "")
  const [seasonEnd, setSeasonEnd] = useState(initial?.seasonEnd ?? "")
  const [rateText, setRateText] = useState(
    initial?.contractRate != null ? String(initial.contractRate) : "",
  )
  const [invoiceDay, setInvoiceDay] = useState(
    String(initial?.invoiceDayOfMonth ?? 1),
  )
  const [autoInvoice, setAutoInvoice] = useState(initial?.autoInvoice ?? true)
  const [autoSend, setAutoSend] = useState(initial?.autoSend ?? false)
  const [notes, setNotes] = useState(initial?.notes ?? "")

  function submit() {
    if (!customerId) {
      toast.error("Pick the customer this contract is with.")
      return
    }
    let contractRate: number | null = null
    if (rateText.trim()) {
      const n = Number(rateText)
      if (!Number.isFinite(n)) {
        toast.error("Enter the hourly rate as a number, or leave it blank.")
        return
      }
      contractRate = n
    }
    onSubmit({
      customerId,
      name: name.trim(),
      seasonStart,
      seasonEnd,
      contractRate,
      autoInvoice,
      autoSend,
      invoiceDayOfMonth: Number(invoiceDay),
      notes: notes.trim() || null,
    })
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${idPrefix}-customer`}>Customer</Label>
          <select
            id={`${idPrefix}-customer`}
            value={customerId}
            onChange={(e) => setCustomerId(e.target.value)}
            className="border-input bg-background h-10 rounded-md border px-2 text-sm"
          >
            <option value="">Select a customer…</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${idPrefix}-name`}>Contract name</Label>
          <Input
            id={`${idPrefix}-name`}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. 2026–27 Youth League"
            maxLength={160}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${idPrefix}-start`}>Season start</Label>
          <Input
            id={`${idPrefix}-start`}
            type="date"
            value={seasonStart}
            onChange={(e) => setSeasonStart(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${idPrefix}-end`}>Season end</Label>
          <Input
            id={`${idPrefix}-end`}
            type="date"
            value={seasonEnd}
            onChange={(e) => setSeasonEnd(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${idPrefix}-rate`}>Contract rate ($/hour)</Label>
          <Input
            id={`${idPrefix}-rate`}
            type="text"
            inputMode="decimal"
            value={rateText}
            onChange={(e) => setRateText(e.target.value)}
            placeholder="275.00"
          />
          <p className="text-muted-foreground text-xs">
            Leave blank to use rate-card pricing.
          </p>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${idPrefix}-day`}>Invoice day of month</Label>
          <Input
            id={`${idPrefix}-day`}
            type="number"
            min={1}
            max={28}
            value={invoiceDay}
            onChange={(e) => setInvoiceDay(e.target.value)}
          />
          <p className="text-muted-foreground text-xs">
            Each month is billed in arrears on this day (1–28).
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor={`${idPrefix}-auto-invoice`} className="flex items-start gap-2">
          <input
            type="checkbox"
            id={`${idPrefix}-auto-invoice`}
            checked={autoInvoice}
            onChange={(e) => setAutoInvoice(e.target.checked)}
            className="border-input mt-0.5 size-4 rounded border"
          />
          <span className="text-sm">
            Auto-invoice
            <span className="text-muted-foreground block text-xs">
              Generate each month’s invoice automatically.
            </span>
          </span>
        </label>
        <label htmlFor={`${idPrefix}-auto-send`} className="flex items-start gap-2">
          <input
            type="checkbox"
            id={`${idPrefix}-auto-send`}
            checked={autoSend}
            onChange={(e) => setAutoSend(e.target.checked)}
            className="border-input mt-0.5 size-4 rounded border"
          />
          <span className="text-sm">
            Auto-send
            <span className="text-muted-foreground block text-xs">
              Issue and email automatically — otherwise drafts wait for review.
            </span>
          </span>
        </label>
      </div>

      <div className="flex flex-col gap-1">
        <Label htmlFor={`${idPrefix}-notes`}>Notes (optional)</Label>
        <Textarea
          id={`${idPrefix}-notes`}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          maxLength={4000}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={submit} disabled={pending}>
          {pending ? pendingLabel : submitLabel}
        </Button>
        {onClose ? (
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            Close
          </Button>
        ) : null}
      </div>
    </div>
  )
}

export function CreateContractPanel({ customers }: { customers: CustomerOption[] }) {
  const [pending, startTransition] = useTransition()
  // Remounting the form is the reset; the fields live inside it.
  const [formKey, setFormKey] = useState(0)

  function onCreate(input: ContractFormInput) {
    startTransition(async () => {
      const r = await createContract(input)
      if (!r.ok) {
        toast.error(r.error)
        return
      }
      toast.success("Contract created as a draft — activate it to start billing.")
      setFormKey((k) => k + 1)
    })
  }

  return (
    <Card>
      <CardContent className="py-4">
        <ContractForm
          key={formKey}
          idPrefix="new-contract"
          customers={customers}
          submitLabel="Create draft contract"
          pendingLabel="Creating…"
          pending={pending}
          onSubmit={onCreate}
        />
      </CardContent>
    </Card>
  )
}
