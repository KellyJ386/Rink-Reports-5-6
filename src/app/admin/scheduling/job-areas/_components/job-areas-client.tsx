"use client"

import { useRouter } from "next/navigation"
import { useState, useTransition } from "react"
import { ChevronDown, ChevronUp, Plus, Trash2 } from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { cn } from "@/lib/utils"

import {
  createJobArea,
  deleteJobArea,
  moveJobArea,
  renameJobArea,
  setJobAreaActive,
} from "../actions"

export type JobAreaRow = {
  id: string
  name: string
  is_active: boolean
  sort_order: number
}

type Props = {
  facilityId: string
  initialAreas: JobAreaRow[]
}

export function JobAreasClient({ facilityId, initialAreas }: Props) {
  const router = useRouter()
  const [newName, setNewName] = useState("")
  const [pending, startTransition] = useTransition()

  function run(action: () => Promise<{ ok: boolean; error?: string }>, success?: string) {
    startTransition(async () => {
      const res = await action()
      if (!res.ok) {
        toast.error(res.error ?? "Something went wrong.")
        return
      }
      if (success) toast.success(success)
      router.refresh()
    })
  }

  function handleCreate() {
    const name = newName.trim()
    if (!name) {
      toast.error("Enter a name.")
      return
    }
    startTransition(async () => {
      const res = await createJobArea({ facilityId, name })
      if (!res.ok) {
        toast.error(res.error)
        return
      }
      toast.success(`Added “${res.area.name}”.`)
      setNewName("")
      router.refresh()
    })
  }

  function handleRename(area: JobAreaRow, value: string) {
    const next = value.trim()
    if (!next || next === area.name) return
    run(() => renameJobArea(area.id, next), "Renamed.")
  }

  function handleDelete(area: JobAreaRow) {
    if (
      !window.confirm(
        `Delete “${area.name}”? If it's assigned to anyone this will be blocked — deactivate it instead.`
      )
    ) {
      return
    }
    run(() => deleteJobArea(area.id), "Deleted.")
  }

  return (
    <div className="flex max-w-2xl flex-col gap-4">
      {/* Create */}
      <Card>
        <CardContent className="flex flex-col gap-2 py-4 sm:flex-row sm:items-end">
          <div className="flex flex-1 flex-col gap-1.5">
            <label htmlFor="new-area" className="text-sm font-medium">
              New job area
            </label>
            <Input
              id="new-area"
              value={newName}
              maxLength={60}
              placeholder="e.g. Skate Rental"
              disabled={pending}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault()
                  handleCreate()
                }
              }}
            />
          </div>
          <Button type="button" onClick={handleCreate} disabled={pending || !newName.trim()}>
            <Plus className="size-4" /> Add area
          </Button>
        </CardContent>
      </Card>

      {/* List */}
      {initialAreas.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          No job areas yet. Add your first one above.
        </p>
      ) : (
        <Card>
          <CardContent className="flex flex-col divide-y p-0">
            {initialAreas.map((area, i) => (
              <div
                key={area.id}
                className={cn(
                  "flex items-center gap-2 px-3 py-2",
                  !area.is_active && "opacity-60"
                )}
              >
                <div className="flex flex-col">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-6"
                    disabled={pending || i === 0}
                    aria-label="Move up"
                    onClick={() => run(() => moveJobArea(area.id, "up"))}
                  >
                    <ChevronUp className="size-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-6"
                    disabled={pending || i === initialAreas.length - 1}
                    aria-label="Move down"
                    onClick={() => run(() => moveJobArea(area.id, "down"))}
                  >
                    <ChevronDown className="size-4" />
                  </Button>
                </div>

                <Input
                  key={`${area.id}-${area.name}`}
                  defaultValue={area.name}
                  maxLength={60}
                  disabled={pending}
                  aria-label={`Rename ${area.name}`}
                  className="h-9 flex-1"
                  onBlur={(e) => handleRename(area, e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") e.currentTarget.blur()
                  }}
                />

                {!area.is_active && <Badge variant="secondary">Inactive</Badge>}

                <label className="flex items-center gap-1.5 text-xs">
                  <Switch
                    checked={area.is_active}
                    disabled={pending}
                    aria-label={area.is_active ? "Deactivate" : "Activate"}
                    onCheckedChange={(v) =>
                      run(
                        () => setJobAreaActive(area.id, v),
                        v ? "Activated." : "Deactivated."
                      )
                    }
                  />
                  <span className="text-muted-foreground hidden sm:inline">Active</span>
                </label>

                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-8"
                  disabled={pending}
                  aria-label={`Delete ${area.name}`}
                  onClick={() => handleDelete(area)}
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <p className="text-muted-foreground text-xs">
        Deactivating hides an area from new assignments without affecting people
        already assigned. Deleting is only possible when no one is assigned.
      </p>
    </div>
  )
}
