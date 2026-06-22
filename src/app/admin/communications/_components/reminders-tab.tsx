"use client"

import { useActionState, useEffect, useState, useTransition } from "react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

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
          <CardTitle className="text-base">Active reminders</CardTitle>
          <CardDescription>
            The scheduler runs every few minutes and sends each active
            reminder&apos;s template to its target on its cron schedule
            (evaluated in this facility&apos;s timezone). Cron uses 5 fields:
            minute hour day-of-month month day-of-week — e.g.{" "}
            <code>0 9 * * 1</code> is 9:00 AM every Monday.
          </CardDescription>
        </CardHeader>
      </Card>
      {reminders.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>No reminders yet</CardTitle>
            <CardDescription>
              Add a recurring reminder below — it starts sending on its next
              scheduled time once active.
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
            <Badge variant="secondary" className="uppercase">
              off
            </Badge>
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
  const [templateId, setTemplateId] = useState(reminder?.template_id ?? "")
  const [targetGroupId, setTargetGroupId] = useState(reminder?.target_group_id ?? "")
  const [targetRoleKey, setTargetRoleKey] = useState(reminder?.target_role_key ?? "")
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
          <input type="hidden" name="template_id" value={templateId} />
          <Select
            value={templateId || undefined}
            onValueChange={(v) => setTemplateId(v)}
          >
            <SelectTrigger id={`rm-tpl-${idSuffix}`}>
              <SelectValue placeholder="Pick template…" />
            </SelectTrigger>
            <SelectContent>
              {activeTemplates.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.name}
                  {!t.is_active ? " (inactive)" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
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
            <input type="hidden" name="target_group_id" value={targetGroupId} />
            <Select
              value={targetGroupId || undefined}
              onValueChange={(v) => setTargetGroupId(v)}
            >
              <SelectTrigger id={`rm-tgt-g-${idSuffix}`}>
                <SelectValue placeholder="Pick group…" />
              </SelectTrigger>
              <SelectContent>
                {groups.map((g) => (
                  <SelectItem key={g.id} value={g.id}>
                    {g.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        {targetKind === "role" && (
          <div className="flex flex-col gap-1">
            <Label htmlFor={`rm-tgt-r-${idSuffix}`}>Role</Label>
            <input type="hidden" name="target_role_key" value={targetRoleKey} />
            <Select
              value={targetRoleKey || undefined}
              onValueChange={(v) => setTargetRoleKey(v)}
            >
              <SelectTrigger id={`rm-tgt-r-${idSuffix}`}>
                <SelectValue placeholder="Pick role…" />
              </SelectTrigger>
              <SelectContent>
                {ROLE_KEYS.map((k) => (
                  <SelectItem key={k} value={k}>
                    {k}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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
