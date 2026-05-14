"use client"

import Link from "next/link"
import { useActionState, useEffect, useState, useTransition } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"

import { createLayout, setLayoutActive } from "../actions"
import type { ActionState, LayoutDetail, LayoutWithPointCount } from "../types"

import { LayoutEditor } from "./layout-editor"

const NULL_STATE: ActionState = { ok: null }
const LAYOUT_CAP = 8

type Props = {
  layouts: LayoutWithPointCount[]
  activeLayout: LayoutDetail | null
  activeLayoutId: string | null
  backHref: string
}

export function LayoutsTab({
  layouts,
  activeLayout,
  activeLayoutId,
  backHref,
}: Props) {
  const activeCount = layouts.filter((l) => l.is_active).length

  if (activeLayout) {
    return <LayoutEditor detail={activeLayout} backHref={backHref} />
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[20rem_1fr]">
      <div className="flex flex-col gap-3">
        <LayoutsList layouts={layouts} activeLayoutId={activeLayoutId} />
        <CreateLayoutCard activeCount={activeCount} />
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Pick a layout</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-sm">
            {layouts.length === 0
              ? "No layouts yet. Create one on the left, then place points on the rink diagram."
              : "Select a layout from the list to open the point-placement editor."}
          </p>
        </CardContent>
      </Card>
    </div>
  )
}

function LayoutsList({
  layouts,
  activeLayoutId,
}: {
  layouts: LayoutWithPointCount[]
  activeLayoutId: string | null
}) {
  const activeCount = layouts.filter((l) => l.is_active).length
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle>Layouts</CardTitle>
          <span
            className={cn(
              "text-muted-foreground text-xs font-medium",
              activeCount >= LAYOUT_CAP && "text-destructive",
            )}
          >
            {activeCount} / {LAYOUT_CAP} active
          </span>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-1 p-2">
        {layouts.length === 0 ? (
          <p className="text-muted-foreground p-2 text-sm">No layouts yet.</p>
        ) : (
          layouts.map((l) => (
            <LayoutListRow
              key={l.id}
              layout={l}
              active={activeLayoutId === l.id}
            />
          ))
        )}
      </CardContent>
    </Card>
  )
}

function LayoutListRow({
  layout,
  active,
}: {
  layout: LayoutWithPointCount
  active: boolean
}) {
  const [activePending, startActive] = useTransition()

  function onToggleActive() {
    startActive(async () => {
      const r = await setLayoutActive(layout.id, !layout.is_active)
      if (!r.ok) toast.error(r.error)
    })
  }

  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-md text-sm transition-colors",
        active
          ? "bg-primary text-primary-foreground"
          : "hover:bg-accent hover:text-accent-foreground",
      )}
    >
      <Link
        href={`/admin/ice-depth?tab=layouts&layout=${layout.id}`}
        className="flex min-w-0 flex-1 flex-col gap-1 px-3 py-2"
      >
        <div className="flex items-center justify-between gap-2">
          <span className="font-medium">{layout.name}</span>
          <span
            className={cn(
              "rounded-full px-1.5 py-0.5 text-[10px] font-medium",
              active
                ? "bg-primary-foreground/20"
                : "bg-secondary text-secondary-foreground",
            )}
          >
            {layout.active_point_count} pts
          </span>
        </div>
        <span
          className={cn(
            "font-mono text-xs",
            active ? "text-primary-foreground/80" : "text-muted-foreground",
          )}
        >
          {layout.slug}
        </span>
      </Link>
      <button
        type="button"
        onClick={onToggleActive}
        disabled={activePending}
        className={cn(
          "mr-3 shrink-0 rounded-md border px-2 py-0.5 text-[11px] font-medium transition-colors",
          active
            ? "border-primary-foreground/30 hover:bg-primary-foreground/10"
            : layout.is_active
              ? "border-input hover:bg-background"
              : "border-input bg-muted",
        )}
      >
        {layout.is_active ? "Active" : "Off"}
      </button>
    </div>
  )
}

function CreateLayoutCard({ activeCount }: { activeCount: number }) {
  const [state, action, pending] = useActionState(createLayout, NULL_STATE)
  const [open, setOpen] = useState(false)
  const capReached = activeCount >= LAYOUT_CAP

  useEffect(() => {
    if (state.ok === true) toast.success(state.message ?? "Layout created.")
    if (state.ok === false) toast.error(state.error)
  }, [state])

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle>New layout</CardTitle>
          <Button
            size="sm"
            variant={open ? "outline" : "default"}
            onClick={() => setOpen((v) => !v)}
            disabled={capReached && !open}
          >
            {open ? "Cancel" : "New"}
          </Button>
        </div>
      </CardHeader>
      {open && (
        <CardContent>
          <form action={action} className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <Label htmlFor="nl-name">Name</Label>
              <Input
                id="nl-name"
                name="name"
                required
                placeholder="e.g. Main Rink"
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="nl-slug">
                Slug{" "}
                <span className="text-muted-foreground font-normal">
                  (optional)
                </span>
              </Label>
              <Input
                id="nl-slug"
                name="slug"
                placeholder="auto from name"
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="nl-desc">Description</Label>
              <Textarea
                id="nl-desc"
                name="description"
                rows={2}
                placeholder="optional"
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="nl-aspect">Aspect ratio</Label>
              <Input
                id="nl-aspect"
                name="diagram_aspect_ratio"
                type="number"
                step="0.001"
                min="0.05"
                max="10"
                defaultValue={0.425}
                className="w-32"
              />
              <p className="text-muted-foreground text-xs">
                Width / height. Default 0.425 ≈ vertical NHL rink.
              </p>
            </div>
            {capReached && (
              <p className="text-destructive text-xs">
                Maximum {LAYOUT_CAP} active layouts reached. Deactivate one to
                create another.
              </p>
            )}
            <div>
              <Button type="submit" size="sm" disabled={pending}>
                {pending ? "Creating…" : "Create layout"}
              </Button>
            </div>
          </form>
        </CardContent>
      )}
    </Card>
  )
}
