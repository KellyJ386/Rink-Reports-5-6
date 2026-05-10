"use client"

import { useState, useTransition } from "react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

import { deleteChecklistItem, moveChecklistItem } from "../actions"
import type { AreaRow, ChecklistItemRow, TemplateRow } from "../types"

import { ItemForm } from "./item-form"
import { ScopePicker } from "./scope-picker"

type Props = {
  areas: AreaRow[]
  templates: TemplateRow[]
  items: ChecklistItemRow[]
  selectedAreaId: string | null
  selectedTemplateId: string | null
}

export function ItemsTab({
  areas,
  templates,
  items,
  selectedAreaId,
  selectedTemplateId,
}: Props) {
  const [formOpen, setFormOpen] = useState(false)
  const [bulkOpen, setBulkOpen] = useState(false)
  const [editing, setEditing] = useState<ChecklistItemRow | null>(null)
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [, startTransition] = useTransition()

  const selectedTemplate = selectedTemplateId
    ? (templates.find((t) => t.id === selectedTemplateId) ?? null)
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
            Create an area first, then a template, before adding checklist
            items.
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
        <label className="text-muted-foreground text-sm font-medium">
          Template:
        </label>
        <ScopePicker
          paramKey="template"
          value={selectedTemplateId}
          placeholder={
            selectedAreaId ? "Choose a template…" : "Pick area first"
          }
          options={templates.map((t) => ({ id: t.id, label: t.name }))}
        />
        {selectedTemplate && (
          <div className="ml-auto flex items-center gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setEditing(null)
                setBulkOpen(true)
              }}
            >
              Bulk add
            </Button>
            <Button
              onClick={() => {
                setEditing(null)
                setFormOpen(true)
              }}
            >
              Add item
            </Button>
          </div>
        )}
      </div>

      {!selectedAreaId ? (
        <Card>
          <CardHeader>
            <CardTitle>Pick an area</CardTitle>
            <CardDescription>
              Items belong to a template within an area.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : !selectedTemplate ? (
        <Card>
          <CardHeader>
            <CardTitle>Pick a template</CardTitle>
            <CardDescription>
              {templates.length === 0
                ? "This area has no templates yet. Add one on the Templates tab."
                : "Choose a template above to manage its items."}
            </CardDescription>
          </CardHeader>
        </Card>
      ) : items.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Add your first checklist item</CardTitle>
            <CardDescription>
              Items show as individual checkboxes when staff submit a report
              for {selectedTemplate.name}.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex gap-2">
            <Button
              onClick={() => {
                setEditing(null)
                setFormOpen(true)
              }}
            >
              Add item
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setEditing(null)
                setBulkOpen(true)
              }}
            >
              Bulk add
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="overflow-auto rounded-md border">
          <table className="w-full border-collapse text-sm">
            <thead className="bg-muted/60 sticky top-0 z-10">
              <tr>
                <th className="border-b px-3 py-2 text-left font-medium">
                  Order
                </th>
                <th className="border-b px-3 py-2 text-left font-medium">
                  Label
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
              {items.map((it, idx) => {
                const isPending = pendingId === it.id
                return (
                  <tr key={it.id} className="hover:bg-muted/30">
                    <td className="border-b px-3 py-2 align-middle">
                      <div className="flex items-center gap-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            runRowAction(it.id, () =>
                              moveChecklistItem(it.id, -1),
                            )
                          }
                          disabled={isPending || idx === 0}
                          aria-label="Move up"
                        >
                          ↑
                        </Button>
                        <span className="text-muted-foreground tabular-nums">
                          {it.sort_order}
                        </span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            runRowAction(it.id, () =>
                              moveChecklistItem(it.id, 1),
                            )
                          }
                          disabled={isPending || idx === items.length - 1}
                          aria-label="Move down"
                        >
                          ↓
                        </Button>
                      </div>
                    </td>
                    <td className="border-b px-3 py-2 align-middle">
                      <div className="flex flex-col">
                        <span className="font-medium">{it.label}</span>
                        {it.description && (
                          <span className="text-muted-foreground text-xs">
                            {it.description}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="border-b px-3 py-2 align-middle">
                      {it.is_active ? (
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
                            setEditing(it)
                            setFormOpen(true)
                          }}
                          disabled={isPending}
                        >
                          Edit
                        </Button>
                        <Button
                          type="button"
                          variant="destructive"
                          size="sm"
                          onClick={() => {
                            if (
                              window.confirm(
                                `Delete item "${it.label}"? Past submissions will keep their snapshot.`,
                              )
                            ) {
                              runRowAction(it.id, () =>
                                deleteChecklistItem(it.id),
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
      )}

      {selectedTemplate && (
        <>
          <ItemForm
            open={formOpen}
            onOpenChange={setFormOpen}
            templateId={selectedTemplate.id}
            editing={editing}
          />
          <ItemForm
            open={bulkOpen}
            onOpenChange={setBulkOpen}
            templateId={selectedTemplate.id}
            editing={null}
            bulk
          />
        </>
      )}
    </div>
  )
}
