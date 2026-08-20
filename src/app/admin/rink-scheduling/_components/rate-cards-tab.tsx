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

import {
  addRateCardWindow,
  createRateCard,
  deleteRateCard,
  deleteRateCardOverride,
  deleteRateCardWindow,
  saveRateCardOverride,
  updateRateCard,
} from "../actions"
import { DAY_LABELS } from "../_lib/config"
import type {
  ActionState,
  BookingTypeRow,
  RateCardRow,
  RateCardTypeOverrideRow,
  RateCardWindowRow,
} from "../types"

const NULL_STATE: ActionState = { ok: null }

function money(v: number | string): string {
  const n = typeof v === "number" ? v : Number(v)
  return Number.isFinite(n) ? n.toFixed(2) : "0.00"
}

type Props = {
  cards: RateCardRow[]
  windows: RateCardWindowRow[]
  overrides: RateCardTypeOverrideRow[]
  bookingTypes: BookingTypeRow[]
}

export function RateCardsTab({ cards, windows, overrides, bookingTypes }: Props) {
  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Rate cards ({cards.length})</CardTitle>
          <CardDescription>
            What ice costs, and when. Anything outside a prime window bills at
            the non-prime rate. A booking keeps whatever rate it was saved with,
            so editing a card here never changes a booking or invoice that
            already exists.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {cards.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              No rate cards yet. Seed the defaults from Facility Setup for a
              zero-rate starting card, or add one below.
            </p>
          ) : (
            <ul className="flex flex-col gap-3">
              {cards.map((card) => (
                <RateCardItem
                  key={card.id}
                  card={card}
                  windows={windows.filter((w) => w.rate_card_id === card.id)}
                  overrides={overrides.filter((o) => o.rate_card_id === card.id)}
                  bookingTypes={bookingTypes}
                />
              ))}
            </ul>
          )}
          <RateCardCreateForm />
        </CardContent>
      </Card>
    </div>
  )
}

function RateCardItem({
  card,
  windows,
  overrides,
  bookingTypes,
}: {
  card: RateCardRow
  windows: RateCardWindowRow[]
  overrides: RateCardTypeOverrideRow[]
  bookingTypes: BookingTypeRow[]
}) {
  const [editing, setEditing] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [state, action, pending] = useActionState(updateRateCard, NULL_STATE)
  const [delPending, startDel] = useTransition()

  useEffect(() => {
    if (state.ok === true) toast.success(state.message ?? "Rate card updated.")
    if (state.ok === false) toast.error(state.error)
  }, [state])

  function onDelete() {
    if (!confirm(`Delete rate card "${card.name}"?`)) return
    startDel(async () => {
      const r = await deleteRateCard(card.id)
      if (!r.ok) toast.error(r.error)
      else toast.success("Rate card deleted.")
    })
  }

  return (
    <li className="bg-muted/30 flex flex-col gap-2 rounded-md border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="font-medium">{card.name}</span>
          {card.is_default && (
            <Badge variant="outline" className="uppercase">
              default
            </Badge>
          )}
          <span className="text-muted-foreground font-mono text-xs">
            {card.effective_start} → {card.effective_end ?? "open"}
          </span>
          <span className="font-mono text-xs">
            prime {money(card.hourly_rate_prime)} · non-prime{" "}
            {money(card.hourly_rate_nonprime)}
          </span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Button variant="outline" size="sm" onClick={() => setExpanded((v) => !v)}>
            {expanded ? "Hide windows" : `Windows (${windows.length})`}
          </Button>
          <Button variant="outline" size="sm" onClick={() => setEditing((v) => !v)}>
            {editing ? "Cancel" : "Edit"}
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
          <input type="hidden" name="id" value={card.id} />
          <div className="flex flex-col gap-1">
            <Label htmlFor={`rc-name-${card.id}`}>Name</Label>
            <Input
              id={`rc-name-${card.id}`}
              name="name"
              defaultValue={card.name}
              required
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor={`rc-start-${card.id}`}>Effective from</Label>
            <Input
              id={`rc-start-${card.id}`}
              name="effective_start"
              type="date"
              defaultValue={card.effective_start}
              required
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor={`rc-end-${card.id}`}>Until</Label>
            <Input
              id={`rc-end-${card.id}`}
              name="effective_end"
              type="date"
              defaultValue={card.effective_end ?? ""}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor={`rc-prime-${card.id}`}>Prime / hr</Label>
            <Input
              id={`rc-prime-${card.id}`}
              name="hourly_rate_prime"
              inputMode="decimal"
              defaultValue={money(card.hourly_rate_prime)}
              className="w-28 font-mono"
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor={`rc-non-${card.id}`}>Non-prime / hr</Label>
            <Input
              id={`rc-non-${card.id}`}
              name="hourly_rate_nonprime"
              inputMode="decimal"
              defaultValue={money(card.hourly_rate_nonprime)}
              className="w-28 font-mono"
            />
          </div>
          <label className="flex h-9 items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="is_default"
              defaultChecked={card.is_default}
              className="border-input size-4 rounded border"
            />
            Default card
          </label>
          <Button type="submit" size="sm" disabled={pending}>
            {pending ? "Saving…" : "Save"}
          </Button>
        </form>
      )}

      {expanded && (
        <div className="flex flex-col gap-4 border-t pt-3">
          <PrimeWindows cardId={card.id} windows={windows} />
          <TypeOverrides
            cardId={card.id}
            overrides={overrides}
            bookingTypes={bookingTypes}
            card={card}
          />
        </div>
      )}
    </li>
  )
}

