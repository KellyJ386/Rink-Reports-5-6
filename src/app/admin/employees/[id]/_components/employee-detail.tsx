"use client"

import { useState, useTransition } from "react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  PERMISSION_LEVELS,
  PERMISSION_LEVEL_LABELS,
  type PermissionLevel,
} from "@/lib/permissions"
import type { PermissionSource } from "@/lib/permissions/types"

import { MODULE_LABELS, type ModuleKey } from "../../../permissions/types"
import {
  addEmployeeToGroup,
  clearEmployeeModuleOverride,
  removeEmployeeFromGroup,
  setEmployeeModuleOverride,
} from "../actions"

export type EmployeeDetailData = {
  employee: {
    id: string
    facility_id: string
    first_name: string
    last_name: string
    email: string | null
    phone: string | null
    is_active: boolean
    is_minor: boolean
    employee_code: string | null
    hire_date: string | null
    emergency_contact_name: string | null
    emergency_contact_phone: string | null
    created_at: string
    role: {
      id: string
      key: string
      display_name: string
      hierarchy_level: number
    } | null
  }
  departments: Array<{ id: string; name: string; color: string | null }>
  employeeDepartments: Array<{ department_id: string; is_primary: boolean }>
  groups: Array<{ id: string; name: string }>
  memberships: Array<{ id: string; group_id: string }>
  moduleAccess: Array<{
    moduleKey: ModuleKey
    level: PermissionLevel
    source: PermissionSource
  }>
  audit: Array<{
    id: string
    action: string
    entity_type: string
    entity_id: string | null
    created_at: string
  }>
}

const SOURCE_BADGE_LABEL: Record<PermissionSource, string> = {
  super_admin: "platform super",
  override: "override",
  role: "role",
  department: "department",
  facility: "facility",
  none: "none",
}

const SOURCE_BADGE_CLASS: Record<PermissionSource, string> = {
  super_admin: "bg-rose-800/60 text-rose-100",
  override: "bg-violet-800/60 text-violet-100",
  role: "bg-sky-800/60 text-sky-100",
  department: "bg-emerald-800/60 text-emerald-100",
  facility: "bg-amber-800/60 text-amber-100",
  none: "bg-muted text-muted-foreground",
}

export function EmployeeDetail({ data }: { data: EmployeeDetailData }) {
  return (
    <Tabs defaultValue="profile" className="w-full">
      <TabsList className="flex flex-wrap">
        <TabsTrigger value="profile">Profile</TabsTrigger>
        <TabsTrigger value="departments">Departments</TabsTrigger>
        <TabsTrigger value="access">Module Access</TabsTrigger>
        <TabsTrigger value="groups">Communication Groups</TabsTrigger>
        <TabsTrigger value="activity">Activity</TabsTrigger>
      </TabsList>

      <TabsContent value="profile">
        <ProfileTab data={data} />
      </TabsContent>
      <TabsContent value="departments">
        <DepartmentsTab data={data} />
      </TabsContent>
      <TabsContent value="access">
        <ModuleAccessTab data={data} />
      </TabsContent>
      <TabsContent value="groups">
        <GroupsTab data={data} />
      </TabsContent>
      <TabsContent value="activity">
        <ActivityTab data={data} />
      </TabsContent>
    </Tabs>
  )
}

function ProfileTab({ data }: { data: EmployeeDetailData }) {
  const e = data.employee
  return (
    <Card>
      <CardContent className="grid grid-cols-1 gap-x-6 gap-y-3 p-6 sm:grid-cols-2">
        <Field label="Name" value={`${e.first_name} ${e.last_name}`} />
        <Field label="Role" value={e.role?.display_name ?? "—"} />
        <Field label="Email" value={e.email ?? "—"} />
        <Field label="Phone" value={e.phone ?? "—"} />
        <Field label="Employee code" value={e.employee_code ?? "—"} />
        <Field label="Hire date" value={e.hire_date ?? "—"} />
        <Field
          label="Status"
          value={e.is_active ? "Active" : "Inactive"}
        />
        <Field label="Minor" value={e.is_minor ? "Yes" : "No"} />
        <Field
          label="Emergency contact"
          value={e.emergency_contact_name ?? "—"}
        />
        <Field
          label="Emergency phone"
          value={e.emergency_contact_phone ?? "—"}
        />
        <p className="text-muted-foreground col-span-full text-xs">
          To edit fields, use the Employees list and open the edit panel.
        </p>
      </CardContent>
    </Card>
  )
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col">
      <span className="text-muted-foreground text-xs uppercase">{label}</span>
      <span className="text-sm">{value}</span>
    </div>
  )
}

