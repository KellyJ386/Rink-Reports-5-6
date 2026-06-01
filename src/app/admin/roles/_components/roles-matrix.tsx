"use client"

import { memo, useState, useTransition } from "react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import {
  MODULE_LABELS,
  MODULE_NAMES,
  USER_ACTION_DESCRIPTIONS,
  USER_ACTION_LABELS,
  USER_ACTIONS,
  type ModuleName,
  type UserAction,
} from "@/lib/permissions"

import { setRoleModuleAction } from "../actions"

export type RoleListItem = {
  id: string
  key: string
  display_name: string
  hierarchy_level: number
}

/** roleId -> module -> action -> enabled */
export type RoleActionDefaults = Record<
  string,
  Record<ModuleName, Record<UserAction, boolean>>
>

type Props = {
  roles: RoleListItem[]
  defaults: RoleActionDefaults
}

type ModMap = Record<ModuleName, Record<UserAction, boolean>>

const ACTION_ABBR: Record<UserAction, string> = {
  view: "V",
  submit: "S",
  edit: "E",
  admin: "A",
}

const RoleRow = memo(function RoleRow({
  role,
  defaults,
}: {
  role: RoleListItem
  defaults: ModMap
}) {
  const [, startTransition] = useTransition()
  const [local, setLocal] = useState<ModMap>(defaults)
  const [lastSynced, setLastSynced] = useState<ModMap>(defaults)

  // Re-sync local state if the server-provided defaults change (e.g. after a
  // copy-from-role action revalidates the page).
  if (lastSynced !== defaults) {
    setLastSynced(defaults)
    setLocal(defaults)
  }

  function toggle(mod: ModuleName, action: UserAction, next: boolean) {
    const prev = local
    setLocal((cur) => ({
      ...cur,
      [mod]: { ...cur[mod], [action]: next },
    }))

    startTransition(async () => {
      const res = await setRoleModuleAction(role.id, mod, action, next)
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
      {MODULE_NAMES.map((mod) => {
        const cell = local[mod] ?? {
          view: false,
          submit: false,
          edit: false,
          admin: false,
        }
        return (
          <td key={mod} className="border-b border-l px-2 py-2 align-middle">
            <div className="flex items-center justify-center gap-2">
              {USER_ACTIONS.map((action) => {
                const id = `${role.id}-${mod}-${action}`
                return (
                  <label
                    key={action}
                    htmlFor={id}
                    title={`${MODULE_LABELS[mod]} — ${USER_ACTION_LABELS[action]}: ${USER_ACTION_DESCRIPTIONS[action]}`}
                    className="flex cursor-pointer flex-col items-center gap-0.5"
                  >
                    <input
                      id={id}
                      type="checkbox"
                      checked={cell[action]}
                      onChange={(e) => toggle(mod, action, e.target.checked)}
                      aria-label={`${USER_ACTION_LABELS[action]} default for ${MODULE_LABELS[mod]} for ${role.display_name}`}
                      className="border-input text-primary focus-visible:ring-ring/50 size-4 cursor-pointer rounded border focus-visible:ring-[3px]"
                    />
                    <span className="text-muted-foreground text-[10px] leading-none">
                      {ACTION_ABBR[action]}
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

export function RolesMatrix({ roles, defaults }: Props) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-muted-foreground text-xs">
        V = View · S = Submit · E = Edit · A = Admin
      </p>
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
              {MODULE_NAMES.map((mod) => (
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
                defaults={defaults[role.id] ?? ({} as ModMap)}
              />
            ))}
            {roles.length === 0 ? (
              <tr>
                <td
                  colSpan={MODULE_NAMES.length + 1}
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
