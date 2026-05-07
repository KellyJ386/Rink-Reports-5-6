"use client"

import Link from "next/link"
import { useState, useTransition } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

import { deleteDropdown, setDropdownActive } from "../actions"
import {
  DROPDOWN_CATEGORIES,
  DROPDOWN_CATEGORY_LABELS,
  type AccidentDropdownRow,
  type DropdownCategory,
} from "../types"

import { DropdownForm } from "./dropdown-form"
import { SeedDefaultsCard } from "./seed-defaults-card"

type Props = {
  category: DropdownCategory
  rows: AccidentDropdownRow[]
  totalCount: number
  countsByCategory: Record<DropdownCategory, number>
}

function categoryHref(c: DropdownCategory): string {
  const sp = new URLSearchParams()
  sp.set("tab", "dropdowns")
  sp.set("category", c)
  return `/admin/accident-reports?${sp.toString()}`
}

function readTriggersAlert(metadata: unknown): boolean {
  if (
    metadata &&
    typeof metadata === "object" &&
    "triggers_alert" in (metadata as Record<string, unknown>)
  ) {
    return Boolean(
      (metadata as Record<string, unknown>).triggers_alert,
    )
  }
  return false
}

export function DropdownsTab({
  category,
  rows,
  totalCount,
  countsByCategory,
}: Props) {
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<AccidentDropdownRow | null>(null)
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [, startTransition] = useTransition()

  function openCreate() {
    setEditing(null)
    setFormOpen(true)
  }

  function openEdit(d: AccidentDropdownRow) {
    setEditing(d)
    setFormOpen(true)
  }

  function runRowAction(
    id: string,
    fn: () => Promise<{ ok: boolean; error?: string }>,
  ) {
    setPendingId(id)
    startTransition(async () => {
      const r = await fn()
      if (!r.ok) toast.error(r.error ?? "Action failed.")
      setPendingId(null)
    })
  }

  if (totalCount === 0) {
    return (
      <div className="flex flex-col gap-4">
        <SeedDefaultsCard />
        <div>
          <Button onClick={openCreate} variant="outline">
            Add value manually
          </Button>
        </div>
        <DropdownForm
          open={formOpen}
          onOpenChange={setFormOpen}
          category={category}
          editing={editing}
        />
      </div>
    )
  }

  const activeCount = rows.filter((r) => r.is_active).length
  const isMedicalAttention = category === "medical_attention"

  return (
    <div className="flex flex-col gap-4">
      <CategoryNav active={category} counts={countsByCategory} />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <span className="bg-secondary text-secondary-foreground inline-flex items-center rounded-full px-3 py-1 text-sm font-medium">
            {activeCount} active
          </span>
          <span className="text-muted-foreground text-sm">
            {rows.length} total in {DROPDOWN_CATEGORY_LABELS[category]}
          </span>
        </div>
        <Button onClick={openCreate}>
          Add {DROPDOWN_CATEGORY_LABELS[category].toLowerCase()} value
        </Button>
      </div>

      {rows.length === 0 ? (
        <div className="bg-muted/30 rounded-md border p-6 text-sm">
          <p className="font-medium">
            No {DROPDOWN_CATEGORY_LABELS[category].toLowerCase()} values yet.
          </p>
          <p className="text-muted-foreground mt-1">
            Add one above, or seed defaults from a category that&apos;s empty.
          </p>
        </div>
      ) : (
        <div className="overflow-auto rounded-md border">
          <table className="w-full border-collapse text-sm">
            <thead className="bg-muted/60 sticky top-0 z-10">
              <tr>
                <th className="border-b px-3 py-2 text-left font-medium">
                  Display name
                </th>
                <th className="border-b px-3 py-2 text-left font-medium">
                  Key
                </th>
                <th className="border-b px-3 py-2 text-left font-medium">
                  Order
                </th>
                {isMedicalAttention && (
                  <th className="border-b px-3 py-2 text-left font-medium">
                    Alert
                  </th>
                )}
                <th className="border-b px-3 py-2 text-left font-medium">
                  Status
                </th>
                <th className="border-b px-3 py-2 text-right font-medium">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((d) => {
                const isPending = pendingId === d.id
                const triggersAlert = readTriggersAlert(d.metadata)
                return (
                  <tr key={d.id} className="hover:bg-muted/30">
                    <td className="border-b px-3 py-2 align-middle">
                      <div className="flex items-center gap-2">
                        {d.color && (
                          <span
                            aria-hidden
                            className="inline-block size-3 rounded-full"
                            style={{ backgroundColor: d.color }}
                          />
                        )}
                        <span className="font-medium">{d.display_name}</span>
                      </div>
                    </td>
                    <td className="border-b px-3 py-2 align-middle font-mono text-xs">
                      {d.key}
                    </td>
                    <td className="text-muted-foreground border-b px-3 py-2 align-middle tabular-nums">
                      {d.sort_order}
                    </td>
                    {isMedicalAttention && (
                      <td className="border-b px-3 py-2 align-middle">
                        {triggersAlert ? (
                          <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900 dark:bg-amber-900/40 dark:text-amber-100">
                            Triggers alert
                          </span>
                        ) : (
                          <span className="text-muted-foreground text-xs">
                            —
                          </span>
                        )}
                      </td>
                    )}
                    <td className="border-b px-3 py-2 align-middle">
                      {d.is_active ? (
                        <span className="inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200">
                          Active
                        </span>
                      ) : (
                        <span className="bg-muted text-muted-foreground inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium">
                          Inactive
                        </span>
                      )}
                    </td>
                    <td className="border-b px-3 py-2 align-middle">
                      <div className="flex items-center justify-end gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => openEdit(d)}
                          disabled={isPending}
                        >
                          Edit
                        </Button>
                        {d.is_active ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              runRowAction(d.id, () =>
                                setDropdownActive(d.id, false),
                              )
                            }
                            disabled={isPending}
                          >
                            Deactivate
                          </Button>
                        ) : (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              runRowAction(d.id, () =>
                                setDropdownActive(d.id, true),
                              )
                            }
                            disabled={isPending}
                          >
                            Reactivate
                          </Button>
                        )}
                        <Button
                          type="button"
                          variant="destructive"
                          size="sm"
                          onClick={() => {
                            if (
                              window.confirm(
                                `Delete "${d.display_name}"? This cannot be undone.`,
                              )
                            ) {
                              runRowAction(d.id, () => deleteDropdown(d.id))
                            }
                          }}
                          disabled={isPending}
                        >
                          Delete
                        </Button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <DropdownForm
        open={formOpen}
        onOpenChange={setFormOpen}
        category={category}
        editing={editing}
      />
    </div>
  )
}

function CategoryNav({
  active,
  counts,
}: {
  active: DropdownCategory
  counts: Record<DropdownCategory, number>
}) {
  return (
    <nav className="flex flex-wrap items-center gap-1 rounded-md border p-1">
      {DROPDOWN_CATEGORIES.map((c) => (
        <Link
          key={c}
          href={categoryHref(c)}
          className={cn(
            "rounded px-3 py-1.5 text-sm font-medium transition-colors",
            active === c
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
          )}
        >
          {DROPDOWN_CATEGORY_LABELS[c]}
          <span
            className={cn(
              "ml-1.5 inline-flex items-center justify-center rounded-full px-1.5 py-0.5 text-[10px] font-medium tabular-nums",
              active === c
                ? "bg-primary-foreground/20 text-primary-foreground"
                : "bg-muted text-muted-foreground",
            )}
          >
            {counts[c] ?? 0}
          </span>
        </Link>
      ))}
    </nav>
  )
}
