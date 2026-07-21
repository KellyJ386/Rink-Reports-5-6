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
  moveManagedRow,
  setChecklistItemActive,
  setRinkInspectionWeekday,
  upsertChecklistItem,
} from "../actions"
import type { ActionState, ChecklistItemRow, RinkRow } from "../types"
import { WEEKDAY_LABELS } from "../types"

const NULL_STATE: ActionState = { ok: null }
const SELECT_CLASS =
  "border-input bg-background h-9 rounded-md border px-3 py-1 text-sm"
const CADENCES = ["daily", "weekly", "monthly", "yearly"] as const
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
]

export function ChecklistTab({
  rink,
  items,
}: {
  rink: RinkRow
  items: ChecklistItemRow[]
}) {
  const [weekdayPending, startWeekday] = useTransition()

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Inspection weekday</CardTitle>
          <CardDescription>
            Weekly checklist items come due on this day. Monthly items come due
            on the month&apos;s first walk; yearly items in their due month.
            The daily cadence ships empty by design — the spatial
            tap-the-problem model carries daily coverage.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <select
            className={SELECT_CLASS}
            value={String(rink.inspection_weekday)}
            disabled={weekdayPending}
            aria-label="Inspection weekday"
            onChange={(e) => {
              const day = Number(e.target.value)
              startWeekday(async () => {
                const r = await setRinkInspectionWeekday(rink.id, day)
                if (!r.ok) toast.error(r.error)
                else toast.success(`Weekly items now due on ${WEEKDAY_LABELS[day]}.`)
              })
            }}
          >
            {WEEKDAY_LABELS.map((label, i) => (
              <option key={label} value={i}>
                {label}
              </option>
            ))}
          </select>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Checklist items ({items.length})</CardTitle>
          <CardDescription>
            Cadenced items ride inside the walk flow; due items must be
            answered before a walk can be signed off, and flagged items create
            issues in the same pipeline as spatial ones.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <ul className="flex flex-col gap-2">
            {items.map((item, i) => (
              <ItemRow
                key={item.id}
                item={item}
                isFirst={i === 0}
                isLast={i === items.length - 1}
              />
            ))}
            {items.length === 0 && (
              <li className="text-muted-foreground text-sm">
                No checklist items yet.
              </li>
            )}
          </ul>
          <ItemForm rinkId={rink.id} />
        </CardContent>
      </Card>
    </div>
  )
}

function ItemRow({
  item,
  isFirst,
  isLast,
}: {
  item: ChecklistItemRow
  isFirst: boolean
  isLast: boolean
}) {
  const [editing, setEditing] = useState(false)
  const [pending, start] = useTransition()

  function onMove(dir: -1 | 1) {
    start(async () => {
      const r = await moveManagedRow("dasher_boards_checklist_items", item.id, dir)
      if (!r.ok) toast.error(r.error)
    })
  }

  return (
    <li className="bg-muted/30 flex flex-col gap-2 rounded-md border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">{item.label}</span>
          <Badge variant="outline" className="uppercase">
            {item.cadence}
          </Badge>
          {item.cadence === "yearly" && item.due_month && (
            <Badge variant="secondary">{MONTHS[item.due_month - 1]}</Badge>
          )}
          {!item.is_active && (
            <Badge variant="secondary" className="uppercase">
              off
            </Badge>
          )}
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Button variant="outline" size="sm" onClick={() => onMove(-1)} disabled={pending || isFirst} aria-label="Move up">
            ↑
          </Button>
          <Button variant="outline" size="sm" onClick={() => onMove(1)} disabled={pending || isLast} aria-label="Move down">
            ↓
          </Button>
          <Button variant="outline" size="sm" onClick={() => setEditing((v) => !v)}>
            {editing ? "Close" : "Edit"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const r = await setChecklistItemActive(item.id, !item.is_active)
                if (!r.ok) toast.error(r.error)
              })
            }
          >
            {item.is_active ? "Deactivate" : "Activate"}
          </Button>
        </div>
      </div>
      {editing && <ItemForm item={item} onDone={() => setEditing(false)} />}
    </li>
  )
}

function ItemForm({
  rinkId,
  item,
  onDone,
}: {
  rinkId?: string
  item?: ChecklistItemRow
  onDone?: () => void
}) {
  const [state, formAction, pending] = useActionState(
    upsertChecklistItem,
    NULL_STATE,
  )
  const [cadence, setCadence] = useState(item?.cadence ?? "weekly")

  useEffect(() => {
    if (state.ok === true) {
      toast.success(state.message ?? "Saved.")
      onDone?.()
    }
    if (state.ok === false) toast.error(state.error)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state])

  return (
    <form
      key={state.ok === true && !item ? "item-ok" : "item-form"}
      action={formAction}
      className="flex flex-wrap items-end gap-2"
    >
      {item ? (
        <input type="hidden" name="id" value={item.id} />
      ) : (
        <input type="hidden" name="rink_id" value={rinkId} />
      )}
      <div className="flex min-w-64 flex-1 flex-col gap-1.5">
        <Label htmlFor={`item-label-${item?.id ?? "new"}`}>Item</Label>
        <Input
          id={`item-label-${item?.id ?? "new"}`}
          name="label"
          required
          defaultValue={item?.label ?? ""}
          placeholder="e.g. Protective netting condition"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label>Cadence</Label>
        <select
          name="cadence"
          className={SELECT_CLASS}
          value={cadence}
          onChange={(e) => setCadence(e.target.value as typeof cadence)}
        >
          {CADENCES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>
      {cadence === "yearly" && (
        <div className="flex flex-col gap-1.5">
          <Label>Due month</Label>
          <select
            name="due_month"
            className={SELECT_CLASS}
            defaultValue={item?.due_month ?? 1}
          >
            {MONTHS.map((m, i) => (
              <option key={m} value={i + 1}>
                {m}
              </option>
            ))}
          </select>
        </div>
      )}
      <input
        type="hidden"
        name="sort_order"
        value={item?.sort_order ?? 100}
      />
      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : item ? "Save" : "Add item"}
      </Button>
    </form>
  )
}
