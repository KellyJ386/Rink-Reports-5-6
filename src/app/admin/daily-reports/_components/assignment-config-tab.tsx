"use client"

// Admin Control Center: daily-report assignment routing config (Phase 4).
// Three concerns, all admin-gated server-side (assignment-config-actions.ts)
// and by RLS:
//   1. the per-facility routing flag + pre-lock warning threshold,
//   2. standing default owners per area (multi-select, D2),
//   3. the area <-> scheduling job-area bridge feeding the schedule branch of
//      the resolution engine (published shifts only).

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { ChevronDown } from "lucide-react"
import { toast } from "sonner"

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
import { Switch } from "@/components/ui/switch"
import { cn } from "@/lib/utils"

import {
  setAreaDefaultOwners,
  setAreaJobAreaMap,
  updateAssignmentSettings,
} from "../assignment-config-actions"

export type AssignmentConfigArea = {
  id: string
  name: string
  color: string | null
}

export type AssignmentConfigProps = {
  settings: { enabled: boolean; prelockWarningMinutes: number }
  areas: AssignmentConfigArea[]
  employees: { id: string; name: string }[]
  jobAreas: { id: string; name: string }[]
  /** areaId -> employeeIds with a standing default-owner row. */
  defaultOwners: Record<string, string[]>
  /** areaId -> jobAreaIds bridged to that area. */
  jobAreaMap: Record<string, string[]>
}

function CheckboxPicker({
  options,
  selected,
  onToggle,
  emptyLabel,
  idPrefix,
}: {
  options: { id: string; name: string }[]
  selected: Set<string>
  onToggle: (id: string, checked: boolean) => void
  emptyLabel: string
  idPrefix: string
}) {
  if (options.length === 0) {
    return <p className="text-sm text-muted-foreground">{emptyLabel}</p>
  }
  return (
    <ul className="max-h-52 overflow-y-auto rounded-lg border bg-background">
      {options.map((o) => (
        <li key={o.id} className="border-b last:border-b-0">
          <label
            htmlFor={`${idPrefix}-${o.id}`}
            className="flex cursor-pointer items-center gap-3 px-3 py-2"
          >
            <input
              id={`${idPrefix}-${o.id}`}
              type="checkbox"
              checked={selected.has(o.id)}
              onChange={(e) => onToggle(o.id, e.target.checked)}
              className="size-4 shrink-0 cursor-pointer rounded border-input accent-primary"
            />
            <span className="text-sm">{o.name}</span>
          </label>
        </li>
      ))}
    </ul>
  )
}

