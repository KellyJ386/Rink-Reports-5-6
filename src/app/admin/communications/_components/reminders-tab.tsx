"use client"

import { useActionState, useEffect, useState, useTransition } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

import {
  createReminder,
  deleteReminder,
  setReminderActive,
  updateReminder,
} from "../actions"
import type {
  ActionState,
  GroupRow,
  ReminderWithRefs,
  TemplateRow,
} from "../types"
import { ROLE_KEYS } from "../types"

const NULL_STATE: ActionState = { ok: null }

type Props = {
  reminders: ReminderWithRefs[]
  templates: TemplateRow[]
  groups: GroupRow[]
}

function fmt(ts: string | null | undefined): string {
  if (!ts) return "—"
  try {
    return new Date(ts).toLocaleString()
  } catch {
    return ts
  }
}

function toLocalDatetimeInput(ts: string | null): string {
  if (!ts) return ""
  try {
    const d = new Date(ts)
    if (Number.isNaN(d.getTime())) return ""
    const off = d.getTimezoneOffset() * 60_000
    return new Date(d.getTime() - off).toISOString().slice(0, 16)
  } catch {
    return ""
  }
}

export function RemindersTab({ reminders, templates, groups }: Props) {
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Scheduling is not yet implemented
          </CardTitle>
          <CardDescription>
            These reminders are stored configurations only. The scheduler that
            sends them will be added in a later step.
          </CardDescription>
        </CardHeader>
      </Card>
      {reminders.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>No reminders yet</CardTitle>
            <CardDescription>
              Add a recurring reminder configuration below to be ready when
              scheduling lands.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <ul className="flex flex-col gap-2">
          {reminders.map((r) => (
            <ReminderRowItem
              key={r.id}
              reminder={r}
              templates={templates}
              groups={groups}
            />
          ))}
        </ul>
      )}
      <ReminderCreateCard templates={templates} groups={groups} />
    </div>
  )
}

function targetSummary(r: ReminderWithRefs): string {
  if (r.target_group) return `Group: ${r.target_group.name}`
  if (r.target_role_key) return `Role: ${r.target_role_key}`
  return "—"
}

function ReminderRowItem({
  reminder,
  templates,
  groups,
}: {
  reminder: ReminderWithRefs
  templates: TemplateRow[]
  groups: GroupRow[]
}) {
  const [editing, setEditing] = useState(false)
  const [activePending, startActive] = useTransition()
  const [delPending, startDel] = useTransition()
  function onToggle() {
    startActive(async () => {
      const r = await setReminderActive(reminder.id, !reminder.is_active)
      if (!r.ok) toast.error(r.error)
    })
  }
  function onDelete() {
    if (!confirm(`Delete reminder "${reminder.name}"?`)) return
    startDel(async () => {
      const r = await deleteReminder(reminder.id)
      if (!r.ok) toast.error(r.error)
      else toast.success("Reminder deleted.")
    })
  }
  return (
    <li className="bg-muted/30 flex flex-col gap-2 rounded-md border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold">{reminder.name}</span>
          <code className="text-muted-foreground rounded bg-background px-1.5 py-0.5 text-[11px]">
            {reminder.schedule_cron}
          </code>
          {!reminder.is_active && (
            <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase">
              off
            </span>
          )}
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setEditing((v) => !v)}
          >
            {editing ? "Cancel" : "Edit"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={onToggle}
            disabled={activePending}
          >
            {reminder.is_active ? "Deactivate" : "Activate"}
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={onDelete}
            disabled={delPending}
          >
            Delete
          </Button>
        </div>
      </div>
      {!editing && (
        <div className="text-muted-foreground grid grid-cols-1 gap-1 text-xs sm:grid-cols-2">
          <div>
            <span className="font-medium uppercase">Template:</span>{" "}
            {reminder.template?.name ?? "(missing)"}
          </div>
          <div>
            <span className="font-medium uppercase">Target:</span>{" "}
            {targetSummary(reminder)}
          </div>
          <div>
            <span className="font-medium uppercase">Last run:</span>{" "}
            {fmt(reminder.last_run_at)}
          </div>
          <div>
            <span className="font-medium uppercase">Next run:</span>{" "}
            {fmt(reminder.next_run_at)}
          </div>
        </div>
      )}
      {editing && (
        <ReminderForm
          mode="edit"
          reminder={reminder}
          templates={templates}
          groups={groups}
          onDone={() => setEditing(false)}
        />
      )}
    </li>
  )
}

function ReminderCreateCard({
  templates,
  groups,
}: {
  templates: TemplateRow[]
  groups: GroupRow[]
}) {
  if (templates.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>No templates available</CardTitle>
          <CardDescription>
            Reminders need a template to send. Add an active template in the
            Templates tab first.
          </CardDescription>
        </CardHeader>
      </Card>
    )
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>Add reminder</CardTitle>
      </CardHeader>
      <CardContent>
        <ReminderForm
          mode="create"
          reminder={null}
          templates={templates}
          groups={groups}
        />
      </CardContent>
    </Card>
  )
}

