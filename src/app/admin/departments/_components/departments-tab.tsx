"use client"

import { useState, useTransition } from "react"
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

import { reorderDepartment, setDepartmentActive } from "../actions"
import type { DepartmentRow } from "../types"

import { DepartmentForm } from "./department-form"

type Props = {
  departments: DepartmentRow[]
}

export function DepartmentsTab({ departments }: Props) {
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<DepartmentRow | null>(null)
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [, startTransition] = useTransition()

  const activeCount = departments.filter((d) => d.is_active).length

  function openCreate() {
    setEditing(null)
    setFormOpen(true)
  }

  function openEdit(dept: DepartmentRow) {
    setEditing(dept)
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

  function move(dept: DepartmentRow, direction: -1 | 1) {
    runRowAction(dept.id, () =>
      reorderDepartment(dept.id, dept.sort_order + direction),
    )
  }

  if (departments.length === 0) {
    return (
      <>
        <Card>
          <CardHeader>
            <CardTitle>Create your first department</CardTitle>
            <CardDescription>
              Departments group your facility&rsquo;s shifts (e.g. &ldquo;Ice
              Crew&rdquo;, &ldquo;Front Desk&rdquo;, &ldquo;Concessions&rdquo;).
              Once added, they appear in the Employee Schedule department filter
              and shift assignment.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={openCreate}>Add department</Button>
          </CardContent>
        </Card>
        <DepartmentForm
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
          <Badge variant="success">{activeCount} active</Badge>
          <span className="text-muted-foreground text-sm">
            {departments.length} total
          </span>
        </div>
        <Button onClick={openCreate}>Add department</Button>
      </div>

      <div className="overflow-auto rounded-md border">
        <table className="w-full border-collapse text-sm">
          <thead className="bg-muted/60 sticky top-0 z-10">
            <tr>
              <th className="border-b px-3 py-2 text-left font-medium">Name</th>
              <th className="border-b px-3 py-2 text-left font-medium">Slug</th>
              <th className="border-b px-3 py-2 text-left font-medium">Order</th>
              <th className="border-b px-3 py-2 text-left font-medium">
                Status
              </th>
              <th className="border-b px-3 py-2 text-right font-medium">
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {departments.map((d) => {
              const isPending = pendingId === d.id
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
                      <span className="font-medium">{d.name}</span>
                    </div>
                  </td>
                  <td className="border-b px-3 py-2 align-middle font-mono text-xs">
                    {d.slug}
                  </td>
                  <td className="border-b px-3 py-2 align-middle">
                    <div className="flex items-center gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => move(d, -1)}
                        disabled={isPending}
                        aria-label="Move up"
                      >
                        ↑
                      </Button>
                      <span className="text-muted-foreground tabular-nums">
                        {d.sort_order}
                      </span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => move(d, 1)}
                        disabled={isPending}
                        aria-label="Move down"
                      >
                        ↓
                      </Button>
                    </div>
                  </td>
                  <td className="border-b px-3 py-2 align-middle">
                    {d.is_active ? (
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
                              setDepartmentActive(d.id, false),
                            )
                          }
                          disabled={isPending}
                          title="Hides it from new shift assignment; existing shifts keep their department."
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
                              setDepartmentActive(d.id, true),
                            )
                          }
                          disabled={isPending}
                        >
                          Reactivate
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <DepartmentForm
        open={formOpen}
        onOpenChange={setFormOpen}
        editing={editing}
      />
    </div>
  )
}
