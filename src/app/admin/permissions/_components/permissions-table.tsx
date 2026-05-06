"use client"

import { useState, useTransition } from "react"
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

export function PermissionsTable({ employees, permissions }: Props) {
  const [, startTransition] = useTransition()
  // Local mirror of permissions to support optimistic UI. We re-sync to the
  // server-driven prop during render (instead of in an effect) so we don't
  // trigger cascading renders. The pattern follows React's "adjust state
  // while rendering" guidance — comparing a stored snapshot to the latest
  // prop and resetting when it changes.
  const [local, setLocal] = useState<PermissionMap>(permissions)
  const [lastSynced, setLastSynced] =
    useState<PermissionMap>(permissions)

  if (lastSynced !== permissions) {
    setLastSynced(permissions)
    setLocal(permissions)
  }

  function flagsFor(employeeId: string, mod: ModuleKey): PermissionFlags {
    return local[employeeId]?.[mod] ?? EMPTY_FLAGS
  }

  function toggle(
    employeeId: string,
    mod: ModuleKey,
    field: PermissionField,
    next: boolean,
  ) {
    // Optimistic write.
    const prev = local
    setLocal((cur) => {
      const empBag = { ...(cur[employeeId] ?? {}) }
      const existing: PermissionFlags = empBag[mod] ?? { ...EMPTY_FLAGS }
      empBag[mod] = { ...existing, [field]: next }
      return { ...cur, [employeeId]: empBag }
    })

    startTransition(async () => {
      const res = await setModulePermission(employeeId, mod, field, next)
      if (!res.ok) {
        setLocal(prev) // rollback
        toast.error(res.error)
      }
    })
  }

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
              <tr key={emp.id} className="hover:bg-muted/30">
                <th
                  scope="row"
                  className="bg-background sticky left-0 z-10 border-b px-3 py-2 text-left align-top font-normal"
                >
                  <div className="flex flex-col gap-0.5">
                    <span className="font-medium">{emp.full_name}</span>
                    <span className="text-muted-foreground text-xs">
                      {emp.email ?? ""}
                    </span>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {emp.role_display_name ? (
                        <span className="bg-secondary text-secondary-foreground inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-medium">
                          {emp.role_display_name}
                        </span>
                      ) : null}
                      {emp.departments.map((d) => (
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
                  const f = flagsFor(emp.id, mod)
                  return (
                    <td
                      key={mod}
                      className="border-b border-l px-2 py-2 align-middle"
                    >
                      <div className="flex items-center justify-center gap-2">
                        {FIELDS.map((field) => {
                          const checked = f[field]
                          const id = `${emp.id}-${mod}-${field}`
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
                                onChange={(e) =>
                                  toggle(emp.id, mod, field, e.target.checked)
                                }
                                className="border-input text-primary focus-visible:ring-ring/50 size-3.5 cursor-pointer rounded border focus-visible:ring-[3px]"
                                aria-label={`${FIELD_TOOLTIPS[field]} ${MODULE_LABELS[mod]} for ${emp.full_name}`}
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
