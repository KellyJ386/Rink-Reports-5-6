"use client"

import { useState, useTransition } from "react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { LocalDateTime } from "@/components/app/local-datetime"
import {
  PERMISSION_LEVELS,
  PERMISSION_LEVEL_LABELS,
  type PermissionLevel,
} from "@/lib/permissions"
import type { PermissionSource } from "@/lib/permissions/types"

import { MODULE_LABELS, type ModuleKey } from "../../../permissions/types"
import {
  addEmployeeCertification,
  addEmployeeToGroup,
  clearEmployeeModuleOverride,
  deleteEmployeeCertification,
  removeEmployeeFromGroup,
  setEmployeeModuleOverride,
  updateEmployeeCertification,
  type CertificationInput,
} from "../actions"
import { inviteEmployee } from "../../actions"

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
    user_id: string | null
    role: {
      id: string
      key: string
      display_name: string
      hierarchy_level: number
    } | null
  }
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
  /** Facility certification catalog names — datalist suggestions so cert
   * names are picked, not re-typed (typo = broken scheduling enforcement). */
  certTypeNames: string[]
  certifications: Array<{
    id: string
    name: string
    issuer: string | null
    issued_at: string | null
    expires_at: string | null
    notes: string | null
  }>
}

const SOURCE_BADGE_LABEL: Record<PermissionSource, string> = {
  super_admin: "platform super",
  override: "override",
  role: "role",
  none: "none",
}

const SOURCE_BADGE_CLASS: Record<PermissionSource, string> = {
  super_admin: "bg-destructive-soft text-destructive-soft-foreground",
  override: "bg-[var(--violet-100)] text-[var(--violet-600)] dark:bg-[rgba(154,130,255,0.18)] dark:text-[var(--violet-200)]",
  role: "bg-info-soft text-info-soft-foreground",
  none: "bg-muted text-muted-foreground",
}

