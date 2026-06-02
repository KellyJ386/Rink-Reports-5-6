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

import {
  deleteIncidentActivity,
  seedIncidentActivities,
  setIncidentActivityActive,
} from "../actions"
import type { ActivityRow } from "../types"

import { ActivityForm } from "./activity-form"

type Props = {
  activities: ActivityRow[]
}

export function ActivitiesTab({ activities }: Props) {
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<ActivityRow | null>(null)
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [seedPending, startSeed] = useTransition()
  const [, startTransition] = useTransition()

  function openCreate() {
    setEditing(null)
    setFormOpen(true)
  }

  function openEdit(a: ActivityRow) {
    setEditing(a)
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

  function onSeed() {
    startSeed(async () => {
      const r = await seedIncidentActivities()
      if (!r.ok) toast.error(r.error)
      else toast.success("Default activities seeded.")
    })
  }

  if (activities.length === 0) {
    return (
      <>
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle>No activities yet</CardTitle>
              <CardDescription>
                Seed the standard activities (Public Skating, Hockey, Figure
                Skating, Learn to Skate, Maintenance) or create your own below.
                Reporters can always pick &quot;Other&quot;.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button onClick={onSeed} disabled={seedPending}>
                {seedPending ? "Seeding…" : "Seed defaults"}
              </Button>
            </CardContent>
          </Card>
          <div>
            <Button onClick={openCreate} variant="outline">
              Add activity manually
            </Button>
          </div>
        </div>
        <ActivityForm
          open={formOpen}
          onOpenChange={setFormOpen}
          editing={editing}
        />
      </>
    )
  }

  const activeCount = activities.filter((a) => a.is_active).length

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <Badge variant="secondary">{activeCount} active</Badge>
          <span className="text-muted-foreground text-sm">
            {activities.length} total
          </span>
        </div>
        <Button onClick={openCreate}>Add activity</Button>
      </div>

      <div className="overflow-auto rounded-md border">
        <table className="w-full border-collapse text-sm">
          <thead className="bg-muted/60 sticky top-0 z-10">
            <tr>
              <th className="border-b px-3 py-2 text-left font-medium">
                Display name
              </th>
              <th className="border-b px-3 py-2 text-left font-medium">Key</th>
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
            {activities.map((a) => {
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
                      <span className="font-medium">{a.display_name}</span>
                    </div>
                  </td>
                  <td className="border-b px-3 py-2 align-middle font-mono text-xs">
                    {a.key}
                  </td>
                  <td className="text-muted-foreground border-b px-3 py-2 align-middle tabular-nums">
                    {a.sort_order}
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
                              setIncidentActivityActive(a.id, false),
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
                              setIncidentActivityActive(a.id, true),
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
                              `Delete activity "${a.display_name}"? This cannot be undone.`,
                            )
                          ) {
                            runRowAction(a.id, () => deleteIncidentActivity(a.id))
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

      <ActivityForm
        open={formOpen}
        onOpenChange={setFormOpen}
        editing={editing}
      />
    </div>
  )
}
