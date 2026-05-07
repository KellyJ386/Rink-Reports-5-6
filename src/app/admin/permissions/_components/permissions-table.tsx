"use client"

import { memo, useState, useTransition } from "react"
import { toast } from "sonner"

import { cn } from "@/lib/utils"

import { setModulePermission } from "../actions"
import {
  EMPTY_FLAGS,
  MODULE_KEYS,
  MODULE_LABELS,
  type Employee,
  type ModuleKey,
  type PermissionField,
  type PermissionFlags,
  type PermissionMap,
} from "../types"

type Props = {
  employees: Employee[]
  permissions: PermissionMap
}

const FIELD_LABELS: Record<PermissionField, string> = {
  can_view: "V",
  can_submit: "S",
  can_admin: "A",
}

const FIELD_TOOLTIPS: Record<PermissionField, string> = {
  can_view: "View",
  can_submit: "Submit",
  can_admin: "Admin",
}

const FIELDS: readonly PermissionField[] = [
  "can_view",
  "can_submit",
  "can_admin",
]

type RowPerms = Partial<Record<ModuleKey, PermissionFlags>>

type PermissionRowProps = {
  employee: Employee
  perms: RowPerms
}

// Isolated per-row component — state is scoped to one employee's permissions.
// Toggling a checkbox triggers a re-render only for this row (~30 nodes),
// not the entire table.
const PermissionRow = memo(function PermissionRow({
  employee,
  perms,
}: PermissionRowProps) {
  const [, startTransition] = useTransition()
  const [local, setLocal] = useState<RowPerms>(perms)
  const [lastSynced, setLastSynced] = useState<RowPerms>(perms)

  // Re-sync from server-driven prop when the page revalidates after a mutation.
  if (lastSynced !== perms) {
    setLastSynced(perms)
    setLocal(perms)
  }

  function flagsFor(mod: ModuleKey): PermissionFlags {
    return local[mod] ?? EMPTY_FLAGS
  }

  function toggle(mod: ModuleKey, field: PermissionField, next: boolean) {
    const prev = local
    setLocal((cur) => {
      const existing: PermissionFlags = cur[mod] ?? { ...EMPTY_FLAGS }
      return { ...cur, [mod]: { ...existing, [field]: next } }
    })

    startTransition(async () => {
      const res = await setModulePermission(employee.id, mod, field, next)
      if (!res.ok) {
        setLocal(prev)
        toast.error(res.error)
      }
    })
  }

  return (
    <tr className="hover:bg-muted/30">
      <th
        scope="row"
        className="bg-background sticky left-0 z-10 border-b px-3 py-2 text-left align-top font-normal"
      >
        <div className="flex flex-col gap-0.5">
          <span className="font-medium">{employee.full_name}</span>
          <span className="text-muted-foreground text-xs">
            {employee.email ?? ""}
          </span>
          <div className="mt-1 flex flex-wrap gap-1">
            {employee.role_display_name ? (
              <span className="bg-secondary text-secondary-foreground inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-medium">
                {employee.role_display_name}
              </span>
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
        </div>
      </th>

      {MODULE_KEYS.map((mod) => {
        const f = flagsFor(mod)
        return (
          <td
            key={mod}
            className="border-b border-l px-2 py-2 align-middle"
          >
            <div className="flex items-center justify-center gap-2">
              {FIELDS.map((field) => {
                const checked = f[field]
                const id = `${employee.id}-${mod}-${field}`
                return (
                  <label
                    key={field}
                    htmlFor={id}
                    title={`${FIELD_TOOLTIPS[field]} — ${MODULE_LABELS[mod]}`}
                    className={cn(
                      "flex cursor-pointer items-center gap-1 rounded px-1 select-none",
                      "hover:bg-accent",
                    )}
                  >
                    <input
                      id={id}
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => toggle(mod, field, e.target.checked)}
                      className="border-input text-primary focus-visible:ring-ring/50 size-3.5 cursor-pointer rounded border focus-visible:ring-[3px]"
                      aria-label={`${FIELD_TOOLTIPS[field]} ${MODULE_LABELS[mod]} for ${employee.full_name}`}
                    />
                    <span
                      aria-hidden
                      className="text-muted-foreground text-[10px] font-medium"
                    >
                      {FIELD_LABELS[field]}
                    </span>
                  </label>
                )
              })}
            </div>
          </td>
        )
      })}
    </tr>
  )
})

export function PermissionsTable({ employees, permissions }: Props) {
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
                  <div className="flex flex-col items-center gap-0.5">
                    <span className="whitespace-nowrap">
                      {MODULE_LABELS[mod]}
                    </span>
                    <span className="text-muted-foreground flex gap-2 text-[10px] font-normal tracking-wider uppercase">
                      <span title="View">V</span>
                      <span title="Submit">S</span>
                      <span title="Admin">A</span>
                    </span>
                  </div>
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