export function EmployeeDetail({ data }: { data: EmployeeDetailData }) {
  return (
    <Tabs defaultValue="profile" className="w-full">
      <TabsList className="flex flex-wrap">
        <TabsTrigger value="profile">Profile</TabsTrigger>
        <TabsTrigger value="certifications">Certifications</TabsTrigger>
        <TabsTrigger value="access">Module Access</TabsTrigger>
        <TabsTrigger value="groups">Communication Groups</TabsTrigger>
        <TabsTrigger value="activity">Activity</TabsTrigger>
      </TabsList>

      <TabsContent value="profile">
        <ProfileTab data={data} />
      </TabsContent>
      <TabsContent value="certifications">
        <CertificationsTab data={data} />
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
  const [pending, startTransition] = useTransition()

  function handleInvite() {
    startTransition(async () => {
      const result = await inviteEmployee(e.id)
      if (!result.ok) {
        toast.error(result.error)
      } else if (result.invited) {
        toast.success(`Invitation sent to ${e.email}.`)
      } else {
        toast.success("Existing account linked. No email sent.")
      }
    })
  }

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
        <Field
          label="Login account"
          value={e.user_id ? "Linked" : "Not linked"}
        />
        <p className="text-muted-foreground col-span-full text-xs">
          To edit fields, use the Employees list and open the edit panel.
        </p>
        {!e.user_id && e.email && (
          <div className="col-span-full pt-1">
            <Button
              size="sm"
              variant="outline"
              onClick={handleInvite}
              disabled={pending}
            >
              {pending ? "Sending…" : "Send login invitation"}
            </Button>
            <p className="text-muted-foreground mt-1 text-xs">
              Sends an invitation email to {e.email} so this employee can log in.
            </p>
          </div>
        )}
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

type CertificationRow = EmployeeDetailData["certifications"][number]

const EMPTY_CERT: CertificationInput = {
  name: "",
  issuer: null,
  issued_at: null,
  expires_at: null,
  notes: null,
}

function expirationStatus(
  expiresAt: string | null
): { label: string; tone: "ok" | "warn" | "danger" | "none" } {
  if (!expiresAt) return { label: "No expiration", tone: "none" }
  const today = new Date()
  const exp = new Date(expiresAt + "T00:00:00")
  const days = Math.round(
    (exp.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
  )
  if (days < 0) return { label: `Expired ${-days}d ago`, tone: "danger" }
  if (days <= 30) return { label: `Expires in ${days}d`, tone: "warn" }
  return { label: `Expires ${expiresAt}`, tone: "ok" }
}

function CertificationsTab({ data }: { data: EmployeeDetailData }) {
  const [, startTransition] = useTransition()
  const [rows, setRows] = useState<CertificationRow[]>(data.certifications)
  const [draft, setDraft] = useState<CertificationInput>(EMPTY_CERT)
  const [editingId, setEditingId] = useState<string | null>(null)

  function commit(action: () => Promise<{ ok: boolean; error?: string }>) {
    startTransition(async () => {
      const r = await action()
      if (!r.ok) {
        toast.error(r.error ?? "Failed.")
      }
    })
  }

  function handleAdd() {
    if (!draft.name.trim()) {
      toast.error("Name is required.")
      return
    }
    const optimistic: CertificationRow = {
      id: `tmp-${Date.now()}`,
      name: draft.name.trim(),
      issuer: draft.issuer?.trim() || null,
      issued_at: draft.issued_at || null,
      expires_at: draft.expires_at || null,
      notes: draft.notes?.trim() || null,
    }
    setRows((rs) => [...rs, optimistic])
    const payload = draft
    setDraft(EMPTY_CERT)
    commit(() => addEmployeeCertification(data.employee.id, payload))
  }

  function handleSaveEdit(id: string, input: CertificationInput) {
    setRows((rs) =>
      rs.map((r) =>
        r.id === id
          ? {
              ...r,
              name: input.name.trim(),
              issuer: input.issuer?.trim() || null,
              issued_at: input.issued_at || null,
              expires_at: input.expires_at || null,
              notes: input.notes?.trim() || null,
            }
          : r
      )
    )
    setEditingId(null)
    commit(() => updateEmployeeCertification(data.employee.id, id, input))
  }

  function handleDelete(id: string) {
    if (!window.confirm("Delete this certification?")) return
    setRows((rs) => rs.filter((r) => r.id !== id))
    commit(() => deleteEmployeeCertification(data.employee.id, id))
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-4 p-6">
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium">Add certification</p>
          <div className="grid grid-cols-1 gap-2 md:grid-cols-5">
            <input
              className="border-input bg-background col-span-2 rounded border px-2 py-1 text-sm"
              placeholder="Name (e.g. CPR/AED)"
              value={draft.name}
              list="employee-cert-type-suggestions"
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
            <datalist id="employee-cert-type-suggestions">
              {data.certTypeNames.map((name) => (
                <option key={name} value={name} />
              ))}
            </datalist>
            <input
              className="border-input bg-background rounded border px-2 py-1 text-sm"
              placeholder="Issuer (optional)"
              value={draft.issuer ?? ""}
              onChange={(e) => setDraft({ ...draft, issuer: e.target.value })}
            />
            <input
              type="date"
              className="border-input bg-background rounded border px-2 py-1 text-sm"
              value={draft.issued_at ?? ""}
              onChange={(e) =>
                setDraft({ ...draft, issued_at: e.target.value || null })
              }
              title="Issued on"
            />
            <input
              type="date"
              className="border-input bg-background rounded border px-2 py-1 text-sm"
              value={draft.expires_at ?? ""}
              onChange={(e) =>
                setDraft({ ...draft, expires_at: e.target.value || null })
              }
              title="Expires on"
            />
          </div>
          <div className="flex justify-end">
            <Button size="sm" onClick={handleAdd}>
              Add
            </Button>
          </div>
        </div>

        <div className="border-t pt-4">
          {rows.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              No certifications on file yet.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {rows.map((r) => {
                const status = expirationStatus(r.expires_at)
                const isEditing = editingId === r.id
                return (
                  <li
                    key={r.id}
                    className="border-border rounded border p-3 text-sm"
                  >
                    {isEditing ? (
                      <CertificationEditor
                        initial={{
                          name: r.name,
                          issuer: r.issuer,
                          issued_at: r.issued_at,
                          expires_at: r.expires_at,
                          notes: r.notes,
                        }}
                        onCancel={() => setEditingId(null)}
                        onSave={(input) => handleSaveEdit(r.id, input)}
                      />
                    ) : (
                      <div className="flex flex-wrap items-center gap-3">
                        <div className="flex flex-col">
                          <span className="font-medium">{r.name}</span>
                          <span className="text-muted-foreground text-xs">
                            {r.issuer ?? "—"}
                            {r.issued_at ? ` · issued ${r.issued_at}` : ""}
                          </span>
                        </div>
                        <Badge
                          className={
                            status.tone === "danger"
                              ? "bg-destructive-soft text-destructive-soft-foreground"
                              : status.tone === "warn"
                                ? "bg-warning-soft text-warning-soft-foreground"
                                : status.tone === "ok"
                                  ? "bg-success-soft text-success-soft-foreground"
                                  : "bg-muted text-muted-foreground"
                          }
                        >
                          {status.label}
                        </Badge>
                        <div className="ml-auto flex gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setEditingId(r.id)}
                          >
                            Edit
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleDelete(r.id)}
                          >
                            Delete
                          </Button>
                        </div>
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

function CertificationEditor({
  initial,
  onCancel,
  onSave,
}: {
  initial: CertificationInput
  onCancel: () => void
  onSave: (input: CertificationInput) => void
}) {
  const [v, setV] = useState<CertificationInput>(initial)
  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-1 gap-2 md:grid-cols-5">
        <input
          className="border-input bg-background col-span-2 rounded border px-2 py-1 text-sm"
          value={v.name}
          list="employee-cert-type-suggestions"
          onChange={(e) => setV({ ...v, name: e.target.value })}
        />
        <input
          className="border-input bg-background rounded border px-2 py-1 text-sm"
          placeholder="Issuer"
          value={v.issuer ?? ""}
          onChange={(e) => setV({ ...v, issuer: e.target.value })}
        />
        <input
          type="date"
          className="border-input bg-background rounded border px-2 py-1 text-sm"
          value={v.issued_at ?? ""}
          onChange={(e) => setV({ ...v, issued_at: e.target.value || null })}
        />
        <input
          type="date"
          className="border-input bg-background rounded border px-2 py-1 text-sm"
          value={v.expires_at ?? ""}
          onChange={(e) => setV({ ...v, expires_at: e.target.value || null })}
        />
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="sm" onClick={() => onSave(v)}>
          Save
        </Button>
      </div>
    </div>
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
                    <LocalDateTime iso={row.created_at} />
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
