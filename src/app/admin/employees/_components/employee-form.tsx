"use client"

import { useActionState, useEffect, useState } from "react"
import { Plus } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { FieldError } from "@/components/ui/field-error"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { RequiredMark } from "@/components/ui/required-mark"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { cn } from "@/lib/utils"

import { createJobArea } from "../../scheduling/job-areas/actions"
import { createEmployee, updateEmployee } from "../actions"
import type {
  ActionState,
  EmployeeListItem,
  JobAreaOption,
  RoleDefaultsMap,
  RoleRow,
} from "../types"
import { RolePermissionPreview } from "./role-permission-preview"

const MAX_JOB_AREAS = 4

/** Merge two area lists by id (base first), keeping any assigned-but-inactive
 *  areas visible so editing never silently drops them. */
function mergeAreas(base: JobAreaOption[], extra: JobAreaOption[]): JobAreaOption[] {
  const map = new Map(base.map((a) => [a.id, a]))
  for (const a of extra) if (!map.has(a.id)) map.set(a.id, a)
  return Array.from(map.values())
}

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  facilityId: string
  roles: RoleRow[]
  jobAreas: JobAreaOption[]
  roleDefaults: RoleDefaultsMap
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
  jobAreas,
  roleDefaults,
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
  // and chip toggles. Initial values come straight from props because this
  // component remounts when editing target changes.
  const [isMinor, setIsMinor] = useState<boolean>(editing?.is_minor ?? false)
  const [roleId, setRoleId] = useState(editing?.role?.id ?? "")
  const [roleError, setRoleError] = useState<string | null>(null)

  // Job-area assignment (max 4). Options include any assigned-but-inactive
  // areas so an edit doesn't silently drop them.
  const [areas, setAreas] = useState<JobAreaOption[]>(() =>
    mergeAreas(jobAreas, editing?.job_areas ?? [])
  )
  const [areaIds, setAreaIds] = useState<string[]>(editing?.job_area_ids ?? [])
  const [primaryAreaId, setPrimaryAreaId] = useState<string | null>(
    editing?.primary_job_area?.id ?? null
  )
  const [newAreaName, setNewAreaName] = useState("")
  const [creatingArea, setCreatingArea] = useState(false)
  const atAreaCap = areaIds.length >= MAX_JOB_AREAS
  // Create flow only: provision a login + seed role permissions. Default on so
  // the common "new staff member who logs in" path is one click.
  const [needsLogin, setNeedsLogin] = useState<boolean>(!isEdit)

  const previewMatrix = roleId ? (roleDefaults[roleId] ?? null) : null

  // Close on success.
  useEffect(() => {
    if (state && "ok" in state && state.ok === true) {
      onOpenChange(false)
    }
  }, [state, onOpenChange])

  function toggleArea(id: string) {
    setAreaIds((prev) => {
      if (prev.includes(id)) {
        if (primaryAreaId === id) setPrimaryAreaId(null)
        return prev.filter((x) => x !== id)
      }
      if (prev.length >= MAX_JOB_AREAS) return prev // cap
      return [...prev, id]
    })
  }

  async function handleCreateArea() {
    const name = newAreaName.trim()
    if (!name || creatingArea) return
    setCreatingArea(true)
    const res = await createJobArea({ facilityId, name })
    setCreatingArea(false)
    if (!res.ok) {
      toast.error(res.error)
      return
    }
    setAreas((prev) =>
      prev.some((a) => a.id === res.area.id) ? prev : [...prev, res.area]
    )
    setNewAreaName("")
    setAreaIds((prev) =>
      prev.includes(res.area.id) || prev.length >= MAX_JOB_AREAS
        ? prev
        : [...prev, res.area.id]
    )
    toast.success(`Created “${res.area.name}”.`)
  }

  const errorMsg =
    state && "ok" in state && state.ok === false ? state.error : null

  return (
    <>
      <SheetHeader>
          <SheetTitle>
            {isEdit ? "Edit employee" : "Add employee"}
          </SheetTitle>
          <SheetDescription>
            {isEdit
              ? "Update employee details, role, and job-area assignments."
              : "Create a new employee record for this facility."}
          </SheetDescription>
        </SheetHeader>

        <form
          action={action}
          onSubmit={(e) => {
            if (!roleId) {
              e.preventDefault()
              setRoleError("Role is required.")
            } else {
              setRoleError(null)
            }
          }}
          className="flex flex-col gap-4"
        >
          <input type="hidden" name="facility_id" value={facilityId} />
          {isEdit && editing && (
            <input type="hidden" name="id" value={editing.id} />
          )}
          {/* Job-area hidden inputs. The marker tells updateEmployee this form
              submitted job areas (so the reconcile runs and an empty set really
              means "clear"), distinct from a form that omits the control. */}
          <input type="hidden" name="job_areas_present" value="1" />
          {areaIds.map((id) => (
            <input key={id} type="hidden" name="job_area_ids" value={id} />
          ))}
          <input
            type="hidden"
            name="primary_job_area_id"
            value={primaryAreaId ?? ""}
          />

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="first_name">First name<RequiredMark /></Label>
              <Input
                id="first_name"
                name="first_name"
                required
                defaultValue={editing?.first_name ?? ""}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="last_name">Last name<RequiredMark /></Label>
              <Input
                id="last_name"
                name="last_name"
                required
                defaultValue={editing?.last_name ?? ""}
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="role_id">Role<RequiredMark /></Label>
            <input type="hidden" name="role_id" value={roleId} />
            <Select
              value={roleId || undefined}
              onValueChange={(v) => {
                setRoleId(v)
                if (v) setRoleError(null)
              }}
            >
              <SelectTrigger
                id="role_id"
                aria-invalid={roleError ? "true" : undefined}
                aria-describedby={roleError ? "role_id-error" : undefined}
              >
                <SelectValue placeholder="Select a role…" />
              </SelectTrigger>
              <SelectContent>
                {roles.map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    {r.display_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldError id="role_id-error" message={roleError ?? undefined} />
          </div>

          {/* Permissions are a function of role. Preview what the chosen role
              grants; per-user fine-tuning happens on the permissions page. */}
          <div className="flex flex-col gap-2 rounded-md border p-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Role permissions</span>
              <span className="text-muted-foreground text-xs">
                Defaults for this role
              </span>
            </div>
            <RolePermissionPreview matrix={previewMatrix} />
            {!isEdit && (
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  name="needs_login"
                  checked={needsLogin}
                  onChange={(e) => setNeedsLogin(e.target.checked)}
                  className="border-input mt-0.5 size-4 rounded border"
                />
                <span>
                  Create a login &amp; apply these permissions
                  <span className="text-muted-foreground block text-xs font-normal">
                    Requires an email. Sends an invite and seeds the role&apos;s
                    permissions. Uncheck for schedule-only staff (e.g. minors).
                  </span>
                </span>
              </label>
            )}
            {isEdit && (
              <p className="text-muted-foreground text-xs">
                Changing the role re-applies these defaults to the employee&apos;s
                login (manual overrides are kept).
              </p>
            )}
          </div>

          {/* Job areas (Employee Scheduling) — up to 4, cross-trained. */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <Label>Job areas</Label>
              <span className="text-muted-foreground text-xs">
                {areaIds.length}/{MAX_JOB_AREAS} selected
              </span>
            </div>

            {areas.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {areas.map((a) => {
                  const active = areaIds.includes(a.id)
                  const isPrimary = primaryAreaId === a.id
                  const disabled = !active && atAreaCap
                  return (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => toggleArea(a.id)}
                      disabled={disabled}
                      className={cn(
                        "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
                        active
                          ? "bg-primary text-primary-foreground border-transparent"
                          : "bg-background text-foreground hover:bg-accent",
                        disabled && "cursor-not-allowed opacity-40"
                      )}
                    >
                      {a.name}
                      {isPrimary && <span className="ml-1 opacity-80">(primary)</span>}
                    </button>
                  )
                })}
              </div>
            ) : (
              <p className="text-muted-foreground text-xs">
                No job areas yet — create one below.
              </p>
            )}

            {areaIds.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="primary_job_area_select" className="text-xs">
                  Primary job area
                </Label>
                <Select
                  value={primaryAreaId || undefined}
                  onValueChange={(v) => setPrimaryAreaId(v || null)}
                >
                  <SelectTrigger id="primary_job_area_select" className="h-9">
                    <SelectValue placeholder="None" />
                  </SelectTrigger>
                  <SelectContent>
                    {areaIds.map((id) => {
                      const a = areas.find((x) => x.id === id)
                      if (!a) return null
                      return (
                        <SelectItem key={id} value={id}>
                          {a.name}
                        </SelectItem>
                      )
                    })}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Inline create — same action as the management page + bulk add. */}
            <div className="flex items-end gap-2">
              <div className="flex flex-1 flex-col gap-1">
                <Label htmlFor="new_job_area" className="text-xs">
                  Add a new area
                </Label>
                <Input
                  id="new_job_area"
                  value={newAreaName}
                  maxLength={60}
                  placeholder="e.g. Skate Rental"
                  disabled={creatingArea}
                  className="h-9"
                  onChange={(e) => setNewAreaName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault()
                      void handleCreateArea()
                    }
                  }}
                />
              </div>
              <Button
                type="button"
                variant="outline"
                className="h-9"
                disabled={creatingArea || !newAreaName.trim()}
                onClick={() => void handleCreateArea()}
              >
                <Plus className="size-4" /> Add
              </Button>
            </div>
          </div>

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

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="max_weekly_hours">Max weekly hours</Label>
            <Input
              id="max_weekly_hours"
              name="max_weekly_hours"
              type="number"
              min={1}
              max={168}
              step={1}
              inputMode="numeric"
              placeholder="No individual cap"
              defaultValue={editing?.max_weekly_hours ?? ""}
            />
            <p className="text-muted-foreground text-xs">
              Per-employee scheduling cap (1–168). Leave blank to use the
              facility default. The shift grid warns when a week exceeds it.
            </p>
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
                Emergency contact name{!isMinor && <RequiredMark />}
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
                Emergency contact phone{!isMinor && <RequiredMark />}
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
    </>
  )
}