function DepartmentsTab({ data }: { data: EmployeeDetailData }) {
  const assigned = new Map(
    data.employeeDepartments.map((r) => [r.department_id, r.is_primary]),
  )
  return (
    <Card>
      <CardContent className="flex flex-col gap-2 p-6">
        {data.departments.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No departments defined for this facility yet.
          </p>
        ) : (
          data.departments.map((d) => {
            const isMember = assigned.has(d.id)
            const isPrimary = assigned.get(d.id) === true
            return (
              <div
                key={d.id}
                className="flex items-center justify-between rounded-md border px-3 py-2 text-sm"
              >
                <div className="flex items-center gap-2">
                  <span
                    aria-hidden
                    className="inline-block h-3 w-3 rounded-full"
                    style={{ backgroundColor: d.color ?? "#888" }}
                  />
                  <span className="font-medium">{d.name}</span>
                  {isMember ? (
                    <Badge variant="secondary" className="text-[10px]">
                      member
                    </Badge>
                  ) : null}
                  {isPrimary ? (
                    <Badge className="text-[10px]">primary</Badge>
                  ) : null}
                </div>
              </div>
            )
          })
        )}
        <p className="text-muted-foreground mt-2 text-xs">
          Department assignments are edited on the Employees list (the edit
          panel). This view is read-only.
        </p>
      </CardContent>
    </Card>
  )
}