function PrimeWindows({
  cardId,
  windows,
}: {
  cardId: string
  windows: RateCardWindowRow[]
}) {
  const [state, action, pending] = useActionState(addRateCardWindow, NULL_STATE)

  useEffect(() => {
    if (state.ok === true) toast.success(state.message ?? "Prime window added.")
    if (state.ok === false) toast.error(state.error)
  }, [state])

  const byDay = new Map<number, RateCardWindowRow[]>()
  for (const w of windows) {
    byDay.set(w.day_of_week, [...(byDay.get(w.day_of_week) ?? []), w])
  }

  return (
    <div className="flex flex-col gap-2">
      <h4 className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
        Prime windows
      </h4>
      <p className="text-muted-foreground text-xs">
        Hours billed at the prime rate. Everything else on the card is
        non-prime; a booking that straddles the boundary is split across both.
      </p>
      <ul className="flex flex-col gap-1">
        {DAY_LABELS.map((label, day) => {
          const rows = byDay.get(day) ?? []
          return (
            <li key={day} className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-muted-foreground w-24 text-xs">{label}</span>
              {rows.length === 0 ? (
                <span className="text-muted-foreground text-xs italic">
                  all non-prime
                </span>
              ) : (
                rows.map((w) => <WindowChip key={w.id} window={w} />)
              )}
            </li>
          )
        })}
      </ul>

      <form
        action={action}
        className="flex flex-wrap items-end gap-2"
        key={state.ok === true ? `w-ok-${cardId}` : `w-${cardId}`}
      >
        <input type="hidden" name="rate_card_id" value={cardId} />
        <div className="flex flex-col gap-1">
          <Label htmlFor={`w-day-${cardId}`} className="text-xs">
            Day
          </Label>
          <select
            id={`w-day-${cardId}`}
            name="day_of_week"
            className="border-input bg-background h-9 rounded-md border px-2 text-sm"
          >
            {DAY_LABELS.map((label, day) => (
              <option key={day} value={day}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor={`w-start-${cardId}`} className="text-xs">
            From
          </Label>
          <Input
            id={`w-start-${cardId}`}
            name="start_time"
            type="time"
            defaultValue="17:00"
            className="w-28"
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor={`w-end-${cardId}`} className="text-xs">
            To
          </Label>
          <Input
            id={`w-end-${cardId}`}
            name="end_time"
            type="time"
            defaultValue="22:00"
            className="w-28"
          />
        </div>
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Adding…" : "Add window"}
        </Button>
      </form>
    </div>
  )
}

function WindowChip({ window: w }: { window: RateCardWindowRow }) {
  const [pending, start] = useTransition()

  function onRemove() {
    start(async () => {
      const r = await deleteRateCardWindow(w.id)
      if (!r.ok) toast.error(r.error)
    })
  }

  return (
    <span className="bg-background inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-xs">
      {w.start_time.slice(0, 5)}–{w.end_time.slice(0, 5)}
      <button
        type="button"
        onClick={onRemove}
        disabled={pending}
        aria-label={`Remove ${w.start_time.slice(0, 5)} to ${w.end_time.slice(0, 5)} window`}
        className="text-muted-foreground hover:text-foreground focus-visible:ring-ring rounded-full focus-visible:ring-2 focus-visible:outline-none"
      >
        ×
      </button>
    </span>
  )
}

function TypeOverrides({
  cardId,
  overrides,
  bookingTypes,
  card,
}: {
  cardId: string
  overrides: RateCardTypeOverrideRow[]
  bookingTypes: BookingTypeRow[]
  card: RateCardRow
}) {
  const [state, action, pending] = useActionState(saveRateCardOverride, NULL_STATE)

  useEffect(() => {
    if (state.ok === true) toast.success(state.message ?? "Override saved.")
    if (state.ok === false) toast.error(state.error)
  }, [state])

  const typeById = new Map(bookingTypes.map((t) => [t.id, t]))

  return (
    <div className="flex flex-col gap-2">
      <h4 className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
        Per-type rates
      </h4>
      <p className="text-muted-foreground text-xs">
        Charge a particular booking type differently on this card. Use 0.00 for
        an internal program or a chargeback that should not be invoiced a cash
        amount. Types not listed bill at the card&rsquo;s own rates (
        {money(card.hourly_rate_prime)} / {money(card.hourly_rate_nonprime)}).
      </p>

      {overrides.length > 0 && (
        <ul className="flex flex-col gap-1">
          {overrides.map((o) => (
            <OverrideRow
              key={o.id}
              override={o}
              label={typeById.get(o.booking_type_id)?.name ?? "Unknown type"}
            />
          ))}
        </ul>
      )}

      <form
        action={action}
        className="flex flex-wrap items-end gap-2"
        key={state.ok === true ? `o-ok-${cardId}` : `o-${cardId}`}
      >
        <input type="hidden" name="rate_card_id" value={cardId} />
        <div className="flex flex-col gap-1">
          <Label htmlFor={`o-type-${cardId}`} className="text-xs">
            Booking type
          </Label>
          <select
            id={`o-type-${cardId}`}
            name="booking_type_id"
            className="border-input bg-background h-9 rounded-md border px-2 text-sm"
          >
            {bookingTypes.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor={`o-prime-${cardId}`} className="text-xs">
            Prime / hr
          </Label>
          <Input
            id={`o-prime-${cardId}`}
            name="hourly_rate_prime"
            inputMode="decimal"
            defaultValue="0.00"
            className="w-24 font-mono"
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor={`o-non-${cardId}`} className="text-xs">
            Non-prime / hr
          </Label>
          <Input
            id={`o-non-${cardId}`}
            name="hourly_rate_nonprime"
            inputMode="decimal"
            defaultValue="0.00"
            className="w-24 font-mono"
          />
        </div>
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Saving…" : "Set override"}
        </Button>
      </form>
    </div>
  )
}

function OverrideRow({
  override,
  label,
}: {
  override: RateCardTypeOverrideRow
  label: string
}) {
  const [pending, start] = useTransition()

  function onRemove() {
    start(async () => {
      const r = await deleteRateCardOverride(override.id)
      if (!r.ok) toast.error(r.error)
      else toast.success("Override removed.")
    })
  }

  return (
    <li className="flex flex-wrap items-center gap-2 text-sm">
      <span className="w-40">{label}</span>
      <span className="font-mono text-xs">
        prime {money(override.hourly_rate_prime)} · non-prime{" "}
        {money(override.hourly_rate_nonprime)}
      </span>
      <Button variant="outline" size="sm" onClick={onRemove} disabled={pending}>
        Remove
      </Button>
    </li>
  )
}

function RateCardCreateForm() {
  const [state, action, pending] = useActionState(createRateCard, NULL_STATE)

  useEffect(() => {
    if (state.ok === true) toast.success(state.message ?? "Rate card created.")
    if (state.ok === false) toast.error(state.error)
  }, [state])

  return (
    <form
      action={action}
      className="flex flex-wrap items-end gap-3 rounded-md border p-3"
      key={state.ok === true ? "rc-form-ok" : "rc-form"}
    >
      <div className="flex flex-col gap-1">
        <Label htmlFor="new-rc-name">Name</Label>
        <Input id="new-rc-name" name="name" placeholder="2026-27 Season" required />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="new-rc-start">Effective from</Label>
        <Input id="new-rc-start" name="effective_start" type="date" required />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="new-rc-end">Until</Label>
        <Input id="new-rc-end" name="effective_end" type="date" />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="new-rc-prime">Prime / hr</Label>
        <Input
          id="new-rc-prime"
          name="hourly_rate_prime"
          inputMode="decimal"
          defaultValue="0.00"
          className="w-28 font-mono"
        />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="new-rc-non">Non-prime / hr</Label>
        <Input
          id="new-rc-non"
          name="hourly_rate_nonprime"
          inputMode="decimal"
          defaultValue="0.00"
          className="w-28 font-mono"
        />
      </div>
      <label className="flex h-9 items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="is_default"
          className="border-input size-4 rounded border"
        />
        Default card
      </label>
      <Button type="submit" disabled={pending}>
        {pending ? "Adding…" : "Add rate card"}
      </Button>
    </form>
  )
}
