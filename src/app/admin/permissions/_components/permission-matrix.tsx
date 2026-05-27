"use client"

import { useState, useTransition, type ReactNode } from "react"

import { Button } from "@/components/ui/button"
import {
  MODULE_LABELS,
  MODULE_NAMES,
  USER_ACTIONS,
  USER_ACTION_LABELS,
  presetMatrix,
  type ModuleName,
  type PermissionMatrix as Matrix,
  type Preset,
  type UserAction,
} from "@/lib/permissions"

import {
  applyPresetToUser,
  bulkImportUserPermissionsCsv,
  upsertUserPermission,
} from "../user-permission-actions"

type Props = {
  userId: string
  facilityId: string
  userLabel: string
  initialMatrix: Matrix
  notice?: ReactNode
}

const PRESETS: { value: Preset; label: string }[] = [
  { value: "full_access", label: "Full Access" },
  { value: "submitter_only", label: "Submitter Only" },
  { value: "viewer_only", label: "Viewer Only" },
  { value: "no_access", label: "No Access" },
]

export function PermissionMatrix({
  userId,
  facilityId,
  userLabel,
  initialMatrix,
  notice,
}: Props) {
  const [matrix, setMatrix] = useState<Matrix>(initialMatrix)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function toggle(moduleName: ModuleName, action: UserAction, next: boolean) {
    setError(null)
    setInfo(null)
    const previous = matrix[moduleName][action]
    setMatrix((m) => ({
      ...m,
      [moduleName]: { ...m[moduleName], [action]: next },
    }))
    startTransition(async () => {
      const res = await upsertUserPermission({
        userId,
        facilityId,
        moduleName,
        action,
        enabled: next,
      })
      if (!res.ok) {
        setMatrix((m) => ({
          ...m,
          [moduleName]: { ...m[moduleName], [action]: previous },
        }))
        setError(res.error)
      }
    })
  }

  function applyPreset(preset: Preset) {
    setError(null)
    setInfo(null)
    startTransition(async () => {
      const res = await applyPresetToUser({ userId, facilityId, preset })
      if (!res.ok) {
        setError(res.error)
        return
      }
      setMatrix(presetMatrix(preset))
      setInfo(`Applied preset: ${preset.replace("_", " ")}`)
    })
  }

  return (
    <div className="space-y-4">
      {notice}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-foreground">
          Permissions for {userLabel}
        </h2>
        <div className="flex flex-wrap gap-2">
          {PRESETS.map((p) => (
            <Button
              key={p.value}
              type="button"
              variant="secondary"
              size="sm"
              disabled={pending}
              onClick={() => applyPreset(p.value)}
            >
              {p.label}
            </Button>
          ))}
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}
      {info && (
        <div className="rounded-md border border-border bg-muted px-3 py-2 text-sm text-foreground">
          {info}
        </div>
      )}

      <div className="overflow-x-auto rounded-md border border-border bg-card">
        <table className="w-full text-sm text-card-foreground">
          <thead className="bg-muted text-left">
            <tr>
              <th className="px-3 py-2 font-medium">Module</th>
              {USER_ACTIONS.map((a) => (
                <th key={a} className="px-3 py-2 text-center font-medium">
                  {USER_ACTION_LABELS[a]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {MODULE_NAMES.map((m) => (
              <tr key={m}>
                <td className="px-3 py-2">{MODULE_LABELS[m]}</td>
                {USER_ACTIONS.map((a) => (
                  <td key={a} className="px-3 py-2 text-center">
                    <input
                      type="checkbox"
                      checked={matrix[m][a]}
                      disabled={pending}
                      onChange={(e) => toggle(m, a, e.target.checked)}
                      aria-label={`${MODULE_LABELS[m]} – ${USER_ACTION_LABELS[a]}`}
                      className="size-4 cursor-pointer accent-[var(--green-500)]"
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <CsvImporter />
    </div>
  )
}

function CsvImporter() {
  const [csv, setCsv] = useState("")
  const [result, setResult] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function onImport() {
    setError(null)
    setResult(null)
    startTransition(async () => {
      const res = await bulkImportUserPermissionsCsv(csv)
      if (!res.ok) {
        setError(res.error)
        return
      }
      const head = `Imported ${res.inserted} row(s). Skipped ${res.skipped}.`
      setResult(res.errors.length > 0 ? `${head}\n${res.errors.join("\n")}` : head)
    })
  }

  return (
    <details className="rounded-md border border-border bg-card p-3 text-card-foreground">
      <summary className="cursor-pointer text-sm font-medium">
        Bulk CSV import
      </summary>
      <div className="mt-3 space-y-2">
        <p className="text-xs text-muted-foreground">
          Header: <code>user_id,facility_id,module,action,enabled</code>. One row per cell.
        </p>
        <textarea
          value={csv}
          onChange={(e) => setCsv(e.target.value)}
          rows={6}
          className="w-full rounded-md border border-border bg-muted px-2 py-1 font-mono text-xs text-foreground"
          placeholder="user_id,facility_id,module,action,enabled&#10;uuid,uuid,daily_reports,view,true"
        />
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={onImport}
          disabled={pending || csv.trim().length === 0}
        >
          Import
        </Button>
        {error && (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        )}
        {result && (
          <pre className="whitespace-pre-wrap rounded-md border border-border bg-muted px-3 py-2 text-xs text-foreground">
            {result}
          </pre>
        )}
      </div>
    </details>
  )
}
