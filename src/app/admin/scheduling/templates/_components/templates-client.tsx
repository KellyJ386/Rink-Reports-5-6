"use client"

import { useCallback, useState, useTransition } from "react"
import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

import { DAY_NAMES, DAY_SHORT } from "../../_lib/datetime"
import type {
  DepartmentLite,
  JobAreaLite,
  TemplateRow,
  TemplateShiftRow,
} from "../../_lib/types"
import {
  deleteTemplate,
  setTemplateActive,
} from "../../_lib/admin-core-actions"
import { TemplateForm } from "./template-form"
import { TemplateShiftForm } from "./template-shift-form"
import { toast } from "sonner"

type Props = {
  templates: TemplateRow[]
  departments: DepartmentLite[]
  jobAreas: JobAreaLite[]
  selected: TemplateRow | null
  selectedShifts: TemplateShiftRow[]
}

type Panel = "none" | "new-template" | "edit-template"

export function TemplatesClient(props: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [panel, setPanel] = useState<Panel>("none")
  const [editingShiftId, setEditingShiftId] = useState<string | "new" | null>(
    null
  )
  const [pending, start] = useTransition()

  const buildHref = useCallback(
    (overrides: Record<string, string | null | undefined>) => {
      const sp = new URLSearchParams(searchParams.toString())
      for (const [k, v] of Object.entries(overrides)) {
        if (v === null || v === undefined || v === "") sp.delete(k)
        else sp.set(k, v)
      }
      const qs = sp.toString()
      return qs ? `${pathname}?${qs}` : pathname
    },
    [pathname, searchParams]
  )

  const onTemplateSaved = useCallback(() => {
    setPanel("none")
    router.refresh()
  }, [router])

  const onShiftSaved = useCallback(() => {
    setEditingShiftId(null)
    router.refresh()
  }, [router])

  if (props.templates.length === 0 && panel !== "new-template") {
    return (
      <div className="flex flex-col gap-4">
        <div className="bg-card rounded-md border p-8 text-center">
          <h3 className="text-lg font-medium">No templates yet</h3>
          <p className="text-muted-foreground mt-1 text-sm">
            Templates let you stamp out a week of recurring shifts.
          </p>
          <div className="mt-4">
            <Button onClick={() => setPanel("new-template")}>
              Add template
            </Button>
          </div>
        </div>
      </div>
    )
  }

  const selectedShift =
    typeof editingShiftId === "string" && editingShiftId !== "new"
      ? props.selectedShifts.find((s) => s.id === editingShiftId) ?? null
      : null

  return (
    <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
      <aside className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium">Templates</h2>
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              setPanel((p) => (p === "new-template" ? "none" : "new-template"))
            }
          >
            {panel === "new-template" ? "Close" : "Add"}
          </Button>
        </div>
        <ul className="bg-card flex flex-col gap-1 rounded-md border p-1">
          {props.templates.map((t) => (
            <li key={t.id}>
              <Link
                href={buildHref({ template: t.id })}
                scroll={false}
                className={cn(
                  "flex items-center justify-between gap-2 rounded px-2 py-1.5 text-sm",
                  props.selected?.id === t.id
                    ? "bg-primary text-primary-foreground"
                    : "hover:bg-accent"
                )}
              >
                <span className="truncate">{t.name}</span>
                {!t.is_active && (
                  <span className="text-muted-foreground text-xs">
                    inactive
                  </span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      </aside>

      <section className="flex flex-col gap-4">
        {panel === "new-template" && (
          <TemplateForm
            editing={null}
            onClose={() => setPanel("none")}
            onSaved={onTemplateSaved}
          />
        )}

        {props.selected ? (
          <>
            <div className="bg-card flex flex-col gap-3 rounded-md border p-4 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h2 className="text-lg font-medium">{props.selected.name}</h2>
                  <p className="text-muted-foreground text-xs">
                    /{props.selected.slug}
                    {props.selected.description ? ` • ${props.selected.description}` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      setPanel((p) =>
                        p === "edit-template" ? "none" : "edit-template"
                      )
                    }
                  >
                    {panel === "edit-template" ? "Close" : "Edit"}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={pending}
                    onClick={() =>
                      start(async () => {
                        if (!props.selected) return
                        const res = await setTemplateActive(
                          props.selected.id,
                          !props.selected.is_active
                        )
                        if (res.ok === false) toast.error(res.error)
                        else router.refresh()
                      })
                    }
                  >
                    {props.selected.is_active ? "Deactivate" : "Activate"}
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={pending}
                    onClick={() => {
                      if (!confirm("Delete this template? Its slots will be removed.")) {
                        return
                      }
                      start(async () => {
                        if (!props.selected) return
                        const res = await deleteTemplate(props.selected.id)
                        if (res.ok === false) toast.error(res.error)
                        else {
                          toast.success("Template deleted.")
                          router.replace(buildHref({ template: null }), {
                            scroll: false,
                          })
                          router.refresh()
                        }
                      })
                    }}
                  >
                    Delete
                  </Button>
                </div>
              </div>
            </div>

            {panel === "edit-template" && (
              <TemplateForm
                editing={props.selected}
                onClose={() => setPanel("none")}
                onSaved={onTemplateSaved}
              />
            )}

            <div className="bg-card flex flex-col gap-3 rounded-md border p-4 shadow-sm">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium">Slots by day</h3>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    setEditingShiftId((s) => (s === "new" ? null : "new"))
                  }
                >
                  {editingShiftId === "new" ? "Close" : "Add slot"}
                </Button>
              </div>

              {editingShiftId === "new" && (
                <TemplateShiftForm
                  templateId={props.selected.id}
                  departments={props.departments}
                  jobAreas={props.jobAreas}
                  editing={null}
                  onClose={() => setEditingShiftId(null)}
                  onSaved={onShiftSaved}
                />
              )}

              {selectedShift && (
                <TemplateShiftForm
                  templateId={props.selected.id}
                  departments={props.departments}
                  jobAreas={props.jobAreas}
                  editing={selectedShift}
                  onClose={() => setEditingShiftId(null)}
                  onSaved={onShiftSaved}
                />
              )}

              <DaySlotList
                shifts={props.selectedShifts}
                departments={props.departments}
                onEdit={(id) => setEditingShiftId(id)}
                editingId={
                  typeof editingShiftId === "string" && editingShiftId !== "new"
                    ? editingShiftId
                    : null
                }
              />
            </div>
          </>
        ) : (
          <div className="bg-card rounded-md border p-8 text-center">
            <h3 className="text-lg font-medium">Select a template</h3>
            <p className="text-muted-foreground mt-1 text-sm">
              Pick one from the list to see its weekly slots.
            </p>
          </div>
        )}
      </section>
    </div>
  )
}

function DaySlotList({
  shifts,
  departments,
  onEdit,
  editingId,
}: {
  shifts: TemplateShiftRow[]
  departments: DepartmentLite[]
  onEdit: (id: string) => void
  editingId: string | null
}) {
  const deptById = new Map(departments.map((d) => [d.id, d]))

  const byDay = new Array<TemplateShiftRow[]>(7).fill(null as never).map(
    () => [] as TemplateShiftRow[]
  )
  for (const s of shifts) byDay[s.day_of_week]?.push(s)

  return (
    <div className="grid gap-2">
      {byDay.map((rows, dow) => (
        <div key={dow} className="rounded border p-2">
          <div className="flex items-baseline justify-between">
            <h4 className="text-sm font-medium">{DAY_NAMES[dow]}</h4>
            <span className="text-muted-foreground text-xs">
              {DAY_SHORT[dow]}
            </span>
          </div>
          {rows.length === 0 ? (
            <p className="text-muted-foreground mt-1 text-xs">No slots</p>
          ) : (
            <ul className="mt-1 flex flex-col gap-1">
              {rows.map((row) => {
                const dept = row.department_id ? deptById.get(row.department_id) : undefined
                return (
                  <li key={row.id}>
                    <button
                      type="button"
                      onClick={() => onEdit(row.id)}
                      className={cn(
                        "hover:bg-accent flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-sm",
                        editingId === row.id && "bg-accent"
                      )}
                    >
                      <span className="tabular-nums">
                        {row.start_time.slice(0, 5)}–{row.end_time.slice(0, 5)}
                      </span>
                      <span className="text-muted-foreground truncate text-xs">
                        {dept?.name ?? "?"} • {row.role_label ?? "any"} •{" "}
                        {row.staff_count}×
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      ))}
    </div>
  )
}
