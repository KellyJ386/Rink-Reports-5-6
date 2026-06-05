"use client"

import { useMemo, useState, useTransition } from "react"

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
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

import { startPreviewAs } from "@/lib/auth/preview-actions"

import {
  deactivateEmployee,
  deleteEmployee,
  reactivateEmployee,
} from "../actions"
import { inviteEmployee } from "../actions"
import type {
  EmployeeListItem,
  JobAreaOption,
  RoleDefaultsMap,
  RoleRow,
} from "../types"
import { EmployeeForm } from "./employee-form"

type Props = {
  facilityId: string
  employees: EmployeeListItem[]
  roles: RoleRow[]
  jobAreas: JobAreaOption[]
  roleDefaults: RoleDefaultsMap
  canDelete: boolean
}

type StatusFilter = "active" | "inactive" | "all"

const STATUS_FILTERS: { key: StatusFilter; label: string }[] = [
  { key: "active", label: "Active" },
  { key: "inactive", label: "Inactive" },
  { key: "all", label: "All" },
]

function initialsOf(first: string, last: string): string {
  const f = first.trim().charAt(0).toUpperCase()
  const l = last.trim().charAt(0).toUpperCase()
  return `${f}${l}` || "?"
}

export function EmployeesClient({
  facilityId,
  employees,
  roles,
  jobAreas,
  roleDefaults,
  canDelete,
}: Props) {
  const [query, setQuery] = useState("")
  const [status, setStatus] = useState<StatusFilter>("active")
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<EmployeeListItem | null>(null)
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [rowError, setRowError] = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState<{
    id: string
    name: string
  } | null>(null)
  const [pendingDeactivate, setPendingDeactivate] = useState<{
    id: string
    name: string
  } | null>(null)
  const [, startTransition] = useTransition()

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return employees.filter((e) => {
      if (status === "active" && !e.is_active) return false
      if (status === "inactive" && e.is_active) return false
      if (!q) return true
      const haystack = [
        e.first_name,
        e.last_name,
        e.email ?? "",
        e.phone ?? "",
        e.role?.display_name ?? "",
        e.role?.key ?? "",
        e.employee_code ?? "",
      ]
        .join(" ")
        .toLowerCase()
      return haystack.includes(q)
    })
  }, [employees, query, status])

  function openCreate() {
    setEditing(null)
    setFormOpen(true)
  }

  function openEdit(emp: EmployeeListItem) {
    setEditing(emp)
    setFormOpen(true)
  }

  function runRowAction(
    id: string,
    fn: (id: string) => Promise<{ ok: boolean; error?: string } | unknown>
  ) {
    setPendingId(id)
    setRowError(null)
    startTransition(async () => {
      const r = (await fn(id)) as { ok: boolean; error?: string } | undefined
      if (r && r.ok === false) {
        setRowError(r.error ?? "Action failed.")
      }
      setPendingId(null)
    })
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Input
            placeholder="Search by name, email, role, code..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-72 max-w-full"
          />
          <div className="flex items-center gap-1 rounded-md border p-1">
            {STATUS_FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                onClick={() => setStatus(f.key)}
                className={cn(
                  "rounded px-3 py-1 text-xs font-medium transition-colors",
                  status === f.key
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                )}
              >
                {f.label}
              </button>
            ))}
          </div>
          <span className="text-muted-foreground text-sm">
            {filtered.length} of {employees.length}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Button asChild variant="outline">
            <a href={`/admin/employees/bulk?facility=${facilityId}`}>Bulk add</a>
          </Button>
          <Button onClick={openCreate}>Add employee</Button>
        </div>
      </div>

      {rowError && (
        <p role="alert" className="text-destructive text-sm">
          {rowError}
        </p>
      )}

      {filtered.length === 0 ? (
        <div className="rounded-md border p-8 text-center">
          <p className="text-base font-medium">No employees match.</p>
          <p className="text-muted-foreground mt-1 text-sm">
            {employees.length === 0
              ? "Add your first employee to get started."
              : "Try changing the filter or search."}
          </p>
          {employees.length === 0 && (
            <div className="mt-4">
              <Button onClick={openCreate}>Add employee</Button>
            </div>
          )}
        </div>
      ) : (
        <div className="overflow-auto rounded-md border">
          <table className="w-full border-collapse text-sm">
            <thead className="bg-muted/60 sticky top-0 z-10">
              <tr>
                <th className="border-b px-3 py-2 text-left font-medium">
                  Name
                </th>
                <th className="border-b px-3 py-2 text-left font-medium">
                  Role
                </th>
                <th className="border-b px-3 py-2 text-left font-medium">
                  Email
                </th>
                <th className="border-b px-3 py-2 text-left font-medium">
                  Phone
                </th>
                <th className="border-b px-3 py-2 text-left font-medium">
                  Status
                </th>
                <th className="border-b px-3 py-2 text-right font-medium">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((e) => {
                const isPending = pendingId === e.id
                return (
                  <tr key={e.id} className="hover:bg-muted/30">
                    <td className="border-b px-3 py-2 align-middle">
                      <div className="flex items-center gap-3">
                        <span
                          aria-hidden
                          className="bg-muted text-muted-foreground inline-flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold"
                        >
                          {initialsOf(e.first_name, e.last_name)}
                        </span>
                        <div className="flex flex-col">
                          <a
                            href={`/admin/employees/${e.id}`}
                            className="font-medium hover:underline"
                          >
                            {e.first_name} {e.last_name}
                          </a>
                          <span className="text-muted-foreground text-xs">
                            {e.employee_code ?? "—"}
                            {e.is_minor ? " · Minor" : ""}
                          </span>
                        </div>
                      </div>
                    </td>
                    <td className="border-b px-3 py-2 align-middle">
                      {e.role ? (
                        <Badge variant="secondary">{e.role.display_name}</Badge>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="border-b px-3 py-2 align-middle">
                      {e.email ?? (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="border-b px-3 py-2 align-middle">
                      {e.phone ?? (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="border-b px-3 py-2 align-middle">
                      {e.is_active ? (
                        <Badge variant="success">Active</Badge>
                      ) : (
                        <Badge variant="secondary">Inactive</Badge>
                      )}
                    </td>
                    <td className="border-b px-3 py-2 align-middle">
                      <div className="flex flex-wrap items-center justify-end gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => openEdit(e)}
                          disabled={isPending}
                        >
                          Edit
                        </Button>
                        {e.is_active && e.email && !e.user_id ? (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() =>
                              runRowAction(e.id, inviteEmployee)
                            }
                            disabled={isPending}
                            title={`Send a magic-link invite to ${e.email}`}
                          >
                            Invite
                          </Button>
                        ) : null}
                        {e.is_active ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              runRowAction(e.id, (id) => startPreviewAs(id))
                            }
                            disabled={isPending}
                            title={`Preview the app as ${e.first_name} ${e.last_name}`}
                          >
                            Preview
                          </Button>
                        ) : null}
                        {e.is_active ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              setPendingDeactivate({
                                id: e.id,
                                name: `${e.first_name} ${e.last_name}`,
                              })
                            }
                            disabled={isPending}
                          >
                            Deactivate
                          </Button>
                        ) : (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              runRowAction(e.id, reactivateEmployee)
                            }
                            disabled={isPending}
                          >
                            Reactivate
                          </Button>
                        )}
                        {canDelete && (
                          <Button
                            type="button"
                            variant="destructive"
                            size="sm"
                            onClick={() =>
                              setPendingDelete({
                                id: e.id,
                                name: `${e.first_name} ${e.last_name}`,
                              })
                            }
                            disabled={isPending}
                          >
                            Delete
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <EmployeeForm
        open={formOpen}
        onOpenChange={setFormOpen}
        facilityId={facilityId}
        roles={roles}
        jobAreas={jobAreas}
        roleDefaults={roleDefaults}
        editing={editing}
      />

      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this employee?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDelete
                ? `Delete ${pendingDelete.name}? This cannot be undone.`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pendingDelete) {
                  runRowAction(pendingDelete.id, deleteEmployee)
                }
                setPendingDelete(null)
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={pendingDeactivate !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDeactivate(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Deactivate this employee?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDeactivate
                ? `${pendingDeactivate.name} will lose access immediately and stop appearing in shift assignments and routing rules. You can reactivate them later from this same list.`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pendingDeactivate) {
                  runRowAction(pendingDeactivate.id, deactivateEmployee)
                }
                setPendingDeactivate(null)
              }}
            >
              Deactivate
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
