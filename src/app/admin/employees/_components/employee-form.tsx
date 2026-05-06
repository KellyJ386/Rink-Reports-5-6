"use client"

import { useActionState, useEffect, useState } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { cn } from "@/lib/utils"

import { createEmployee, updateEmployee } from "../actions"
import type {
  ActionState,
  DepartmentRow,
  EmployeeListItem,
  RoleRow,
} from "../types"

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  facilityId: string
  roles: RoleRow[]
  departments: DepartmentRow[]
  editing: EmployeeListItem | null
}

export function EmployeeForm(props: Props) {
  // Wrap with a key so that switching between "new" and "edit:<id>" remounts
  // the inner form, naturally resetting all local state without a setState-
  // in-effect pattern.
  const formKey = props.editing ? `edit:${props.editing.id}` : "new"
  return (
    <Sheet open={props.open} onOpenChange={props.onOpenChange}>
      <SheetContent
        side="right"
        className="w-full max-w-lg overflow-y-auto sm:max-w-xl"
      >
        <EmployeeFormBody key={formKey} {...props} />
      </SheetContent>
    </Sheet>
  )
}

const INITIAL_STATE: ActionState = { ok: null }

function EmployeeFormBody({
  onOpenChange,
  facilityId,
  roles,
  departments,
  editing,
}: Props) {
  const isEdit = editing !== null

  // Two distinct actions; pick one via local form state on the server.
  const [createState, createAction, createPending] = useActionState(
    createEmployee,
    INITIAL_STATE
  )
  const [updateState, updateAction, updatePending] = useActionState(
    updateEmployee,
    INITIAL_STATE
  )

  const state = isEdit ? updateState : createState
  const pending = isEdit ? updatePending : createPending
  const action = isEdit ? updateAction : createAction

  // Local controlled state for fields that need cross-field logic (is_minor)
  // and chip toggles (department_ids, primary). Initial values come straight
  // from props because this component remounts when editing target changes.
  const [isMinor, setIsMinor] = useState<boolean>(editing?.is_minor ?? false)
  const [deptIds, setDeptIds] = useState<string[]>(
    editing?.department_ids ?? []
  )
  const [primaryDeptId, setPrimaryDeptId] = useState<string | null>(
    editing?.primary_department?.id ?? null
  )

  // Close on success.
  useEffect(() => {
    if (state && "ok" in state && state.ok === true) {
      onOpenChange(false)
    }
  }, [state, onOpenChange])

  function toggleDept(id: string) {
    setDeptIds((prev) => {
      if (prev.includes(id)) {
        // Removing — also clear primary if needed.
        if (primaryDeptId === id) setPrimaryDeptId(null)
        return prev.filter((x) => x !== id)
      }
      return [...prev, id]
    })
  }

  const errorMsg =
    state && "ok" in state && state.ok === false ? state.error : null

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full max-w-lg overflow-y-auto sm:max-w-xl"
      >
        <SheetHeader>
          <SheetTitle>
            {isEdit ? "Edit employee" : "Add employee"}
          </SheetTitle>
          <SheetDescription>
            {isEdit
              ? "Update employee details, role, and department assignments."
              : "Create a new employee record for this facility."}
          </SheetDescription>
        </SheetHeader>

        <form action={action} className="flex flex-col gap-4">
          <input type="hidden" name="facility_id" value={facilityId} />
          {isEdit && editing && (
            <input type="hidden" name="id" value={editing.id} />
          )}
          {/* Hidden inputs reflect chip-state for departments + primary. */}
          {deptIds.map((id) => (
            <input
              key={id}
              type="hidden"
              name="department_ids"
              value={id}
            />
          ))}
          <input
            type="hidden"
            name="primary_department_id"
            value={primaryDeptId ?? ""}
          />

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="first_name">First name *</Label>
              <Input
                id="first_name"
                name="first_name"
                required
                defaultValue={editing?.first_name ?? ""}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="last_name">Last name *</Label>
              <Input
                id="last_name"
                name="last_name"
                required
                defaultValue={editing?.last_name ?? ""}
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="role_id">Role *</Label>
            <select
              id="role_id"
              name="role_id"
              required
              defaultValue={editing?.role?.id ?? ""}
              className="border-input bg-transparent h-9 rounded-md border px-3 text-sm shadow-xs"
            >
              <option value="" disabled>
                Select a role…
              </option>
              {roles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.display_name}
                </option>
              ))}
            </select>
          </div>

          {departments.length > 0 && (
            <>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="primary_dept_select">Primary department</Label>
                <select
                  id="primary_dept_select"
                  value={primaryDeptId ?? ""}
                  onChange={(e) => {
                    const v = e.target.value || null
                    setPrimaryDeptId(v)
                    if (v && !deptIds.includes(v)) {
                      setDeptIds((prev) => [...prev, v])
                    }
                  }}
                  className="border-input bg-transparent h-9 rounded-md border px-3 text-sm shadow-xs"
                >
                  <option value="">None</option>
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex flex-col gap-1.5">
                <Label>Additional departments</Label>
                <div className="flex flex-wrap gap-1.5">
                  {departments.map((d) => {
                    const active = deptIds.includes(d.id)
                    const isPrimary = primaryDeptId === d.id
                    return (
                      <button
                        key={d.id}
                        type="button"
                        onClick={() => toggleDept(d.id)}
                        className={cn(
                          "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
                          active
                            ? "bg-primary text-primary-foreground border-transparent"
                            : "bg-background text-foreground hover:bg-accent"
                        )}
                      >
                        {d.color && (
                          <span
                            aria-hidden
                            className="inline-block size-2 rounded-full"
                            style={{ backgroundColor: d.color }}
                          />
                        )}
                        {d.name}
                        {isPrimary && (
                          <span className="ml-1 opacity-80">(primary)</span>
                        )}
                      </button>
                    )
                  })}
                </div>
              </div>
            </>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="employee_code">Employee code</Label>
              <Input
                id="employee_code"
                name="employee_code"
                defaultValue={editing?.employee_code ?? ""}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="hire_date">Hire date</Label>
              <Input
                id="hire_date"
                name="hire_date"
                type="date"
                defaultValue={editing?.hire_date ?? ""}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                name="email"
                type="email"
                defaultValue={editing?.email ?? ""}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="phone">Phone</Label>
              <Input
                id="phone"
                name="phone"
                type="tel"
                defaultValue={editing?.phone ?? ""}
              />
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm font-medium">
            <input
              type="checkbox"
              name="is_minor"
              checked={isMinor}
              onChange={(e) => setIsMinor(e.target.checked)}
              className="border-input size-4 rounded border"
            />
            Employee is a minor
          </label>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="emergency_contact_name">
                Emergency contact name {!isMinor && "*"}
              </Label>
              <Input
                id="emergency_contact_name"
                name="emergency_contact_name"
                required={!isMinor}
                defaultValue={editing?.emergency_contact_name ?? ""}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="emergency_contact_phone">
                Emergency contact phone {!isMinor && "*"}
              </Label>
              <Input
                id="emergency_contact_phone"
                name="emergency_contact_phone"
                type="tel"
                required={!isMinor}
                defaultValue={editing?.emergency_contact_phone ?? ""}
              />
            </div>
          </div>
          {isMinor && (
            <p className="text-muted-foreground -mt-2 text-xs">
              Emergency contact is optional for minors.
            </p>
          )}

          {errorMsg && (
            <p role="alert" className="text-destructive text-sm">
              {errorMsg}
            </p>
          )}

          <div className="mt-2 flex items-center justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending
                ? isEdit
                  ? "Saving…"
                  : "Creating…"
                : isEdit
                  ? "Save changes"
                  : "Create employee"}
            </Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  )
}
