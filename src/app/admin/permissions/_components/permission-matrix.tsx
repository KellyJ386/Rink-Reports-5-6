"use client"

import { useState, useTransition } from "react"

import {
  MODULE_LABELS,
  MODULE_NAMES,
  USER_ACTIONS,
  USER_ACTION_LABELS,
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
}

const PRESETS: { value: Preset; label: string }[] = [
  { value: "full_access", label: "Full Access" },
  { value: "submitter_only", label: "Submitter Only" },
  { value: "viewer_only", label: "Viewer Only" },
  { value: "no_access", label: "No Access" },
]

export function PermissionMatrix({ userId, facilityId, userLabel, initialMatrix }: Props) {
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
      const next: Matrix = {} as Matrix
      const all = preset === "full_access"
      const submitter = preset === "submitter_only"
      const viewer = preset === "viewer_only"
      for (const m of MODULE_NAMES) {
        next[m] = {
          view: all || submitter || viewer,
          submit: all || submitter,
          edit: all,
          admin: all,
        }
      }
      setMatrix(next)
      setInfo(`Applied preset: ${preset.replace("_", " ")}`)
    })
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">Permissions for {userLabel}</h2>
        <div className="flex flex-wrap gap-2">
          {PRESETS.map((p) => (
            <button
              key={p.value}
              type="button"
              disabled={pending}
              onClick={() => applyPreset(p.value)}
              className="rounded-md border border-slate-700 bg-slate-800 px-3 py-1.5 text-sm hover:bg-slate-700 disabled:opacity-50"
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-red-700 bg-red-950 px-3 py-2 text-sm text-red-200">
          {error}
        </div>
      )}
      {info && (
        <div className="rounded-md border border-emerald-700 bg-emerald-950 px-3 py-2 text-sm text-emerald-200">
          {info}
        </div>
      )}

      <div className="overflow-x-auto rounded-md border border-slate-700">
        <table className="w-full text-sm">
          <thead className="bg-slate-900 text-left">
            <tr>
              <th className="px-3 py-2 font-medium">Module</th>
              {USER_ACTIONS.map((a) => (
                <th key={a} className="px-3 py-2 font-medium text-center">
                  {USER_ACTION_LABELS[a]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {MODULE_NAMES.map((m) => (
              <tr key={m} className="border-t border-slate-800">
                <td className="px-3 py-2">{MODULE_LABELS[m]}</td>
                {USER_ACTIONS.map((a) => (
                  <td key={a} className="px-3 py-2 text-center">
                    <input
                      type="checkbox"
                      checked={matrix[m][a]}
                      disabled={pending}
                      onChange={(e) => toggle(m, a, e.target.checked)}
                      aria-label={`${MODULE_LABELS[m]} – ${USER_ACTION_LABELS[a]}`}
                      className="size-4 cursor-pointer accent-emerald-500"
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
    <details className="rounded-md border border-slate-700 bg-slate-900 p-3">
      <summary className="cursor-pointer text-sm font-medium">
        Bulk CSV import
      </summary>
      <div className="mt-3 space-y-2">
        <p className="text-xs text-slate-400">
          Header: <code>user_id,facility_id,module,action,enabled</code>. One row per cell.
        </p>
        <textarea
          value={csv}
          onChange={(e) => setCsv(e.target.value)}
          rows={6}
          className="w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1 font-mono text-xs"
          placeholder="user_id,facility_id,module,action,enabled&#10;uuid,uuid,daily_reports,view,true"
        />
        <button
          type="button"
          onClick={onImport}
          disabled={pending || csv.trim().length === 0}
          className="rounded-md border border-slate-700 bg-slate-800 px-3 py-1.5 text-sm hover:bg-slate-700 disabled:opacity-50"
        >
          Import
        </button>
        {error && (
          <div className="rounded-md border border-red-700 bg-red-950 px-3 py-2 text-sm text-red-200">
            {error}
          </div>
        )}
        {result && (
          <pre className="whitespace-pre-wrap rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-xs">
            {result}
          </pre>
        )}
      </div>
    </details>
  )
}
