"use client"

import { memo, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import {
  PERMISSION_LEVELS,
  PERMISSION_LEVEL_DESCRIPTIONS,
  PERMISSION_LEVEL_LABELS,
  type PermissionLevel,
} from "@/lib/permissions"
import { cn } from "@/lib/utils"

import {
  applyRoleDefaultsToEmployee,
  copyPermissionsBetweenEmployees,
  setModulePermissionLevel,
} from "../actions"
import {
  MODULE_KEYS,
  MODULE_LABELS,
  type Employee,
  type ModuleKey,
  type ModulePermissionMap,
} from "../types"

type Props = {
  employees: Employee[]
  allEmployees: Employee[]
  permissions: ModulePermissionMap
}

type RowPerms = Partial<Record<ModuleKey, PermissionLevel>>

type PermissionRowProps = {
  employee: Employee
  perms: RowPerms
}

const LEVEL_BADGE_CLASS: Record<PermissionLevel, string> = {
  none: "bg-muted text-muted-foreground",
  view: "bg-slate-700/40 text-slate-100",
  submit: "bg-sky-800/50 text-sky-100",
  edit_own: "bg-cyan-800/50 text-cyan-100",
  edit_all: "bg-teal-800/50 text-teal-100",
  approve: "bg-amber-800/50 text-amber-100",
  publish: "bg-orange-800/50 text-orange-100",
  manage_settings: "bg-violet-800/50 text-violet-100",
  admin: "bg-rose-800/60 text-rose-100",
}

type PermissionRowExtraProps = {
  otherEmployees: Employee[]
}

const PermissionRow = memo(function PermissionRow({
  employee,
  perms,
  otherEmployees,
}: PermissionRowProps & PermissionRowExtraProps) {
  const [, startTransition] = useTransition()
  const [local, setLocal] = useState<RowPerms>(perms)
  const [lastSynced, setLastSynced] = useState<RowPerms>(perms)
  const [actionsOpen, setActionsOpen] = useState(false)
  const [copyFromId, setCopyFromId] = useState<string>("")
  const [pendingBulk, setPendingBulk] = useState<
    | { kind: "applyDefaults" }
    | { kind: "copyFrom"; sourceName: string; sourceId: string }
    | null
  >(null)
  const router = useRouter()

  if (lastSynced !== perms) {
    setLastSynced(perms)
    setLocal(perms)
  }

  function levelFor(mod: ModuleKey): PermissionLevel {
    return local[mod] ?? "none"
  }

  function setLevel(mod: ModuleKey, next: PermissionLevel) {
    const prev = local
    setLocal((cur) => ({ ...cur, [mod]: next }))

    startTransition(async () => {
      const res = await setModulePermissionLevel(employee.id, mod, next)
      if (!res.ok) {
        setLocal(prev)
        toast.error(res.error)
      }
    })
  }

  function onApplyDefaults() {
    setPendingBulk({ kind: "applyDefaults" })
  }

  function onCopyFrom() {
    if (!copyFromId) {
      toast.error("Pick an employee to copy from.")
      return
    }
    const sourceName =
      otherEmployees.find((e) => e.id === copyFromId)?.full_name ??
      "that employee"
    setPendingBulk({ kind: "copyFrom", sourceName, sourceId: copyFromId })
  }

  function confirmApplyDefaults() {
    startTransition(async () => {
      const res = await applyRoleDefaultsToEmployee(employee.id)
      if (res.ok) {
        toast.success(`${employee.full_name} reset to role defaults.`)
        setActionsOpen(false)
        router.refresh()
      } else {
        toast.error(res.error)
      }
    })
  }

  function confirmCopyFrom(sourceId: string, sourceName: string) {
    startTransition(async () => {
      const res = await copyPermissionsBetweenEmployees(employee.id, sourceId)
      if (res.ok) {
        toast.success(`Copied permissions from ${sourceName}.`)
        setActionsOpen(false)
        setCopyFromId("")
        router.refresh()
      } else {
        toast.error(res.error)
      }
    })
  }

  return (
    <>
    <tr className="hover:bg-muted/30">
      <th
        scope="row"
        className="bg-background sticky left-0 z-10 border-b px-3 py-2 text-left align-top font-normal"
      >
        <div className="flex flex-col gap-1">
          <div className="flex items-start justify-between gap-2">
            <div className="flex flex-col gap-0.5">
              <span className="font-medium">{employee.full_name}</span>
              <span className="text-muted-foreground text-xs">
                {employee.email ?? ""}
              </span>
            </div>
            <button
              type="button"
              onClick={() => setActionsOpen((v) => !v)}
              aria-label={`Bulk actions for ${employee.full_name}`}
              aria-expanded={actionsOpen}
              className="text-muted-foreground hover:bg-accent hover:text-foreground rounded px-1.5 py-0.5 text-xs"
            >
              ⋯
            </button>
          </div>
          <div className="flex flex-wrap gap-1">
            {employee.role_display_name ? (
              <Badge variant="secondary">{employee.role_display_name}</Badge>
            ) : null}
            {employee.departments.map((d) => (
              <span
                key={d}
                className="border-input text-muted-foreground inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px]"
              >
                {d}
              </span>
            ))}
          </div>
          {actionsOpen ? (
            <div className="bg-muted/40 mt-1 flex flex-col gap-2 rounded-md border p-2">
              <button
                type="button"
                onClick={onApplyDefaults}
                className="hover:bg-accent rounded px-2 py-1 text-left text-xs"
              >
                Apply role defaults
              </button>
              <div className="flex flex-col gap-1">
                <label
                  htmlFor={`copy-from-${employee.id}`}
                  className="text-muted-foreground text-[10px] uppercase tracking-wider"
                >
                  Copy from
                </label>
                <select
                  id={`copy-from-${employee.id}`}
                  value={copyFromId}
                  onChange={(e) => setCopyFromId(e.target.value)}
                  className="border-input bg-background focus-visible:ring-ring/50 rounded-md border px-1.5 py-1 text-xs focus-visible:ring-[3px]"
                >
                  <option value="">Pick employee…</option>
                  {otherEmployees.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.full_name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={onCopyFrom}
                  disabled={!copyFromId}
                  className="bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 rounded px-2 py-1 text-xs"
                >
                  Copy permissions
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </th>

      {MODULE_KEYS.map((mod) => {
        const level = levelFor(mod)
        const id = `${employee.id}-${mod}-level`
        return (
          <td key={mod} className="border-b border-l px-2 py-2 align-middle">
            <div className="flex justify-center">
              <select
                id={id}
                value={level}
                onChange={(e) =>
                  setLevel(mod, e.target.value as PermissionLevel)
                }
                title={`${MODULE_LABELS[mod]} — ${PERMISSION_LEVEL_DESCRIPTIONS[level]}`}
                aria-label={`Permission level for ${MODULE_LABELS[mod]} for ${employee.full_name}`}
                className={cn(
                  "border-input focus-visible:ring-ring/50 cursor-pointer rounded-md border px-1.5 py-1 text-xs focus-visible:ring-[3px]",
                  LEVEL_BADGE_CLASS[level],
                )}
              >
                {PERMISSION_LEVELS.map((l) => (
                  <option key={l} value={l}>
                    {PERMISSION_LEVEL_LABELS[l]}
                  </option>
                ))}
              </select>
            </div>
          </td>
        )
      })}
    </tr>
    <AlertDialog
      open={pendingBulk !== null}
      onOpenChange={(open) => {
        if (!open) setPendingBulk(null)
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {pendingBulk?.kind === "applyDefaults"
              ? "Reset to role defaults?"
              : "Replace overrides?"}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {pendingBulk?.kind === "applyDefaults"
              ? `Wipe all per-module overrides for ${employee.full_name}? They will fall back to their role's defaults.`
              : pendingBulk?.kind === "copyFrom"
                ? `Replace ${employee.full_name}'s overrides with those from ${pendingBulk.sourceName}? Modules without a source override will fall back to role defaults.`
                : ""}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              const current = pendingBulk
              setPendingBulk(null)
              if (current?.kind === "applyDefaults") confirmApplyDefaults()
              else if (current?.kind === "copyFrom")
                confirmCopyFrom(current.sourceId, current.sourceName)
            }}
          >
            Continue
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  )
})

export function PermissionsTable({
  employees,
  allEmployees,
  permissions,
}: Props) {
  return (
    <div className="flex flex-col gap-2">
      <div className="relative max-h-[70vh] overflow-auto rounded-md border">
        <table className="w-full border-collapse text-sm">
          <thead className="bg-muted/60 sticky top-0 z-20">
            <tr>
              <th
                scope="col"
                className="bg-muted/60 sticky left-0 z-30 min-w-[220px] border-b px-3 py-2 text-left font-medium"
              >
                Employee
              </th>
              {MODULE_KEYS.map((mod) => (
                <th
                  key={mod}
                  scope="col"
                  className="border-b border-l px-2 py-2 text-center font-medium"
                  title={MODULE_LABELS[mod]}
                >
                  <span className="whitespace-nowrap">{MODULE_LABELS[mod]}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {employees.map((emp) => (
              <PermissionRow
                key={emp.id}
                employee={emp}
                perms={permissions[emp.id] ?? {}}
                otherEmployees={allEmployees.filter((e) => e.id !== emp.id)}
              />
            ))}
            {employees.length === 0 ? (
              <tr>
                <td
                  colSpan={MODULE_KEYS.length + 1}
                  className="text-muted-foreground px-3 py-6 text-center text-sm"
                >
                  No employees match your search.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  )
}
