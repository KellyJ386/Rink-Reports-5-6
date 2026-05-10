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
  createRoutingRule,
  deleteRoutingRule,
  setRoutingRuleActive,
  updateRoutingRule,
} from "../actions"
import type {
  ActionState,
  EmployeeLite,
  GroupRow,
  RoutingRuleWithRefs,
} from "../types"
import { ROLE_KEYS, SEVERITIES, SOURCE_MODULES } from "../types"

const NULL_STATE: ActionState = { ok: null }

type Props = {
  rules: RoutingRuleWithRefs[]
  groups: GroupRow[]
  employees: EmployeeLite[]
}

export function RoutingTab({ rules, groups, employees }: Props) {
  return (
    <div className="flex flex-col gap-4">
      {rules.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>No routing rules configured</CardTitle>
            <CardDescription>
              Alerts won&apos;t auto-route to specific employees yet — admins
              still see them in the inbox. Add a rule below to start routing.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <ul className="flex flex-col gap-2">
          {rules.map((r) => (
            <RuleRowItem
              key={r.id}
              rule={r}
              groups={groups}
              employees={employees}
            />
          ))}
        </ul>
      )}
      <RuleCreateCard groups={groups} employees={employees} />
    </div>
  )
}

function targetSummary(rule: RoutingRuleWithRefs): string {
  if (rule.target_group) return `Group: ${rule.target_group.name}`
  if (rule.target_role_key) return `Role: ${rule.target_role_key}`
  if (rule.target_employee)
    return `Employee: ${rule.target_employee.first_name} ${rule.target_employee.last_name}`
  return "—"
}

function moduleLabel(key: string): string {
  return SOURCE_MODULES.find((m) => m.key === key)?.label ?? key
}

function RuleRowItem({
  rule,
  groups,
  employees,
}: {
  rule: RoutingRuleWithRefs
  groups: GroupRow[]
  employees: EmployeeLite[]
}) {
  const [editing, setEditing] = useState(false)
  const [activePending, startActive] = useTransition()
  const [delPending, startDel] = useTransition()
  function onToggleActive() {
    startActive(async () => {
      const r = await setRoutingRuleActive(rule.id, !rule.is_active)
      if (!r.ok) toast.error(r.error)
    })
  }
  function onDelete() {
    if (!confirm("Delete this routing rule?")) return
    startDel(async () => {
      const r = await deleteRoutingRule(rule.id)
      if (!r.ok) toast.error(r.error)
      else toast.success("Routing rule deleted.")
    })
  }
  return (
    <li className="bg-muted/30 flex flex-col gap-2 rounded-md border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold">
            {rule.name ?? "(unnamed rule)"}
          </span>
          <Badge variant="secondary" className="uppercase">
            priority {rule.priority}
          </Badge>
          {!rule.is_active && (
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
            onClick={onToggleActive}
            disabled={activePending}
          >
            {rule.is_active ? "Deactivate" : "Activate"}
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
            <span className="font-medium uppercase">Module:</span>{" "}
            {moduleLabel(rule.source_module)}
          </div>
          <div>
            <span className="font-medium uppercase">Severity:</span>{" "}
            {rule.severity ?? "any"}
          </div>
          <div>
            <span className="font-medium uppercase">Area:</span>{" "}
            {rule.area_id ?? "any"}
          </div>
          <div>
            <span className="font-medium uppercase">Target:</span>{" "}
            {targetSummary(rule)}
          </div>
        </div>
      )}
      {editing && (
        <RuleForm
          mode="edit"
          rule={rule}
          groups={groups}
          employees={employees}
          onDone={() => setEditing(false)}
        />
      )}
    </li>
  )
}

function RuleCreateCard({
  groups,
  employees,
}: {
  groups: GroupRow[]
  employees: EmployeeLite[]
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Add routing rule</CardTitle>
        <CardDescription>
          Higher priority rules apply first. Severity may be left blank to
          match any. Area picker is module-specific and isn&apos;t part of this
          iteration — paste a UUID if you need to scope by area.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <RuleForm
          mode="create"
          rule={null}
          groups={groups}
          employees={employees}
        />
      </CardContent>
    </Card>
  )
}

function initialTargetKind(rule: RoutingRuleWithRefs | null): "group" | "role" | "employee" {
  if (!rule) return "group"
  if (rule.target_group_id) return "group"
  if (rule.target_role_key) return "role"
  return "employee"
}

