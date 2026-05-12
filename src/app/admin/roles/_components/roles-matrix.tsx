"use client"

import { memo, useState, useTransition } from "react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import {
  PERMISSION_LEVELS,
  PERMISSION_LEVEL_DESCRIPTIONS,
  PERMISSION_LEVEL_LABELS,
  type PermissionLevel,
} from "@/lib/permissions"
import { cn } from "@/lib/utils"

import { MODULE_KEYS, MODULE_LABELS, type ModuleKey } from "../../permissions/types"
import { setRoleModulePermissionLevel } from "../actions"

export type RoleListItem = {
  id: string
  key: string
  display_name: string
  hierarchy_level: number
}

export type RoleDefaultsMap = Record<string, Partial<Record<ModuleKey, PermissionLevel>>>

type Props = {
  roles: RoleListItem[]
  defaults: RoleDefaultsMap
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

type RowMap = Partial<Record<ModuleKey, PermissionLevel>>

const RoleRow = memo(function RoleRow({
  role,
  defaults,
}: {
  role: RoleListItem
  defaults: RowMap
}) {
  const [, startTransition] = useTransition()
  const [local, setLocal] = useState<RowMap>(defaults)
  const [lastSynced, setLastSynced] = useState<RowMap>(defaults)

  if (lastSynced !== defaults) {
    setLastSynced(defaults)
    setLocal(defaults)
  }

  function levelFor(mod: ModuleKey): PermissionLevel {
    return local[mod] ?? "none"
  }

  function setLevel(mod: ModuleKey, next: PermissionLevel) {
    const prev = local
    setLocal((cur) => ({ ...cur, [mod]: next }))

    startTransition(async () => {
      const res = await setRoleModulePermissionLevel(role.id, mod, next)
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
        className="bg-background sticky left-0 z-10 border-b px-3 py-2 text-left align-middle font-normal"
      >
        <div className="flex flex-col gap-0.5">
          <span className="font-medium">{role.display_name}</span>
          <Badge variant="secondary" className="w-fit text-[10px]">
            {role.key}
          </Badge>
        </div>
      </th>
      {MODULE_KEYS.map((mod) => {
        const level = levelFor(mod)
        const id = `${role.id}-${mod}-level`
        return (
          <td key={mod} className="border-b border-l px-2 py-2 align-middle">
            <div className="flex justify-center">
              <select
                id={id}
                value={level}
                onChange={(e) => setLevel(mod, e.target.value as PermissionLevel)}
                title={`${MODULE_LABELS[mod]} — ${PERMISSION_LEVEL_DESCRIPTIONS[level]}`}
                aria-label={`Default level for ${MODULE_LABELS[mod]} for ${role.display_name}`}
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
  )
})

export function RolesMatrix({ roles, defaults }: Props) {
  return (
    <div className="flex flex-col gap-2">
      <div className="relative max-h-[70vh] overflow-auto rounded-md border">
        <table className="w-full border-collapse text-sm">
          <thead className="bg-muted/60 sticky top-0 z-20">
            <tr>
              <th
                scope="col"
                className="bg-muted/60 sticky left-0 z-30 min-w-[200px] border-b px-3 py-2 text-left font-medium"
              >
                Role
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
            {roles.map((role) => (
              <RoleRow
                key={role.id}
                role={role}
                defaults={defaults[role.id] ?? {}}
              />
            ))}
            {roles.length === 0 ? (
              <tr>
                <td
                  colSpan={MODULE_KEYS.length + 1}
                  className="text-muted-foreground px-3 py-6 text-center text-sm"
                >
                  No roles yet. Seed roles on the Employees page first.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  )
}
