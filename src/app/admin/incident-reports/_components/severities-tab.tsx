"use client"

import { useState, useTransition } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"

import { deleteSeverityLevel, setSeverityLevelActive } from "../actions"
import type { SeverityRow } from "../types"

import { SeedDefaultsCard } from "./seed-defaults-card"
import { SeverityForm } from "./severity-form"

type Props = {
  severities: SeverityRow[]
  hasAnyTypes: boolean
}

export function SeveritiesTab({ severities, hasAnyTypes }: Props) {
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<SeverityRow | null>(null)
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [, startTransition] = useTransition()

  function openCreate() {
    setEditing(null)
    setFormOpen(true)
  }

  function openEdit(s: SeverityRow) {
    setEditing(s)
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

  if (severities.length === 0) {
    return (
      <>
        <div className="flex flex-col gap-4">
          <SeedDefaultsCard scope="severities" />
          {!hasAnyTypes && (
            <p className="text-muted-foreground text-xs">
              Tip: Seeding will install both default types and severities at
              once.
            </p>
          )}
          <div>
            <Button onClick={openCreate} variant="outline">
              Add severity manually
            </Button>
          </div>
        </div>
        <SeverityForm
          open={formOpen}
          onOpenChange={setFormOpen}
          editing={editing}
        />
      </>
    )
  }

  const activeCount = severities.filter((s) => s.is_active).length

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <span className="bg-secondary text-secondary-foreground inline-flex items-center rounded-full px-3 py-1 text-sm font-medium">
            {activeCount} active
          </span>
          <span className="text-muted-foreground text-sm">
            {severities.length} total
          </span>
        </div>
        <Button onClick={openCreate}>Add severity</Button>
      </div>

      <div className="overflow-auto rounded-md border">
        <table className="w-full border-collapse text-sm">
          <thead className="bg-muted/60 sticky top-0 z-10">
            <tr>
              <th className="border-b px-3 py-2 text-left font-medium">
                Display name
              </th>
              <th className="border-b px-3 py-2 text-left font-medium">Key</th>
              <th className="border-b px-3 py-2 text-left font-medium">
                Order
              </th>
              <th className="border-b px-3 py-2 text-left font-medium">
                Status
              </th>
              <th className="border-b px-3 py-2 text-right font-medium">
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {severities.map((s) => {
              const isPending = pendingId === s.id
              return (
                <tr key={s.id} className="hover:bg-muted/30">
                  <td className="border-b px-3 py-2 align-middle">
                    <div className="flex items-center gap-2">
                      {s.color && (
                        <span
                          aria-hidden
                          className="inline-block size-3 rounded-full"
                          style={{ backgroundColor: s.color }}
                        />
                      )}
                      <span className="font-medium">{s.display_name}</span>
                    </div>
                  </td>
                  <td className="border-b px-3 py-2 align-middle font-mono text-xs">
                    {s.key}
                  </td>
                  <td className="text-muted-foreground border-b px-3 py-2 align-middle tabular-nums">
                    {s.sort_order}
                  </td>
                  <td className="border-b px-3 py-2 align-middle">
                    {s.is_active ? (
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
                        onClick={() => openEdit(s)}
                        disabled={isPending}
                      >
                        Edit
                      </Button>
                      {s.is_active ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            runRowAction(s.id, () =>
                              setSeverityLevelActive(s.id, false),
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
                            runRowAction(s.id, () =>
                              setSeverityLevelActive(s.id, true),
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
                              `Delete severity "${s.display_name}"? This cannot be undone.`,
                            )
                          ) {
                            runRowAction(s.id, () =>
                              deleteSeverityLevel(s.id),
                            )
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

      <SeverityForm
        open={formOpen}
        onOpenChange={setFormOpen}
        editing={editing}
      />
    </div>
  )
}