function RuleForm({
  mode,
  rule,
  groups,
  employees,
  onDone,
}: {
  mode: "create" | "edit"
  rule: RoutingRuleWithRefs | null
  groups: GroupRow[]
  employees: EmployeeLite[]
  onDone?: () => void
}) {
  const [state, action, pending] = useActionState(
    mode === "create" ? createRoutingRule : updateRoutingRule,
    NULL_STATE,
  )
  const [targetKind, setTargetKind] = useState<"group" | "role" | "employee">(
    initialTargetKind(rule),
  )
  const [sourceModule, setSourceModule] = useState(rule?.source_module ?? SOURCE_MODULES[0]?.key ?? "")
  const [severity, setSeverity] = useState(rule?.severity ?? "any")
  const [targetGroupId, setTargetGroupId] = useState(rule?.target_group_id ?? "")
  const [targetRoleKey, setTargetRoleKey] = useState(rule?.target_role_key ?? "")
  const [targetEmployeeId, setTargetEmployeeId] = useState(rule?.target_employee_id ?? "")
  useEffect(() => {
    if (state.ok === true) {
      toast.success(state.message ?? "Saved.")
      onDone?.()
    }
    if (state.ok === false) toast.error(state.error)
  }, [state, onDone])

  return (
    <form action={action} className="flex flex-col gap-3">
      {rule && <input type="hidden" name="id" value={rule.id} />}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor={`rr-name-${rule?.id ?? "new"}`}>Name</Label>
          <Input
            id={`rr-name-${rule?.id ?? "new"}`}
            name="name"
            defaultValue={rule?.name ?? ""}
            placeholder="e.g. Critical refrigeration alarms → on-call"
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor={`rr-mod-${rule?.id ?? "new"}`}>Source module</Label>
          <input type="hidden" name="source_module" value={sourceModule} />
          <Select value={sourceModule} onValueChange={(v) => setSourceModule(v)}>
            <SelectTrigger id={`rr-mod-${rule?.id ?? "new"}`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SOURCE_MODULES.map((m) => (
                <SelectItem key={m.key} value={m.key}>
                  {m.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor={`rr-sev-${rule?.id ?? "new"}`}>Severity</Label>
          <input type="hidden" name="severity" value={severity} />
          <Select value={severity} onValueChange={(v) => setSeverity(v)}>
            <SelectTrigger id={`rr-sev-${rule?.id ?? "new"}`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="any">Any</SelectItem>
              {SEVERITIES.map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor={`rr-prio-${rule?.id ?? "new"}`}>Priority</Label>
          <Input
            id={`rr-prio-${rule?.id ?? "new"}`}
            name="priority"
            type="number"
            defaultValue={rule?.priority ?? 0}
            className="w-32"
          />
        </div>
        <div className="flex flex-col gap-1 sm:col-span-2">
          <Label htmlFor={`rr-area-${rule?.id ?? "new"}`}>
            Area ID (optional UUID)
          </Label>
          <Input
            id={`rr-area-${rule?.id ?? "new"}`}
            name="area_id"
            defaultValue={rule?.area_id ?? ""}
            placeholder="leave blank to match all areas"
            className="font-mono text-xs"
          />
        </div>
      </div>

      <fieldset className="flex flex-col gap-2 rounded-md border p-3">
        <legend className="text-muted-foreground px-1 text-xs font-medium uppercase">
          Target
        </legend>
        <div className="flex flex-wrap gap-3 text-sm">
          {(["group", "role", "employee"] as const).map((k) => (
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
            <Label htmlFor={`rr-tgt-g-${rule?.id ?? "new"}`}>Group</Label>
            <input type="hidden" name="target_group_id" value={targetGroupId} />
            <Select
              value={targetGroupId || undefined}
              onValueChange={(v) => setTargetGroupId(v)}
            >
              <SelectTrigger id={`rr-tgt-g-${rule?.id ?? "new"}`}>
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
            <Label htmlFor={`rr-tgt-r-${rule?.id ?? "new"}`}>Role</Label>
            <input type="hidden" name="target_role_key" value={targetRoleKey} />
            <Select
              value={targetRoleKey || undefined}
              onValueChange={(v) => setTargetRoleKey(v)}
            >
              <SelectTrigger id={`rr-tgt-r-${rule?.id ?? "new"}`}>
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
        {targetKind === "employee" && (
          <div className="flex flex-col gap-1">
            <Label htmlFor={`rr-tgt-e-${rule?.id ?? "new"}`}>Employee</Label>
            <input type="hidden" name="target_employee_id" value={targetEmployeeId} />
            <Select
              value={targetEmployeeId || undefined}
              onValueChange={(v) => setTargetEmployeeId(v)}
            >
              <SelectTrigger id={`rr-tgt-e-${rule?.id ?? "new"}`}>
                <SelectValue placeholder="Pick employee…" />
              </SelectTrigger>
              <SelectContent>
                {employees.map((e) => (
                  <SelectItem key={e.id} value={e.id}>
                    {e.last_name}, {e.first_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </fieldset>

      <div className="flex justify-end">
        <Button type="submit" size="sm" disabled={pending}>
          {pending
            ? "Saving…"
            : mode === "create"
              ? "Add rule"
              : "Save rule"}
        </Button>
      </div>
    </form>
  )
}
