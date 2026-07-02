"use client"

import { useState, useTransition } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { Tables } from "@/types/database"

import { updateSchedulingSettings } from "../../_lib/governance-actions"

type Settings = Tables<"schedule_settings">

const DAY_OPTIONS = [
  { v: 0, label: "Sunday" },
  { v: 1, label: "Monday" },
  { v: 2, label: "Tuesday" },
  { v: 3, label: "Wednesday" },
  { v: 4, label: "Thursday" },
  { v: 5, label: "Friday" },
  { v: 6, label: "Saturday" },
] as const

function nullableNumber(s: string): number | null {
  if (s.trim() === "") return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

export function SettingsForm({ settings }: { settings: Settings }) {
  const [weekStartDay, setWeekStartDay] = useState<number>(
    settings.week_start_day
  )
  const [defaultShiftMinutes, setDefaultShiftMinutes] = useState<string>(
    String(settings.default_shift_minutes ?? 480)
  )
  const [minorMaxWeeklyHours, setMinorMaxWeeklyHours] = useState<string>(
    settings.minor_max_weekly_hours == null
      ? ""
      : String(settings.minor_max_weekly_hours)
  )
  const [overtimeWeeklyHours, setOvertimeWeeklyHours] = useState<string>(
    settings.overtime_weekly_hours == null
      ? ""
      : String(settings.overtime_weekly_hours)
  )
  const [minimumBreakMinutes, setMinimumBreakMinutes] = useState<string>(
    settings.minimum_break_minutes == null
      ? ""
      : String(settings.minimum_break_minutes)
  )
  const [minimumBreakAfterHours, setMinimumBreakAfterHours] = useState<string>(
    settings.minimum_break_after_hours == null
      ? ""
      : String(settings.minimum_break_after_hours)
  )
  const [swapExpiryHours, setSwapExpiryHours] = useState<string>(
    String(settings.swap_expiry_hours ?? 72)
  )
  const [swapRequiresManagerApproval, setSwapRequiresManagerApproval] =
    useState<boolean>(settings.swap_requires_manager_approval)
  const [openShiftFirstCome, setOpenShiftFirstCome] = useState<boolean>(
    settings.open_shift_first_come
  )
  const [notifyOnPublish, setNotifyOnPublish] = useState<boolean>(
    settings.notify_on_publish
  )
  const [notifyOnOvertime, setNotifyOnOvertime] = useState<boolean>(
    settings.notify_on_overtime
  )
  const [defaultHourlyRate, setDefaultHourlyRate] = useState<string>(
    settings.default_hourly_rate == null
      ? ""
      : String(settings.default_hourly_rate)
  )
  const [availabilitySubmissionEnabled, setAvailabilitySubmissionEnabled] =
    useState<boolean>(settings.availability_submission_enabled)
  const [requireJobAreaQualification, setRequireJobAreaQualification] =
    useState<boolean>(settings.require_job_area_qualification)
  const [blockOnViolations, setBlockOnViolations] = useState<boolean>(
    settings.block_on_violations
  )
  const [pending, startTransition] = useTransition()

  function submit() {
    const dsm = Number(defaultShiftMinutes)
    if (!Number.isFinite(dsm) || dsm <= 0) {
      toast.error("Default shift minutes must be a positive number.")
      return
    }
    const seh = Number(swapExpiryHours)
    if (!Number.isInteger(seh) || seh <= 0) {
      toast.error("Swap expiry hours must be a positive whole number.")
      return
    }
    startTransition(async () => {
      const r = await updateSchedulingSettings({
        week_start_day: weekStartDay,
        default_shift_minutes: Math.round(dsm),
        minor_max_weekly_hours: nullableNumber(minorMaxWeeklyHours),
        overtime_weekly_hours: nullableNumber(overtimeWeeklyHours),
        minimum_break_minutes: nullableNumber(minimumBreakMinutes),
        minimum_break_after_hours: nullableNumber(minimumBreakAfterHours),
        swap_requires_manager_approval: swapRequiresManagerApproval,
        swap_expiry_hours: seh,
        open_shift_first_come: openShiftFirstCome,
        notify_on_publish: notifyOnPublish,
        notify_on_overtime: notifyOnOvertime,
        availability_submission_enabled: availabilitySubmissionEnabled,
        require_job_area_qualification: requireJobAreaQualification,
        block_on_violations: blockOnViolations,
        default_hourly_rate: nullableNumber(defaultHourlyRate),
      })
      if (r.ok === true) toast.success(r.message ?? "Saved.")
      else if (r.ok === false) toast.error(r.error)
    })
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
      className="bg-card flex flex-col gap-4 rounded-md border p-4 shadow-sm"
    >
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Week start day">
          <Select
            value={String(weekStartDay)}
            onValueChange={(v) => setWeekStartDay(Number(v))}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DAY_OPTIONS.map((o) => (
                <SelectItem key={o.v} value={String(o.v)}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Default shift minutes">
          <Input
            type="number"
            value={defaultShiftMinutes}
            onChange={(e) => setDefaultShiftMinutes(e.target.value)}
          />
        </Field>
        <Field label="Minor max weekly hours">
          <Input
            type="number"
            value={minorMaxWeeklyHours}
            onChange={(e) => setMinorMaxWeeklyHours(e.target.value)}
            placeholder="(none)"
          />
        </Field>
        <Field label="Overtime weekly hours">
          <Input
            type="number"
            value={overtimeWeeklyHours}
            onChange={(e) => setOvertimeWeeklyHours(e.target.value)}
            placeholder="(none)"
          />
        </Field>
        <Field label="Minimum break minutes">
          <Input
            type="number"
            value={minimumBreakMinutes}
            onChange={(e) => setMinimumBreakMinutes(e.target.value)}
            placeholder="(none)"
          />
        </Field>
        <Field label="Minimum break after hours">
          <Input
            type="number"
            value={minimumBreakAfterHours}
            onChange={(e) => setMinimumBreakAfterHours(e.target.value)}
            placeholder="(none)"
          />
        </Field>
        <Field label="Swap request expiry (hours)">
          <Input
            type="number"
            min={1}
            value={swapExpiryHours}
            onChange={(e) => setSwapExpiryHours(e.target.value)}
            placeholder="72"
          />
          <p className="text-muted-foreground text-xs">
            Undecided swap requests lapse to “expired” after this window
            (capped at the shift’s start). Default 72.
          </p>
        </Field>
        <Field label="Default hourly rate ($)">
          <Input
            type="number"
            min={0}
            step={0.01}
            value={defaultHourlyRate}
            onChange={(e) => setDefaultHourlyRate(e.target.value)}
            placeholder="(none)"
          />
          <p className="text-muted-foreground text-xs">
            Fallback for labor-cost estimates when an employee has no
            individual wage (set wages on the Employees page). Admin-only.
          </p>
        </Field>
      </div>

      <div className="flex flex-col gap-2 border-t pt-3">
        <ToggleField
          label="Swaps require manager approval"
          value={swapRequiresManagerApproval}
          onChange={setSwapRequiresManagerApproval}
        />
        <ToggleField
          label="Open shifts: first-come, first-served"
          value={openShiftFirstCome}
          onChange={setOpenShiftFirstCome}
        />
        <ToggleField
          label="Notify employees when schedule is published"
          value={notifyOnPublish}
          onChange={setNotifyOnPublish}
        />
        <ToggleField
          label="Notify on overtime warnings"
          value={notifyOnOvertime}
          onChange={setNotifyOnOvertime}
        />
        <ToggleField
          label="Allow staff to submit weekly availability"
          value={availabilitySubmissionEnabled}
          onChange={setAvailabilitySubmissionEnabled}
        />
        <ToggleField
          label="Require employees to be assigned to a shift's job area"
          value={requireJobAreaQualification}
          onChange={setRequireJobAreaQualification}
        />
        <ToggleField
          label="Block scheduling-grid saves that raise warnings (hours cap, overlap, cert gaps). Off = advisory only."
          value={blockOnViolations}
          onChange={setBlockOnViolations}
        />
      </div>

      <div className="flex justify-end">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save settings"}
        </Button>
      </div>
    </form>
  )
}

function Field({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium">{label}</label>
      {children}
    </div>
  )
}

function ToggleField({
  label,
  value,
  onChange,
}: {
  label: string
  value: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input
        type="checkbox"
        checked={value}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4"
      />
      {label}
    </label>
  )
}
