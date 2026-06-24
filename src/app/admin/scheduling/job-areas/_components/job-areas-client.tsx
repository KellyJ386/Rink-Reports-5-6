"use client"

import { useRouter } from "next/navigation"
import { useMemo, useState, useTransition } from "react"
import { ChevronDown, ChevronUp, Plus, Trash2, X } from "lucide-react"
import { toast } from "sonner"

import {
  BulkUploadPanel,
  type ImportSchema,
} from "@/components/admin/bulk-upload"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { cn } from "@/lib/utils"

import {
  addJobAreaCertRequirement,
  createJobArea,
  deleteJobArea,
  importJobAreas,
  moveJobArea,
  removeJobAreaCertRequirement,
  renameJobArea,
  setJobAreaActive,
} from "../actions"

import { jobAreasImportSpec } from "./job-areas-import"

export type JobAreaRow = {
  id: string
  name: string
  is_active: boolean
  sort_order: number
}

export type CertRequirementRow = {
  id: string
  job_area_id: string
  cert_name: string
}

type Props = {
  facilityId: string
  initialAreas: JobAreaRow[]
  initialRequirements: CertRequirementRow[]
}

export function JobAreasClient({
  facilityId,
  initialAreas,
  initialRequirements,
}: Props) {
  const router = useRouter()
  const [newName, setNewName] = useState("")
  const [pending, startTransition] = useTransition()

  const importSchema = useMemo<ImportSchema>(
    () => ({
      ...jobAreasImportSpec,
      onImport: (rows) => importJobAreas(facilityId, rows),
    }),
    [facilityId],
  )

  const reqByArea = new Map<string, CertRequirementRow[]>()
  for (const r of initialRequirements) {
    const arr = reqByArea.get(r.job_area_id) ?? []
    arr.push(r)
    reqByArea.set(r.job_area_id, arr)
  }

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
          <div className="flex items-center gap-2">
            <Button type="button" onClick={handleCreate} disabled={pending || !newName.trim()}>
              <Plus className="size-4" /> Add area
            </Button>
            <BulkUploadPanel
              schema={importSchema}
              triggerLabel="Bulk upload"
              onImported={() => router.refresh()}
            />
          </div>
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
                  "flex flex-col gap-2 px-3 py-2",
                  !area.is_active && "opacity-60"
                )}
              >
                <div className="flex items-center gap-2">
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

                <CertRequirements
                  areaId={area.id}
                  requirements={reqByArea.get(area.id) ?? []}
                  pending={pending}
                  run={run}
                />
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <p className="text-muted-foreground text-xs">
        Deactivating hides an area from new assignments without affecting people
        already assigned. Deleting is only possible when no one is assigned.
        Required certifications block assigning anyone who lacks a current
        matching certification to a shift in that area.
      </p>
    </div>
  )
}

function CertRequirements({
  areaId,
  requirements,
  pending,
  run,
}: {
  areaId: string
  requirements: CertRequirementRow[]
  pending: boolean
  run: (
    action: () => Promise<{ ok: boolean; error?: string }>,
    success?: string
  ) => void
}) {
  const [draft, setDraft] = useState("")

  function add() {
    const certName = draft.trim()
    if (!certName) return
    run(
      () => addJobAreaCertRequirement({ jobAreaId: areaId, certName }),
      "Requirement added."
    )
    setDraft("")
  }

  return (
    <div className="ml-8 flex flex-col gap-1.5">
      <span className="text-muted-foreground text-xs font-medium">
        Required certifications
      </span>
      <div className="flex flex-wrap items-center gap-1.5">
        {requirements.length === 0 && (
          <span className="text-muted-foreground text-xs">None</span>
        )}
        {requirements.map((r) => (
          <span
            key={r.id}
            className="bg-muted inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs"
          >
            {r.cert_name}
            <button
              type="button"
              aria-label={`Remove ${r.cert_name}`}
              disabled={pending}
              className="text-muted-foreground hover:text-destructive"
              onClick={() =>
                run(
                  () => removeJobAreaCertRequirement(r.id),
                  "Requirement removed."
                )
              }
            >
              <X className="size-3" />
            </button>
          </span>
        ))}
      </div>
      <div className="flex items-center gap-1">
        <Input
          value={draft}
          maxLength={200}
          placeholder="e.g. CPR"
          disabled={pending}
          className="h-8 w-44 text-xs"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault()
              add()
            }
          }}
        />
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={pending || !draft.trim()}
          onClick={add}
        >
          Add
        </Button>
      </div>
    </div>
  )
}