function ModuleAccessTab({ data }: { data: EmployeeDetailData }) {
  const [pending, startTransition] = useTransition()
  const [rows, setRows] = useState(data.moduleAccess)

  function setOverride(moduleKey: ModuleKey, level: PermissionLevel) {
    const prev = rows
    setRows((cur) =>
      cur.map((r) =>
        r.moduleKey === moduleKey ? { ...r, level, source: "override" } : r,
      ),
    )
    startTransition(async () => {
      const res = await setEmployeeModuleOverride(
        data.employee.id,
        moduleKey,
        level,
      )
      if (!res.ok) {
        setRows(prev)
        toast.error(res.error)
      }
    })
  }

  function clearOverride(moduleKey: ModuleKey) {
    startTransition(async () => {
      const res = await clearEmployeeModuleOverride(
        data.employee.id,
        moduleKey,
      )
      if (!res.ok) {
        toast.error(res.error)
        return
      }
      toast.success("Override cleared. Re-resolving…")
      // Optimistic: leave UI as-is until next nav.
    })
  }

  return (
    <Card>
      <CardContent className="p-0">
        <table className="w-full text-sm">
          <thead className="bg-muted/60">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Module</th>
              <th className="px-3 py-2 text-left font-medium">
                Effective level
              </th>
              <th className="px-3 py-2 text-left font-medium">Source</th>
              <th className="px-3 py-2 text-left font-medium">
                Set override
              </th>
              <th className="px-3 py-2 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.moduleKey} className="border-t">
                <td className="px-3 py-2 font-medium">
                  {MODULE_LABELS[row.moduleKey]}
                </td>
                <td className="px-3 py-2">
                  {PERMISSION_LEVEL_LABELS[row.level]}
                </td>
                <td className="px-3 py-2">
                  <span
                    className={`inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-medium ${SOURCE_BADGE_CLASS[row.source]}`}
                  >
                    {SOURCE_BADGE_LABEL[row.source]}
                  </span>
                </td>
                <td className="px-3 py-2">
                  <select
                    value={row.source === "override" ? row.level : ""}
                    onChange={(e) =>
                      setOverride(
                        row.moduleKey,
                        e.target.value as PermissionLevel,
                      )
                    }
                    disabled={pending}
                    className="border-input h-8 rounded-md border px-2 text-xs"
                  >
                    <option value="" disabled>
                      — set override —
                    </option>
                    {PERMISSION_LEVELS.map((l) => (
                      <option key={l} value={l}>
                        {PERMISSION_LEVEL_LABELS[l]}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-3 py-2 text-right">
                  {row.source === "override" ? (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={pending}
                      onClick={() => clearOverride(row.moduleKey)}
                    >
                      Clear override
                    </Button>
                  ) : (
                    <span className="text-muted-foreground text-xs">
                      no override
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="text-muted-foreground p-3 text-xs">
          Source tells you where the effective level comes from: override → role
          → department → facility → none. Setting an override always wins.
        </p>
      </CardContent>
    </Card>
  )
}

function GroupsTab({ data }: { data: EmployeeDetailData }) {
  const [pending, startTransition] = useTransition()
  const [memberships, setMemberships] = useState(data.memberships)
  const [picker, setPicker] = useState<string>("")

  const membershipByGroup = new Map(memberships.map((m) => [m.group_id, m.id]))

  function add() {
    if (!picker) return
    startTransition(async () => {
      const res = await addEmployeeToGroup(data.employee.id, picker)
      if (!res.ok) {
        toast.error(res.error)
        return
      }
      toast.success("Added to group")
      // We don't know the new row id; reload-on-revalidate handles it.
      setMemberships((cur) => [
        ...cur,
        { id: `pending-${picker}`, group_id: picker },
      ])
      setPicker("")
    })
  }

  function remove(memberId: string, groupId: string) {
    const prev = memberships
    setMemberships((cur) => cur.filter((m) => m.id !== memberId))
    startTransition(async () => {
      const res = await removeEmployeeFromGroup(data.employee.id, memberId)
      if (!res.ok) {
        setMemberships(prev)
        toast.error(res.error)
        return
      }
      toast.success("Removed from group")
      void groupId
    })
  }

  const nonMemberGroups = data.groups.filter((g) => !membershipByGroup.has(g.id))

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-6">
        {memberships.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            Not a member of any communication groups.
          </p>
        ) : (
          <ul className="flex flex-col gap-1">
            {memberships.map((m) => {
              const g = data.groups.find((x) => x.id === m.group_id)
              return (
                <li
                  key={m.id}
                  className="flex items-center justify-between rounded-md border px-3 py-2 text-sm"
                >
                  <span>{g?.name ?? m.group_id}</span>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={pending || m.id.startsWith("pending-")}
                    onClick={() => remove(m.id, m.group_id)}
                  >
                    Remove
                  </Button>
                </li>
              )
            })}
          </ul>
        )}

        {nonMemberGroups.length > 0 ? (
          <div className="flex flex-col gap-2 border-t pt-3 sm:flex-row sm:items-end">
            <div className="flex flex-1 flex-col gap-1">
              <label className="text-muted-foreground text-xs">Add to group</label>
              <select
                value={picker}
                onChange={(e) => setPicker(e.target.value)}
                className="border-input h-9 rounded-md border px-2 text-sm"
              >
                <option value="">— pick a group —</option>
                {nonMemberGroups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            </div>
            <Button onClick={add} disabled={pending || !picker}>
              Add
            </Button>
          </div>
        ) : (
          <p className="text-muted-foreground text-xs">
            Already in every active group.
          </p>
        )}
      </CardContent>
    </Card>
  )
}

function ActivityTab({ data }: { data: EmployeeDetailData }) {
  return (
    <Card>
      <CardContent className="p-0">
        {data.audit.length === 0 ? (
          <p className="text-muted-foreground p-6 text-sm">
            No audit entries yet.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-muted/60">
              <tr>
                <th className="px-3 py-2 text-left font-medium">When</th>
                <th className="px-3 py-2 text-left font-medium">Action</th>
                <th className="px-3 py-2 text-left font-medium">Entity</th>
              </tr>
            </thead>
            <tbody>
              {data.audit.map((row) => (
                <tr key={row.id} className="border-t">
                  <td className="px-3 py-2 text-xs">
                    {new Date(row.created_at).toLocaleString()}
                  </td>
                  <td className="px-3 py-2">{row.action}</td>
                  <td className="px-3 py-2 text-xs">
                    {row.entity_type}
                    {row.entity_id ? (
                      <span className="text-muted-foreground">
                        {" · "}
                        {row.entity_id.slice(0, 8)}…
                      </span>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  )
}