function ReminderForm({
  mode,
  reminder,
  templates,
  groups,
  onDone,
}: {
  mode: "create" | "edit"
  reminder: ReminderWithRefs | null
  templates: TemplateRow[]
  groups: GroupRow[]
  onDone?: () => void
}) {
  const [state, action, pending] = useActionState(
    mode === "create" ? createReminder : updateReminder,
    NULL_STATE,
  )
  const [targetKind, setTargetKind] = useState<"group" | "role">(
    reminder?.target_role_key ? "role" : "group",
  )
  useEffect(() => {
    if (state.ok === true) {
      toast.success(state.message ?? "Saved.")
      onDone?.()
    }
    if (state.ok === false) toast.error(state.error)
  }, [state, onDone])

  const idSuffix = reminder?.id ?? "new"
  const activeTemplates = templates.filter(
    (t) => t.is_active || t.id === reminder?.template_id,
  )

  return (
    <form action={action} className="flex flex-col gap-3">
      {reminder && <input type="hidden" name="id" value={reminder.id} />}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor={`rm-name-${idSuffix}`}>Name</Label>
          <Input
            id={`rm-name-${idSuffix}`}
            name="name"
            defaultValue={reminder?.name ?? ""}
            required
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor={`rm-cron-${idSuffix}`}>
            Schedule (cron, 5 fields)
          </Label>
          <Input
            id={`rm-cron-${idSuffix}`}
            name="schedule_cron"
            defaultValue={reminder?.schedule_cron ?? ""}
            placeholder="0 8 * * 1"
            required
            className="font-mono"
          />
          <p className="text-muted-foreground text-xs">
            Example: <code>0 8 * * 1</code> = every Monday at 08:00.
          </p>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor={`rm-tpl-${idSuffix}`}>Template</Label>
          <select
            id={`rm-tpl-${idSuffix}`}
            name="template_id"
            defaultValue={reminder?.template_id ?? ""}
            required
            className="border-input bg-transparent h-9 rounded-md border px-3 text-sm shadow-xs"
          >
            <option value="" disabled>
              Pick template…
            </option>
            {activeTemplates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
                {!t.is_active ? " (inactive)" : ""}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor={`rm-next-${idSuffix}`}>Next run (optional)</Label>
          <Input
            id={`rm-next-${idSuffix}`}
            name="next_run_at"
            type="datetime-local"
            defaultValue={toLocalDatetimeInput(reminder?.next_run_at ?? null)}
          />
        </div>
      </div>

      <fieldset className="flex flex-col gap-2 rounded-md border p-3">
        <legend className="text-muted-foreground px-1 text-xs font-medium uppercase">
          Target
        </legend>
        <div className="flex flex-wrap gap-3 text-sm">
          {(["group", "role"] as const).map((k) => (
            <label key={k} className="flex items-center gap-2">
              <input
                type="radio"
                name="target_kind"
                value={k}
                checked={targetKind === k}
                onChange={() => setTargetKind(k)}
              />
              {k}
            </label>
          ))}
        </div>
        {targetKind === "group" && (
          <div className="flex flex-col gap-1">
            <Label htmlFor={`rm-tgt-g-${idSuffix}`}>Group</Label>
            <select
              id={`rm-tgt-g-${idSuffix}`}
              name="target_group_id"
              defaultValue={reminder?.target_group_id ?? ""}
              className="border-input bg-transparent h-9 rounded-md border px-3 text-sm shadow-xs"
            >
              <option value="" disabled>
                Pick group…
              </option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </div>
        )}
        {targetKind === "role" && (
          <div className="flex flex-col gap-1">
            <Label htmlFor={`rm-tgt-r-${idSuffix}`}>Role</Label>
            <select
              id={`rm-tgt-r-${idSuffix}`}
              name="target_role_key"
              defaultValue={reminder?.target_role_key ?? ""}
              className="border-input bg-transparent h-9 rounded-md border px-3 text-sm shadow-xs"
            >
              <option value="" disabled>
                Pick role…
              </option>
              {ROLE_KEYS.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          </div>
        )}
      </fieldset>

      {reminder && (
        <p className="text-muted-foreground text-xs">
          Last run: {fmt(reminder.last_run_at)}
        </p>
      )}

      <div className="flex justify-end">
        <Button type="submit" size="sm" disabled={pending}>
          {pending
            ? "Saving…"
            : mode === "create"
              ? "Add reminder"
              : "Save reminder"}
        </Button>
      </div>
    </form>
  )
}
