"use client"

import { useState, useTransition } from "react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"

import { deleteIncidentType, setIncidentTypeActive } from "../actions"
import type { IncidentTypeRow } from "../types"

import { IncidentTypeForm } from "./incident-type-form"
import { SeedDefaultsCard } from "./seed-defaults-card"

type Props = {
  types: IncidentTypeRow[]
  hasAnySeverities: boolean
}

export function TypesTab({ types, hasAnySeverities }: Props) {
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<IncidentTypeRow | null>(null)
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [, startTransition] = useTransition()

  function openCreate() {
    setEditing(null)
    setFormOpen(true)
  }

  function openEdit(t: IncidentTypeRow) {
    setEditing(t)
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

  if (types.length === 0) {
    return (
      <>
        <div className="flex flex-col gap-4">
          <SeedDefaultsCard scope="types" />
          {!hasAnySeverities && (
            <p className="text-muted-foreground text-xs">
              Tip: Seeding will install both default types and severities at
              once.
            </p>
          )}
          <div>
            <Button onClick={openCreate} variant="outline">
              Add type manually
            </Button>
          </div>
        </div>
        <IncidentTypeForm
          open={formOpen}
          onOpenChange={setFormOpen}
          editing={editing}
        />
      </>
    )
  }

  const activeCount = types.filter((t) => t.is_active).length

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <Badge variant="secondary">{activeCount} active</Badge>
          <span className="text-muted-foreground text-sm">
            {types.length} total
          </span>
        </div>
        <Button onClick={openCreate}>Add type</Button>
      </div>

      <div className="overflow-auto rounded-md border">
        <table className="w-full border-collapse text-sm">
          <thead className="bg-muted/60 sticky top-0 z-10">
            <tr>
              <th className="border-b px-3 py-2 text-left font-medium">Name</th>
              <th className="border-b px-3 py-2 text-left font-medium">Slug</th>
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
            {types.map((t) => {
              const isPending = pendingId === t.id
              return (
                <tr key={t.id} className="hover:bg-muted/30">
                  <td className="border-b px-3 py-2 align-middle">
                    <div className="flex items-center gap-2">
                      {t.color && (
                        <span
                          aria-hidden
                          className="inline-block size-3 rounded-full"
                          style={{ backgroundColor: t.color }}
                        />
                      )}
                      <span className="font-medium">{t.name}</span>
                    </div>
                  </td>
                  <td className="border-b px-3 py-2 align-middle font-mono text-xs">
                    {t.slug}
                  </td>
                  <td className="text-muted-foreground border-b px-3 py-2 align-middle tabular-nums">
                    {t.sort_order}
                  </td>
                  <td className="border-b px-3 py-2 align-middle">
                    {t.is_active ? (
                      <Badge variant="success">Active</Badge>
                    ) : (
                      <Badge variant="secondary">Inactive</Badge>
                    )}
                  </td>
                  <td className="border-b px-3 py-2 align-middle">
                    <div className="flex items-center justify-end gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => openEdit(t)}
                        disabled={isPending}
                      >
                        Edit
                      </Button>
                      {t.is_active ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            runRowAction(t.id, () =>
                              setIncidentTypeActive(t.id, false),
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
                            runRowAction(t.id, () =>
                              setIncidentTypeActive(t.id, true),
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
                              `Delete type "${t.name}"? This cannot be undone.`,
                            )
                          ) {
                            runRowAction(t.id, () => deleteIncidentType(t.id))
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

      <IncidentTypeForm
        open={formOpen}
        onOpenChange={setFormOpen}
        editing={editing}
      />
    </div>
  )
}
