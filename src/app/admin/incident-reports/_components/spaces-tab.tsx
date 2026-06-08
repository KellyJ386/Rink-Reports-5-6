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
  bulkImportFacilitySpaces,
  deleteFacilitySpace,
  seedFacilitySpaces,
  setFacilitySpaceActive,
} from "../actions"
import type { FacilitySpaceRow } from "../types"

import { BulkImportCard } from "./bulk-import-card"
import { SpaceForm } from "./space-form"

const SPACE_CSV_PLACEHOLDER = `name,slug,sort_order
Rink 2,rink-2,1
Mezzanine,mezzanine,2
Snack Bar`

type Props = {
  spaces: FacilitySpaceRow[]
}

export function SpacesTab({ spaces }: Props) {
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<FacilitySpaceRow | null>(null)
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [seedPending, startSeed] = useTransition()
  const [, startTransition] = useTransition()

  function openCreate() {
    setEditing(null)
    setFormOpen(true)
  }

  function openEdit(s: FacilitySpaceRow) {
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

  function onSeed() {
    startSeed(async () => {
      const r = await seedFacilitySpaces()
      if (!r.ok) toast.error(r.error)
      else toast.success("Default facility spaces seeded.")
    })
  }

  if (spaces.length === 0) {
    return (
      <>
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle>No facility spaces yet</CardTitle>
              <CardDescription>
                Seed a generic starter set (Main Rink, Lobby, Locker Room, Pro
                Shop, Parking Lot) or create your own below. This list is shared
                facility-wide and feeds the incident report&apos;s space picker.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button onClick={onSeed} disabled={seedPending}>
                {seedPending ? "Seeding…" : "Seed defaults"}
              </Button>
            </CardContent>
          </Card>
          <div className="flex flex-col items-start gap-2">
            <Button onClick={openCreate} variant="outline">
              Add space manually
            </Button>
            <BulkImportCard
              title="Bulk import facility spaces"
              description="Paste CSV rows: name[, slug][, sort_order]. One space per line. Duplicate slugs are skipped."
              placeholder={SPACE_CSV_PLACEHOLDER}
              action={bulkImportFacilitySpaces}
            />
          </div>
        </div>
        <SpaceForm
          open={formOpen}
          onOpenChange={setFormOpen}
          editing={editing}
        />
      </>
    )
  }

  const activeCount = spaces.filter((s) => s.is_active).length

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <Badge variant="secondary">{activeCount} active</Badge>
          <span className="text-muted-foreground text-sm">
            {spaces.length} total
          </span>
        </div>
        <Button onClick={openCreate}>Add space</Button>
      </div>

      <BulkImportCard
        title="Bulk import facility spaces"
        description="Paste CSV rows: name[, slug][, sort_order]. One space per line. Duplicate slugs are skipped."
        placeholder={SPACE_CSV_PLACEHOLDER}
        action={bulkImportFacilitySpaces}
      />

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
            {spaces.map((s) => {
              const isPending = pendingId === s.id
              return (
                <tr key={s.id} className="hover:bg-muted/30">
                  <td className="border-b px-3 py-2 align-middle font-medium">
                    {s.name}
                  </td>
                  <td className="border-b px-3 py-2 align-middle font-mono text-xs">
                    {s.slug}
                  </td>
                  <td className="text-muted-foreground border-b px-3 py-2 align-middle tabular-nums">
                    {s.sort_order}
                  </td>
                  <td className="border-b px-3 py-2 align-middle">
                    {s.is_active ? (
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
                              setFacilitySpaceActive(s.id, false),
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
                              setFacilitySpaceActive(s.id, true),
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
                              `Delete space "${s.name}"? This cannot be undone.`,
                            )
                          ) {
                            runRowAction(s.id, () => deleteFacilitySpace(s.id))
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

      <SpaceForm open={formOpen} onOpenChange={setFormOpen} editing={editing} />
    </div>
  )
}
