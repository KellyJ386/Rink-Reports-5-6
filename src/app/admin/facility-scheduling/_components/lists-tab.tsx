"use client"

import { useActionState, useEffect, useState, useTransition } from "react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

import { createLookup, deleteLookup, setLookupActive, updateLookup } from "../actions"
import type {
  ActionState,
  BookingTypeRow,
  CustomerTypeRow,
  PaymentMethodRow,
} from "../types"

const NULL_STATE: ActionState = { ok: null }

type LookupKind = "booking_types" | "customer_types" | "payment_methods"

/** The shape every lookup row shares; booking types add colour + billability. */
type LookupLike = {
  id: string
  name: string
  sort_order: number
  is_active: boolean
}

type Props = {
  bookingTypes: BookingTypeRow[]
  customerTypes: CustomerTypeRow[]
  paymentMethods: PaymentMethodRow[]
}

export function ListsTab({ bookingTypes, customerTypes, paymentMethods }: Props) {
  return (
    <div className="flex flex-col gap-6">
      <BookingTypesCard rows={bookingTypes} />
      <SimpleLookupCard
        kind="customer_types"
        title="Customer types"
        description="How booking parties are classified — internal programs, teams, leagues, schools and so on."
        placeholder="Youth League"
        rows={customerTypes}
      />
      <SimpleLookupCard
        kind="payment_methods"
        title="Payment methods"
        description="How payments get recorded. “Card (recorded)” logs a card payment taken elsewhere; no card details are ever stored here."
        placeholder="Wire transfer"
        rows={paymentMethods}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Booking types — colour and billability make these their own card.
// ---------------------------------------------------------------------------

function BookingTypesCard({ rows }: { rows: BookingTypeRow[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Booking types ({rows.length})</CardTitle>
        <CardDescription>
          What a slot on the calendar is for. The colour is the block&rsquo;s
          colour on the grid. A type that is not billable occupies ice but never
          reaches an invoice.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {rows.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No booking types yet. Seed the defaults from Facility Setup, or add
            one below.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {rows.map((row) => (
              <BookingTypeRowItem key={row.id} row={row} />
            ))}
          </ul>
        )}
        <BookingTypeCreateForm />
      </CardContent>
    </Card>
  )
}

function BookingTypeRowItem({ row }: { row: BookingTypeRow }) {
  const [editing, setEditing] = useState(false)
  const [state, action, pending] = useActionState(updateLookup, NULL_STATE)
  const [activePending, startActive] = useTransition()
  const [delPending, startDel] = useTransition()

  useEffect(() => {
    if (state.ok === true) toast.success(state.message ?? "Saved.")
    if (state.ok === false) toast.error(state.error)
  }, [state])

  function onToggleActive() {
    startActive(async () => {
      const r = await setLookupActive("booking_types", row.id, !row.is_active)
      if (!r.ok) toast.error(r.error)
    })
  }

  function onDelete() {
    if (!confirm(`Delete booking type "${row.name}"?`)) return
    startDel(async () => {
      const r = await deleteLookup("booking_types", row.id)
      if (!r.ok) toast.error(r.error)
      else toast.success("Deleted.")
    })
  }

  return (
    <li className="bg-muted/30 flex flex-col gap-2 rounded-md border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span
            aria-hidden
            className="size-4 shrink-0 rounded-sm border"
            style={{ backgroundColor: row.color }}
          />
          <span className="font-medium">{row.name}</span>
          {!row.is_billable && (
            <Badge variant="secondary" className="uppercase">
              non-billable
            </Badge>
          )}
          {row.is_resurface && (
            <Badge variant="outline" className="uppercase">
              resurface
            </Badge>
          )}
          {row.is_system && (
            <Badge variant="outline" className="uppercase">
              built-in
            </Badge>
          )}
          {!row.is_active && (
            <Badge variant="secondary" className="uppercase">
              off
            </Badge>
          )}
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Button variant="outline" size="sm" onClick={() => setEditing((v) => !v)}>
            {editing ? "Cancel" : "Edit"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={onToggleActive}
            disabled={activePending}
          >
            {row.is_active ? "Deactivate" : "Activate"}
          </Button>
          {!row.is_system && (
            <Button
              variant="destructive"
              size="sm"
              onClick={onDelete}
              disabled={delPending}
            >
              Delete
            </Button>
          )}
        </div>
      </div>

      {editing && (
        <form action={action} className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="lookup" value="booking_types" />
          <input type="hidden" name="id" value={row.id} />
          <div className="flex flex-col gap-1">
            <Label htmlFor={`bt-name-${row.id}`}>Name</Label>
            <Input
              id={`bt-name-${row.id}`}
              name="name"
              defaultValue={row.name}
              required
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor={`bt-color-${row.id}`}>Colour</Label>
            <Input
              id={`bt-color-${row.id}`}
              name="color"
              type="color"
              defaultValue={row.color}
              className="h-9 w-16 p-1"
            />
          </div>
          <label className="flex h-9 items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="is_billable"
              defaultChecked={row.is_billable}
              disabled={row.is_system}
              className="border-input size-4 rounded border"
            />
            Billable
          </label>
          <label className="flex h-9 items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="is_resurface"
              defaultChecked={row.is_resurface}
              className="border-input size-4 rounded border"
            />
            Ice resurface
          </label>
          <div className="flex flex-col gap-1">
            <Label htmlFor={`bt-sort-${row.id}`}>Order</Label>
            <Input
              id={`bt-sort-${row.id}`}
              name="sort_order"
              type="number"
              defaultValue={row.sort_order}
              className="w-20"
            />
          </div>
          <Button type="submit" size="sm" disabled={pending}>
            {pending ? "Saving…" : "Save"}
          </Button>
          {row.is_system && (
            <p className="text-muted-foreground w-full text-xs">
              Built-in type: it can be renamed and recoloured, but not made
              billable — bookings of this type are allowed to have no customer.
            </p>
          )}
        </form>
      )}
    </li>
  )
}

function BookingTypeCreateForm() {
  const [state, action, pending] = useActionState(createLookup, NULL_STATE)

  useEffect(() => {
    if (state.ok === true) toast.success(state.message ?? "Added.")
    if (state.ok === false) toast.error(state.error)
  }, [state])

  return (
    <form
      action={action}
      className="flex flex-wrap items-end gap-3 rounded-md border p-3"
      key={state.ok === true ? "bt-form-ok" : "bt-form"}
    >
      <input type="hidden" name="lookup" value="booking_types" />
      <div className="flex flex-col gap-1">
        <Label htmlFor="new-bt-name">Name</Label>
        <Input id="new-bt-name" name="name" placeholder="Figure Skating" required />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="new-bt-color">Colour</Label>
        <Input
          id="new-bt-color"
          name="color"
          type="color"
          defaultValue="#002244"
          className="h-9 w-16 p-1"
        />
      </div>
      <label className="flex h-9 items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="is_billable"
          defaultChecked
          className="border-input size-4 rounded border"
        />
        Billable
      </label>
      <label className="flex h-9 items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="is_resurface"
          className="border-input size-4 rounded border"
        />
        Ice resurface
      </label>
      <Button type="submit" disabled={pending}>
        {pending ? "Adding…" : "Add booking type"}
      </Button>
    </form>
  )
}

// ---------------------------------------------------------------------------
// Customer types + payment methods share one card, since they share a shape.
// ---------------------------------------------------------------------------

function SimpleLookupCard({
  kind,
  title,
  description,
  placeholder,
  rows,
}: {
  kind: LookupKind
  title: string
  description: string
  placeholder: string
  rows: LookupLike[]
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {title} ({rows.length})
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {rows.length === 0 ? (
          <p className="text-muted-foreground text-sm">Nothing here yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {rows.map((row) => (
              <SimpleLookupRowItem key={row.id} kind={kind} row={row} />
            ))}
          </ul>
        )}
        <SimpleLookupCreateForm kind={kind} placeholder={placeholder} />
      </CardContent>
    </Card>
  )
}

function SimpleLookupRowItem({
  kind,
  row,
}: {
  kind: LookupKind
  row: LookupLike
}) {
  const [editing, setEditing] = useState(false)
  const [state, action, pending] = useActionState(updateLookup, NULL_STATE)
  const [activePending, startActive] = useTransition()
  const [delPending, startDel] = useTransition()

  useEffect(() => {
    if (state.ok === true) toast.success(state.message ?? "Saved.")
    if (state.ok === false) toast.error(state.error)
  }, [state])

  function onToggleActive() {
    startActive(async () => {
      const r = await setLookupActive(kind, row.id, !row.is_active)
      if (!r.ok) toast.error(r.error)
    })
  }

  function onDelete() {
    if (!confirm(`Delete "${row.name}"?`)) return
    startDel(async () => {
      const r = await deleteLookup(kind, row.id)
      if (!r.ok) toast.error(r.error)
      else toast.success("Deleted.")
    })
  }

  return (
    <li className="bg-muted/30 flex flex-col gap-2 rounded-md border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="font-medium">{row.name}</span>
          {!row.is_active && (
            <Badge variant="secondary" className="uppercase">
              off
            </Badge>
          )}
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Button variant="outline" size="sm" onClick={() => setEditing((v) => !v)}>
            {editing ? "Cancel" : "Edit"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={onToggleActive}
            disabled={activePending}
          >
            {row.is_active ? "Deactivate" : "Activate"}
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={onDelete}
            disabled={delPending}
          >
            Delete
          </Button>
        </div>
      </div>

      {editing && (
        <form action={action} className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="lookup" value={kind} />
          <input type="hidden" name="id" value={row.id} />
          <div className="flex flex-col gap-1">
            <Label htmlFor={`lk-name-${row.id}`}>Name</Label>
            <Input
              id={`lk-name-${row.id}`}
              name="name"
              defaultValue={row.name}
              required
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor={`lk-sort-${row.id}`}>Order</Label>
            <Input
              id={`lk-sort-${row.id}`}
              name="sort_order"
              type="number"
              defaultValue={row.sort_order}
              className="w-20"
            />
          </div>
          <Button type="submit" size="sm" disabled={pending}>
            {pending ? "Saving…" : "Save"}
          </Button>
        </form>
      )}
    </li>
  )
}

function SimpleLookupCreateForm({
  kind,
  placeholder,
}: {
  kind: LookupKind
  placeholder: string
}) {
  const [state, action, pending] = useActionState(createLookup, NULL_STATE)

  useEffect(() => {
    if (state.ok === true) toast.success(state.message ?? "Added.")
    if (state.ok === false) toast.error(state.error)
  }, [state])

  return (
    <form
      action={action}
      className="flex flex-wrap items-end gap-3 rounded-md border p-3"
      key={state.ok === true ? `${kind}-form-ok` : `${kind}-form`}
    >
      <input type="hidden" name="lookup" value={kind} />
      <div className="flex flex-col gap-1">
        <Label htmlFor={`new-${kind}-name`}>Name</Label>
        <Input id={`new-${kind}-name`} name="name" placeholder={placeholder} required />
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? "Adding…" : "Add"}
      </Button>
    </form>
  )
}
