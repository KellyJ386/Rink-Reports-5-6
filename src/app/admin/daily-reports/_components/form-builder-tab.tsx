"use client"

// Admin Form Builder tab (migration 235): per-area custom form templates with
// versioned publishing, plus the end-of-day lock controls for report
// instances. Editing NEVER mutates a published version — the editor's
// "Publish" re-publishes the form as version N+1 while existing instances
// keep rendering their frozen snapshots.

import { useState, useTransition } from "react"
import { Lock, LockOpen } from "lucide-react"
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

import {
  deleteFormTemplate,
  lockReportDay,
  setFormTemplateActive,
  unlockReportDay,
} from "../form-template-actions"
import type { AreaRow, FormFieldRow, FormTemplateRow } from "../types"

import { FormBuilderEditor } from "./form-builder-editor"
import { ScopePicker } from "./scope-picker"

type TemplateWithCount = FormTemplateRow & { instance_count: number }

type Props = {
  areas: AreaRow[]
  selectedAreaId: string | null
  templates: TemplateWithCount[]
  fields: FormFieldRow[]
  today: string
  lockedDates: string[]
}

export function FormBuilderTab({
  areas,
  selectedAreaId,
  templates,
  fields,
  today,
  lockedDates,
}: Props) {
  const [editorOpen, setEditorOpen] = useState(false)
  const [editing, setEditing] = useState<TemplateWithCount | null>(null)
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
            Create an area on the Areas tab before building custom forms.
          </CardDescription>
        </CardHeader>
      </Card>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <DayLockCard today={today} lockedDates={lockedDates} />

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
              setEditorOpen(true)
            }}
            className="ml-auto"
          >
            New form
          </Button>
        )}
      </div>

      {!selectedArea ? (
        <Card>
          <CardHeader>
            <CardTitle>Pick an area</CardTitle>
            <CardDescription>
              Custom forms belong to an area. Choose one above to manage its
              forms.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : templates.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Build a form for {selectedArea.name}</CardTitle>
            <CardDescription>
              A custom form lets staff file multiple titled reports per day —
              e.g. one &ldquo;Event Set Up&rdquo; report per event. Staff answers
              are validated against the form&rsquo;s fields.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              onClick={() => {
                setEditing(null)
                setEditorOpen(true)
              }}
            >
              New form
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="overflow-auto rounded-md border">
          <table className="w-full border-collapse text-sm">
            <thead className="bg-muted/60 sticky top-0 z-10">
              <tr>
                <th className="border-b px-3 py-2 text-left font-medium">Name</th>
                <th className="border-b px-3 py-2 text-left font-medium">Version</th>
                <th className="border-b px-3 py-2 text-left font-medium">Fields</th>
                <th className="border-b px-3 py-2 text-left font-medium">Reports</th>
                <th className="border-b px-3 py-2 text-left font-medium">Status</th>
                <th className="border-b px-3 py-2 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {templates.map((t) => {
                const isPending = pendingId === t.id
                const fieldCount = fields.filter(
                  (f) => f.template_id === t.id,
                ).length
                const deletable = t.version === 1 && t.instance_count === 0
                return (
                  <tr key={t.id} className="hover:bg-muted/30">
                    <td className="border-b px-3 py-2 align-middle font-medium">
                      {t.name}
                    </td>
                    <td className="text-muted-foreground border-b px-3 py-2 align-middle tabular-nums">
                      v{t.version}
                    </td>
                    <td className="text-muted-foreground border-b px-3 py-2 align-middle tabular-nums">
                      {fieldCount}
                    </td>
                    <td className="text-muted-foreground border-b px-3 py-2 align-middle tabular-nums">
                      {t.instance_count}
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
                            setEditorOpen(true)
                          }}
                          disabled={isPending}
                        >
                          Edit
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            runRowAction(t.id, () =>
                              setFormTemplateActive(t.id, !t.is_active),
                            )
                          }
                          disabled={isPending}
                        >
                          {t.is_active ? "Deactivate" : "Reactivate"}
                        </Button>
                        {deletable && (
                          <Button
                            type="button"
                            variant="destructive"
                            size="sm"
                            onClick={() => {
                              if (
                                window.confirm(`Delete form "${t.name}"?`)
                              ) {
                                runRowAction(t.id, () =>
                                  deleteFormTemplate(t.id),
                                )
                              }
                            }}
                            disabled={isPending}
                          >
                            Delete
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
      )}

      {selectedArea && (
        <FormBuilderEditor
          open={editorOpen}
          onOpenChange={setEditorOpen}
          areaId={selectedArea.id}
          areaName={selectedArea.name}
          editing={editing}
          editingFields={
            editing ? fields.filter((f) => f.template_id === editing.id) : []
          }
        />
      )}
    </div>
  )
}

function DayLockCard({
  today,
  lockedDates,
}: {
  today: string
  lockedDates: string[]
}) {
  const [pendingDate, setPendingDate] = useState<string | null>(null)
  const [, startTransition] = useTransition()
  const todayLocked = lockedDates.includes(today)

  function run(date: string, fn: () => Promise<{ ok: boolean; error?: string }>) {
    setPendingDate(date)
    startTransition(async () => {
      const r = await fn()
      if (!r.ok) toast.error(r.error ?? "Action failed.")
      setPendingDate(null)
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {todayLocked ? (
            <Lock className="h-4 w-4" aria-hidden />
          ) : (
            <LockOpen className="h-4 w-4" aria-hidden />
          )}
          End-of-day lock
        </CardTitle>
        <CardDescription>
          Locking a day makes every report instance for that day read-only —
          enforced at the database, not just in this screen. Unlock to make
          corrections, then re-lock.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm">
            Today ({today}):{" "}
            {todayLocked ? (
              <Badge variant="warning">Locked</Badge>
            ) : (
              <Badge variant="success">Open</Badge>
            )}
          </span>
          {todayLocked ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => run(today, () => unlockReportDay(today))}
              disabled={pendingDate === today}
            >
              Unlock today
            </Button>
          ) : (
            <Button
              type="button"
              size="sm"
              onClick={() => {
                if (
                  window.confirm(
                    `Lock ${today}? Staff will no longer be able to create, edit, or submit report instances for today.`,
                  )
                ) {
                  run(today, () => lockReportDay(today))
                }
              }}
              disabled={pendingDate === today}
            >
              Lock today
            </Button>
          )}
        </div>

        {lockedDates.filter((d) => d !== today).length > 0 && (
          <div className="flex flex-col gap-1.5">
            <span className="text-muted-foreground text-sm font-semibold">
              Locked days
            </span>
            <ul className="flex flex-col gap-1">
              {lockedDates
                .filter((d) => d !== today)
                .map((d) => (
                  <li
                    key={d}
                    className="flex items-center justify-between gap-3 text-sm"
                  >
                    <span className="tabular-nums">{d}</span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => run(d, () => unlockReportDay(d))}
                      disabled={pendingDate === d}
                    >
                      Unlock
                    </Button>
                  </li>
                ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
