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
  setIssueCategoryActive,
  setSubtypeActive,
  upsertIssueCategory,
  upsertSubtype,
} from "../actions"
import type { ActionState, IssueCategoryRow, SubtypeRow } from "../types"

const NULL_STATE: ActionState = { ok: null }

const TYPE_LABELS: Record<string, string> = {
  board_panel: "Board panels",
  glass_panel: "Glass panels",
  door: "Doors",
}

export function ListsTab({
  subtypes,
  categories,
}: {
  subtypes: SubtypeRow[]
  categories: IssueCategoryRow[]
}) {
  const doorSubtypes = subtypes.filter((s) => s.asset_type === "door")

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Door subtypes ({doorSubtypes.length})</CardTitle>
          <CardDescription>
            Picked when marking a position as a door (Bench, Scoreboard, Public
            Skate, Zamboni, or your own).
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <ul className="flex flex-col gap-2">
            {doorSubtypes.map((s, i) => (
              <ManagedRow
                key={s.id}
                id={s.id}
                label={s.label}
                isActive={s.is_active}
                isFirst={i === 0}
                isLast={i === doorSubtypes.length - 1}
                table="dasher_boards_asset_subtypes"
                onToggle={(active) => setSubtypeActive(s.id, active)}
                editForm={<SubtypeForm subtype={s} />}
              />
            ))}
          </ul>
          <SubtypeForm />
        </CardContent>
      </Card>

      {(["board_panel", "glass_panel", "door"] as const).map((assetType) => {
        const group = categories.filter((c) => c.asset_type === assetType)
        return (
          <Card key={assetType}>
            <CardHeader>
              <CardTitle>
                Issue categories — {TYPE_LABELS[assetType]} ({group.length})
              </CardTitle>
              <CardDescription>
                The quick-pick list shown when reporting an issue on a{" "}
                {TYPE_LABELS[assetType].toLowerCase().replace(/s$/, "")}.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <ul className="flex flex-col gap-2">
                {group.map((c, i) => (
                  <ManagedRow
                    key={c.id}
                    id={c.id}
                    label={c.label}
                    isActive={c.is_active}
                    isFirst={i === 0}
                    isLast={i === group.length - 1}
                    table="dasher_boards_issue_categories"
                    onToggle={(active) => setIssueCategoryActive(c.id, active)}
                    editForm={<CategoryForm category={c} />}
                  />
                ))}
              </ul>
              <CategoryForm assetType={assetType} />
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}

function ManagedRow({
  id,
  label,
  isActive,
  isFirst,
  isLast,
  table,
  onToggle,
  editForm,
}: {
  id: string
  label: string
  isActive: boolean
  isFirst: boolean
  isLast: boolean
  table: "dasher_boards_asset_subtypes" | "dasher_boards_issue_categories"
  onToggle: (active: boolean) => Promise<{ ok: boolean; error?: string }>
  editForm: React.ReactNode
}) {
  const [editing, setEditing] = useState(false)
  const [pending, start] = useTransition()

  function onMove(dir: -1 | 1) {
    start(async () => {
      const r = await moveManagedRow(table, id, dir)
      if (!r.ok) toast.error(r.error)
    })
  }

  return (
    <li className="bg-muted/30 flex flex-col gap-2 rounded-md border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{label}</span>
          {!isActive && (
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
                const r = await onToggle(!isActive)
                if (!r.ok) toast.error(r.error ?? "Failed.")
              })
            }
          >
            {isActive ? "Deactivate" : "Activate"}
          </Button>
        </div>
      </div>
      {editing && editForm}
    </li>
  )
}

function SubtypeForm({ subtype }: { subtype?: SubtypeRow }) {
  const [state, formAction, pending] = useActionState(upsertSubtype, NULL_STATE)
  const [resetKey, setResetKey] = useState(0)
  const [seenState, setSeenState] = useState<typeof state>(state)
  if (state !== seenState) {
    setSeenState(state)
    if (state.ok === true && !subtype) setResetKey((k) => k + 1)
  }
  useEffect(() => {
    if (state.ok === true) {
      toast.success(state.message ?? "Saved.")
    }
    if (state.ok === false) toast.error(state.error)
     
  }, [state])

  return (
    <form
      key={resetKey}
      action={formAction}
      className="flex flex-wrap items-end gap-2"
    >
      {subtype && <input type="hidden" name="id" value={subtype.id} />}
      <input type="hidden" name="asset_type" value="door" />
      <div className="flex min-w-56 flex-1 flex-col gap-1.5">
        <Label htmlFor={`sub-label-${subtype?.id ?? "new"}`}>
          {subtype ? "Label" : "New door subtype"}
        </Label>
        <Input
          id={`sub-label-${subtype?.id ?? "new"}`}
          name="label"
          required
          defaultValue={subtype?.label ?? ""}
          placeholder="e.g. Penalty Box"
        />
      </div>
      <input type="hidden" name="sort_order" value={subtype?.sort_order ?? 100} />
      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : subtype ? "Save" : "Add subtype"}
      </Button>
    </form>
  )
}

function CategoryForm({
  category,
  assetType,
}: {
  category?: IssueCategoryRow
  assetType?: "board_panel" | "glass_panel" | "door"
}) {
  const [state, formAction, pending] = useActionState(
    upsertIssueCategory,
    NULL_STATE,
  )
  const [resetKey, setResetKey] = useState(0)
  const [seenState, setSeenState] = useState<typeof state>(state)
  if (state !== seenState) {
    setSeenState(state)
    if (state.ok === true && !category) setResetKey((k) => k + 1)
  }
  useEffect(() => {
    if (state.ok === true) {
      toast.success(state.message ?? "Saved.")
    }
    if (state.ok === false) toast.error(state.error)
     
  }, [state])

  return (
    <form
      key={resetKey}
      action={formAction}
      className="flex flex-wrap items-end gap-2"
    >
      {category && <input type="hidden" name="id" value={category.id} />}
      <input
        type="hidden"
        name="asset_type"
        value={category?.asset_type ?? assetType}
      />
      <div className="flex min-w-56 flex-1 flex-col gap-1.5">
        <Label htmlFor={`cat-label-${category?.id ?? assetType}`}>
          {category ? "Label" : "New category"}
        </Label>
        <Input
          id={`cat-label-${category?.id ?? assetType}`}
          name="label"
          required
          defaultValue={category?.label ?? ""}
        />
      </div>
      <input
        type="hidden"
        name="sort_order"
        value={category?.sort_order ?? 100}
      />
      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : category ? "Save" : "Add category"}
      </Button>
    </form>
  )
}
