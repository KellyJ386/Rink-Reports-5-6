"use client"

import { useState, useTransition } from "react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

import { deleteTemplate, setTemplateActive } from "../actions"
import type { AreaRow, TemplateRow } from "../types"

import { ScopePicker } from "./scope-picker"
import { TemplateForm } from "./template-form"

type Props = {
  areas: AreaRow[]
  selectedAreaId: string | null
  templates: TemplateRow[]
}

export function TemplatesTab({ areas, selectedAreaId, templates }: Props) {
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<TemplateRow | null>(null)
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [, startTransition] = useTransition()

  const selectedArea = selectedAreaId
    ? (areas.find((a) => a.id === selectedAreaId) ?? null)
    : null

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

  if (areas.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>No areas yet</CardTitle>
          <CardDescription>
            Create an area on the Areas tab before adding templates.
          </CardDescription>
        </CardHeader>
      </Card>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <label className="text-muted-foreground text-sm font-medium">
          Area:
        </label>
        <ScopePicker
          paramKey="area"
          value={selectedAreaId}
          placeholder="Choose an area…"
          options={areas.map((a) => ({ id: a.id, label: a.name }))}
          clearKeys={["template"]}
        />
        {selectedArea && (
          <Button
            onClick={() => {
              setEditing(null)
              setFormOpen(true)
            }}
            className="ml-auto"
          >
            Add template
          </Button>
        )}
      </div>

      {!selectedArea ? (
        <Card>
          <CardHeader>
            <CardTitle>Pick an area</CardTitle>
            <CardDescription>
              Templates belong to an area. Choose one above to manage its
              templates.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : templates.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Create a template for {selectedArea.name}</CardTitle>
            <CardDescription>
              Templates are named checklists within an area, like &ldquo;Opening
              checklist&rdquo; or &ldquo;Hourly inspection&rdquo;.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              onClick={() => {
                setEditing(null)
                setFormOpen(true)
              }}
            >
              Add template
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="overflow-auto rounded-md border">
          <table className="w-full border-collapse text-sm">
            <thead className="bg-muted/60 sticky top-0 z-10">
              <tr>
                <th className="border-b px-3 py-2 text-left font-medium">
                  Name
                </th>
                <th className="border-b px-3 py-2 text-left font-medium">
                  Description
                </th>
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
              {templates.map((t) => {
                const isPending = pendingId === t.id
                return (
                  <tr key={t.id} className="hover:bg-muted/30">
                    <td className="border-b px-3 py-2 align-middle font-medium">
                      {t.name}
                    </td>
                    <td className="text-muted-foreground border-b px-3 py-2 align-middle">
                      {t.description ?? "—"}
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
                          onClick={() => {
                            setEditing(t)
                            setFormOpen(true)
                          }}
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
                                setTemplateActive(t.id, false),
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
                                setTemplateActive(t.id, true),
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
                                `Delete template "${t.name}"? Items will be deleted; will fail if any submissions reference it.`,
                              )
                            ) {
                              runRowAction(t.id, () => deleteTemplate(t.id))
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

      {selectedArea && (
        <TemplateForm
          open={formOpen}
          onOpenChange={setFormOpen}
          areaId={selectedArea.id}
          editing={editing}
        />
      )}
    </div>
  )
}