function AreaConfigCard({
  area,
  employees,
  jobAreas,
  initialOwners,
  initialJobAreas,
}: {
  area: AssignmentConfigArea
  employees: { id: string; name: string }[]
  jobAreas: { id: string; name: string }[]
  initialOwners: string[]
  initialJobAreas: string[]
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [owners, setOwners] = useState<Set<string>>(() => new Set(initialOwners))
  const [mapped, setMapped] = useState<Set<string>>(
    () => new Set(initialJobAreas),
  )
  const [pending, startTransition] = useTransition()

  const summary = [
    initialOwners.length > 0
      ? `${initialOwners.length} default owner${initialOwners.length === 1 ? "" : "s"}`
      : "no default owners",
    initialJobAreas.length > 0
      ? `${initialJobAreas.length} schedule position${initialJobAreas.length === 1 ? "" : "s"}`
      : "no schedule positions",
  ].join(" · ")

  function save() {
    startTransition(async () => {
      const [ownersResult, mapResult] = await Promise.all([
        setAreaDefaultOwners({ areaId: area.id, employeeIds: [...owners] }),
        setAreaJobAreaMap({ areaId: area.id, jobAreaIds: [...mapped] }),
      ])
      const failed = [ownersResult, mapResult].find((r) => !r.ok)
      if (failed && !failed.ok) {
        toast.error(failed.error)
        return
      }
      toast.success(`${area.name} routing config saved.`)
      router.refresh()
    })
  }

  return (
    <Card className="gap-0 py-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--accent-brand)]/45"
      >
        <span className="flex min-w-0 items-center gap-2">
          {area.color ? (
            <span
              aria-hidden
              className="inline-block size-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: area.color }}
            />
          ) : null}
          <span className="truncate text-sm font-semibold">{area.name}</span>
        </span>
        <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
          {summary}
          <ChevronDown
            aria-hidden
            className={cn("h-4 w-4 transition-transform", !open && "-rotate-90")}
          />
        </span>
      </button>
      {open ? (
        <div className="grid gap-5 border-t px-5 py-4 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <span className="text-sm font-semibold text-muted-foreground">
              Default owners
            </span>
            <p className="text-xs text-muted-foreground">
              Standing fallback when no manual or schedule-derived assignment
              exists for the day.
            </p>
            <CheckboxPicker
              idPrefix={`own-${area.id}`}
              options={employees}
              selected={owners}
              onToggle={(id, checked) =>
                setOwners((prev) => {
                  const next = new Set(prev)
                  if (checked) next.add(id)
                  else next.delete(id)
                  return next
                })
              }
              emptyLabel="No active employees."
            />
          </div>
          <div className="flex flex-col gap-2">
            <span className="text-sm font-semibold text-muted-foreground">
              Schedule positions
            </span>
            <p className="text-xs text-muted-foreground">
              Employees on a published shift in these job areas are assigned
              here automatically.
            </p>
            <CheckboxPicker
              idPrefix={`job-${area.id}`}
              options={jobAreas}
              selected={mapped}
              onToggle={(id, checked) =>
                setMapped((prev) => {
                  const next = new Set(prev)
                  if (checked) next.add(id)
                  else next.delete(id)
                  return next
                })
              }
              emptyLabel="No scheduling job areas visible. Job areas are configured under Admin → Scheduling, and mapping them requires the scheduling view permission."
            />
          </div>
          <div className="sm:col-span-2">
            <Button type="button" size="sm" onClick={save} disabled={pending}>
              {pending ? "Saving…" : "Save area config"}
            </Button>
          </div>
        </div>
      ) : null}
    </Card>
  )
}

export function AssignmentConfigTab(props: AssignmentConfigProps) {
  const router = useRouter()
  const [enabled, setEnabled] = useState(props.settings.enabled)
  const [threshold, setThreshold] = useState(
    String(props.settings.prelockWarningMinutes),
  )
  const [pending, startTransition] = useTransition()

  function saveSettings() {
    const minutes = Number.parseInt(threshold, 10)
    if (Number.isNaN(minutes) || minutes < 5 || minutes > 720) {
      toast.error("Warning threshold must be between 5 and 720 minutes.")
      return
    }
    startTransition(async () => {
      const result = await updateAssignmentSettings({
        enabled,
        prelockWarningMinutes: minutes,
      })
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      toast.success(
        enabled ? "Assignment routing enabled." : "Assignment routing disabled.",
      )
      router.refresh()
    })
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Assignment routing</CardTitle>
          <CardDescription>
            When enabled, daily-report areas are routed to assignees each day
            (manual override → published schedule → default owners → open).
            Staff see only their assigned areas plus open areas; managers and
            admins are unaffected. Turning this off restores open-report
            behavior instantly.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex items-center justify-between gap-4">
            <Label htmlFor="routing-enabled" className="text-sm font-medium">
              Enable area assignment routing
            </Label>
            <Switch
              id="routing-enabled"
              checked={enabled}
              onCheckedChange={setEnabled}
              disabled={pending}
            />
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="prelock-minutes" className="text-sm font-medium">
                Pre-close warning (minutes)
              </Label>
              <Input
                id="prelock-minutes"
                type="number"
                min={5}
                max={720}
                value={threshold}
                onChange={(e) => setThreshold(e.target.value)}
                className="w-32"
              />
              <p className="text-xs text-muted-foreground">
                How long before end of day the supervisor view flags
                incomplete assigned areas.
              </p>
            </div>
            <Button
              type="button"
              size="sm"
              onClick={saveSettings}
              disabled={pending}
            >
              {pending ? "Saving…" : "Save settings"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
          Per-area routing
        </h2>
        {props.areas.length === 0 ? (
          <Card className="py-6">
            <p className="px-6 text-sm text-muted-foreground">
              No active areas. Create areas first under the Areas tab.
            </p>
          </Card>
        ) : (
          props.areas.map((area) => (
            <AreaConfigCard
              key={area.id}
              area={area}
              employees={props.employees}
              jobAreas={props.jobAreas}
              initialOwners={props.defaultOwners[area.id] ?? []}
              initialJobAreas={props.jobAreaMap[area.id] ?? []}
            />
          ))
        )}
      </div>
    </div>
  )
}
