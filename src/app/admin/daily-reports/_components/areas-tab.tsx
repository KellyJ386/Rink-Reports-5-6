"use client"

import { useRouter } from "next/navigation"
import { useMemo, useState, useTransition } from "react"
import { toast } from "sonner"

import {
  BulkUploadPanel,
  type ImportSchema,
} from "@/components/admin/bulk-upload"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

import { deleteArea, importAreas, reorderArea, setAreaActive } from "../actions"
import type { AreaRow } from "../types"

import { areasImportSpec } from "./areas-import"
import { AreaForm } from "./area-form"

type Props = {
  areas: AreaRow[]
}

export function AreasTab({ areas }: Props) {
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<AreaRow | null>(null)
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [, startTransition] = useTransition()

  const router = useRouter()
  const activeCount = areas.filter((a) => a.is_active).length
  const atCap = activeCount >= 30

  const importSchema = useMemo<ImportSchema>(
    () => ({
      ...areasImportSpec,
      onImport: (rows) => importAreas(rows),
    }),
    [],
  )

  function openCreate() {
    setEditing(null)
    setFormOpen(true)
  }

  function openEdit(area: AreaRow) {
    setEditing(area)
    setFormOpen(true)
  }

  function runRowAction(
    id: string,
    fn: () => Promise<{ ok: boolean; error?: string }>,
  ) {
    setPendingId(id)
    startTransition(async () => {
      const r = await fn()
      if (!r.ok) {
        toast.error(r.error ?? "Action failed.")
      }
      setPendingId(null)
    })
  }

  function move(area: AreaRow, direction: -1 | 1) {
    runRowAction(area.id, () =>
      reorderArea(area.id, area.sort_order + direction),
    )
  }

  if (areas.length === 0) {
    return (
      <>
        <Card>
          <CardHeader>
            <CardTitle>Create your first daily report area</CardTitle>
            <CardDescription>
              Areas are the tabs that staff see on the Daily Reports page (e.g.
              &ldquo;Ice Resurfacer Room&rdquo;, &ldquo;Locker Rooms&rdquo;,
              &ldquo;Concessions&rdquo;). You can create up to 30 active areas.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              <Button onClick={openCreate}>Add area</Button>
              <BulkUploadPanel
                schema={importSchema}
                triggerLabel="Bulk upload areas"
                onImported={() => router.refresh()}
              />
            </div>
          </CardContent>
        </Card>
        <AreaForm
          open={formOpen}
          onOpenChange={setFormOpen}
          editing={editing}
        />
      </>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <Badge variant={atCap ? "warning" : "secondary"}>
            {activeCount} / 30 active
          </Badge>
          <span className="text-muted-foreground text-sm">
            {areas.length} total
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <BulkUploadPanel
            schema={importSchema}
            triggerLabel="Bulk upload areas"
            onImported={() => router.refresh()}
          />
          <Button onClick={openCreate} disabled={atCap}>
            {atCap ? "Cap reached" : "Add area"}
          </Button>
        </div>
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
            {areas.map((a) => {
              const isPending = pendingId === a.id
              return (
                <tr key={a.id} className="hover:bg-muted/30">
                  <td className="border-b px-3 py-2 align-middle">
                    <div className="flex items-center gap-2">
                      {a.color && (
                        <span
                          aria-hidden
                          className="inline-block size-3 rounded-full"
                          style={{ backgroundColor: a.color }}
                        />
                      )}
                      <span className="font-medium">{a.name}</span>
                    </div>
                  </td>
                  <td className="border-b px-3 py-2 align-middle font-mono text-xs">
                    {a.slug}
                  </td>
                  <td className="border-b px-3 py-2 align-middle">
                    <div className="flex items-center gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => move(a, -1)}
                        disabled={isPending}
                        aria-label="Move up"
                      >
                        ↑
                      </Button>
                      <span className="text-muted-foreground tabular-nums">
                        {a.sort_order}
                      </span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => move(a, 1)}
                        disabled={isPending}
                        aria-label="Move down"
                      >
                        ↓
                      </Button>
                    </div>
                  </td>
                  <td className="border-b px-3 py-2 align-middle">
                    {a.is_active ? (
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
                        onClick={() => openEdit(a)}
                        disabled={isPending}
                      >
                        Edit
                      </Button>
                      {a.is_active ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            runRowAction(a.id, () =>
                              setAreaActive(a.id, false),
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
                            runRowAction(a.id, () =>
                              setAreaActive(a.id, true),
                            )
                          }
                          disabled={isPending || atCap}
                          title={
                            atCap
                              ? "30-area cap reached"
                              : undefined
                          }
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
                              `Delete area "${a.name}"? Templates and items will be deleted. This will fail if any submissions exist.`,
                            )
                          ) {
                            runRowAction(a.id, () => deleteArea(a.id))
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

      <AreaForm
        open={formOpen}
        onOpenChange={setFormOpen}
        editing={editing}
      />
    </div>
  )
}
