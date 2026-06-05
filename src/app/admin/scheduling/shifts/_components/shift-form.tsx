"use client"

import { useActionState, useEffect, useState, useTransition } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
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
import { Textarea } from "@/components/ui/textarea"

import {
  createShift,
  deleteShift,
  updateShift,
} from "../../_lib/admin-core-actions"
import type {
  ActionState,
  DepartmentLite,
  EmployeeLite,
  JobAreaLite,
  ShiftWithRefs,
} from "../../_lib/types"

const INITIAL_STATE: ActionState = { ok: null }

// Sentinel for "no job area" — Radix Select disallows an empty-string value.
const NO_JOB_AREA = "__none__"

type Props = {
  departments: DepartmentLite[]
  employees: EmployeeLite[]
  jobAreas: JobAreaLite[]
  editing: ShiftWithRefs | null
  defaultStartsAt?: string | null
  onClose: () => void
  onSaved: () => void
}

function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return ""
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ""
  // Format as YYYY-MM-DDTHH:MM in local time
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function ShiftForm(props: Props) {
  const isEdit = props.editing !== null
  const editing = props.editing

  const [createState, createAction, createPending] = useActionState(
    createShift,
    INITIAL_STATE
  )
  const [updateState, updateAction, updatePending] = useActionState(
    updateShift,
    INITIAL_STATE
  )
  const [deletePending, startDelete] = useTransition()
  const [departmentId, setDepartmentId] = useState(editing?.department_id ?? "")
  const [jobAreaId, setJobAreaId] = useState(editing?.job_area_id ?? NO_JOB_AREA)
  const [employeeId, setEmployeeId] = useState(editing?.employee_id ?? "__open__")
  const [status, setStatus] = useState(editing?.status ?? "draft")

  const state = isEdit ? updateState : createState
  const pending = isEdit ? updatePending : createPending
  const action = isEdit ? updateAction : createAction

  useEffect(() => {
    if (!state || !("ok" in state)) return
    if (state.ok === true) {
      toast.success(state.message ?? (isEdit ? "Shift updated." : "Shift created."))
      props.onSaved()
    } else if (state.ok === false) {
      toast.error(state.error)
    }
  }, [state, isEdit, props])

  const errorMsg =
    state && "ok" in state && state.ok === false ? state.error : null

  return (
    <form
      action={action}
      className="bg-card flex flex-col gap-3 rounded-md border p-4 shadow-sm"
    >
      {isEdit && editing && (
        <input type="hidden" name="id" value={editing.id} />
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="department_id">Department<RequiredMark /></Label>
          <input type="hidden" name="department_id" value={departmentId} />
          <Select
            value={departmentId || undefined}
            onValueChange={(v) => setDepartmentId(v)}
          >
            <SelectTrigger id="department_id">
              <SelectValue placeholder="Select department…" />
            </SelectTrigger>
            <SelectContent>
              {props.departments.map((d) => (
                <SelectItem key={d.id} value={d.id}>
                  {d.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="employee_id">Employee</Label>
          <input type="hidden" name="employee_id" value={employeeId} />
          <Select value={employeeId} onValueChange={(v) => setEmployeeId(v)}>
            <SelectTrigger id="employee_id">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__open__">Leave open (unassigned)</SelectItem>
              {props.employees.map((e) => (
                <SelectItem key={e.id} value={e.id}>
                  {e.last_name}, {e.first_name}
                  {e.is_minor ? " (minor)" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="starts_at">Starts<RequiredMark /></Label>
          <Input
            id="starts_at"
            name="starts_at"
            type="datetime-local"
            required
            defaultValue={toLocalInput(editing?.starts_at ?? props.defaultStartsAt)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ends_at">Ends<RequiredMark /></Label>
          <Input
            id="ends_at"
            name="ends_at"
            type="datetime-local"
            required
            defaultValue={toLocalInput(editing?.ends_at)}
          />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="break_minutes">Break minutes</Label>
          <Input
            id="break_minutes"
            name="break_minutes"
            type="number"
            min={0}
            defaultValue={editing?.break_minutes ?? 0}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="job_area_id">Job area (role)</Label>
          <input
            type="hidden"
            name="job_area_id"
            value={jobAreaId === NO_JOB_AREA ? "" : jobAreaId}
          />
          <Select value={jobAreaId} onValueChange={(v) => setJobAreaId(v)}>
            <SelectTrigger id="job_area_id">
              <SelectValue placeholder="Select job area…" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_JOB_AREA}>None</SelectItem>
              {props.jobAreas.map((j) => (
                <SelectItem key={j.id} value={j.id}>
                  {j.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="status">Status</Label>
          <input type="hidden" name="status" value={status} />
          <Select value={status} onValueChange={(v) => setStatus(v)}>
            <SelectTrigger id="status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="draft">Draft</SelectItem>
              <SelectItem value="published">Published</SelectItem>
              <SelectItem value="cancelled">Cancelled</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="role_label">Role note (optional)</Label>
        <Input
          id="role_label"
          name="role_label"
          defaultValue={editing?.role_label ?? ""}
          placeholder="e.g. Lead operator"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="notes">Notes</Label>
        <Textarea
          id="notes"
          name="notes"
          rows={2}
          defaultValue={editing?.notes ?? ""}
        />
      </div>

      {errorMsg && (
        <p role="alert" className="text-destructive text-sm">
          {errorMsg}
        </p>
      )}

      <div className="mt-1 flex items-center justify-between gap-2">
        <div>
          {isEdit && editing && (
            <Button
              type="button"
              variant="destructive"
              disabled={deletePending || pending}
              onClick={() => {
                if (!confirm("Delete this shift?")) return
                startDelete(async () => {
                  const res = await deleteShift(editing.id)
                  if (res.ok === true) {
                    toast.success(res.message ?? "Shift deleted.")
                    props.onSaved()
                  } else if (res.ok === false) {
                    toast.error(res.error)
                  }
                })
              }}
            >
              {deletePending ? "Deleting…" : "Delete"}
            </Button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={props.onClose}
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
                : "Create shift"}
          </Button>
        </div>
      </div>
    </form>
  )
}
