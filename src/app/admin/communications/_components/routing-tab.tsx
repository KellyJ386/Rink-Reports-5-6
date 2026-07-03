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
  previewRoutingRecipients,
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

type DepartmentLite = { id: string; name: string }

type TargetKind = "group" | "role" | "employee" | "department"

const TIMINGS = [
  { key: "immediate", label: "Immediate (send now)" },
  { key: "end_of_day", label: "End of day digest" },
  { key: "weekly", label: "Weekly (next Monday)" },
  { key: "manual", label: "Manual (queued, no auto-send)" },
] as const

const NULL_STATE: ActionState = { ok: null }

export type AreaOption = { id: string; name: string }

type Props = {
  rules: RoutingRuleWithRefs[]
  groups: GroupRow[]
  employees: EmployeeLite[]
  departments: DepartmentLite[]
  /**
   * Area option lists keyed by source-module key, for modules whose submit
   * path stamps an area id on dispatch (daily_reports, air_quality). Modules
   * without an entry fall back to a raw-UUID input.
   */
  areaOptionsByModule: Record<string, AreaOption[]>
}

export function RoutingTab({
  rules,
  groups,
  employees,
  departments,
  areaOptionsByModule,
}: Props) {
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
              departments={departments}
              areaOptionsByModule={areaOptionsByModule}
            />
          ))}
        </ul>
      )}
      <RuleCreateCard
        groups={groups}
        employees={employees}
        departments={departments}
        areaOptionsByModule={areaOptionsByModule}
      />
    </div>
  )
}

function targetSummary(
  rule: RoutingRuleWithRefs,
  departments: DepartmentLite[],
): string {
  if (rule.target_group) return `Group: ${rule.target_group.name}`
  if (rule.target_role_key) return `Role: ${rule.target_role_key}`
  if (rule.target_employee)
    return `Employee: ${rule.target_employee.first_name} ${rule.target_employee.last_name}`
  if (rule.target_department_id) {
    const d = departments.find((x) => x.id === rule.target_department_id)
    return `Department: ${d?.name ?? rule.target_department_id}`
  }
  return "—"
}

function timingLabel(t: string | null | undefined): string {
  if (!t) return "immediate"
  return TIMINGS.find((x) => x.key === t)?.label ?? t
}

function moduleLabel(key: string): string {
  return SOURCE_MODULES.find((m) => m.key === key)?.label ?? key
}

function RuleRowItem({
  rule,
  groups,
  employees,
  departments,
  areaOptionsByModule,
}: {
  rule: RoutingRuleWithRefs
  groups: GroupRow[]
  employees: EmployeeLite[]
  departments: DepartmentLite[]
  areaOptionsByModule: Record<string, AreaOption[]>
}) {
  const [editing, setEditing] = useState(false)
  const [activePending, startActive] = useTransition()
  const [delPending, startDel] = useTransition()
  const [previewPending, startPreview] = useTransition()
  const [preview, setPreview] = useState<
    Array<{ id: string; first_name: string; last_name: string; email: string | null }> | null
  >(null)
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
  function onPreview() {
    startPreview(async () => {
      const r = await previewRoutingRecipients(rule.id)
      if (!r.ok) {
        toast.error(r.error)
        return
      }
      setPreview(r.recipients)
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
            onClick={onPreview}
            disabled={previewPending}
          >
            {previewPending ? "Loading…" : "Preview recipients"}
          </Button>
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
            {rule.area_id
              ? (areaOptionsByModule[rule.source_module]?.find(
                  (a) => a.id === rule.area_id,
                )?.name ?? rule.area_id)
              : "any"}
          </div>
          <div>
            <span className="font-medium uppercase">Target:</span>{" "}
            {targetSummary(rule, departments)}
          </div>
          <div>
            <span className="font-medium uppercase">Timing:</span>{" "}
            {timingLabel(rule.timing)}
          </div>
          <div>
            <span className="font-medium uppercase">Attach PDF:</span>{" "}
            {rule.attach_pdf
              ? "yes (in-app link + email attachment)"
              : "no"}
          </div>
          <div>
            <span className="font-medium uppercase">Ack required:</span>{" "}
            {rule.requires_acknowledgement ? "yes" : "no"}
          </div>
        </div>
      )}
      {preview && !editing ? (
        <div className="rounded-md border bg-background/60 p-2 text-xs">
          <div className="text-muted-foreground mb-1 font-medium uppercase">
            Recipients ({preview.length})
          </div>
          {preview.length === 0 ? (
            <div className="text-muted-foreground">
              No active employees match this rule.
            </div>
          ) : (
            <ul className="grid grid-cols-1 gap-x-3 sm:grid-cols-2">
              {preview.map((r) => (
                <li key={r.id}>
                  {r.last_name}, {r.first_name}
                  {r.email ? (
                    <span className="text-muted-foreground"> · {r.email}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
      {editing && (
        <RuleForm
          mode="edit"
          rule={rule}
          groups={groups}
          employees={employees}
          departments={departments}
          areaOptionsByModule={areaOptionsByModule}
          onDone={() => setEditing(false)}
        />
      )}
    </li>
  )
}

function RuleCreateCard({
  groups,
  employees,
  departments,
  areaOptionsByModule,
}: {
  groups: GroupRow[]
  employees: EmployeeLite[]
  departments: DepartmentLite[]
  areaOptionsByModule: Record<string, AreaOption[]>
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Add routing rule</CardTitle>
        <CardDescription>
          Higher priority rules apply first. Severity may be left blank to
          match any. Routing controls who gets <em>notified</em> (in-app
          message + email fan-out) — every staff member with communications
          access still sees all facility alerts in their inbox.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <RuleForm
          mode="create"
          rule={null}
          groups={groups}
          employees={employees}
          departments={departments}
          areaOptionsByModule={areaOptionsByModule}
        />
      </CardContent>
    </Card>
  )
}

function initialTargetKind(rule: RoutingRuleWithRefs | null): TargetKind {
  if (!rule) return "group"
  if (rule.target_group_id) return "group"
  if (rule.target_role_key) return "role"
  if (rule.target_department_id) return "department"
  return "employee"
}

function RuleForm({
  mode,
  rule,
  groups,
  employees,
  departments,
  areaOptionsByModule,
  onDone,
}: {
  mode: "create" | "edit"
  rule: RoutingRuleWithRefs | null
  groups: GroupRow[]
  employees: EmployeeLite[]
  departments: DepartmentLite[]
  areaOptionsByModule: Record<string, AreaOption[]>
  onDone?: () => void
}) {
  const [state, action, pending] = useActionState(
    mode === "create" ? createRoutingRule : updateRoutingRule,
    NULL_STATE,
  )
  const [targetKind, setTargetKind] = useState<TargetKind>(
    initialTargetKind(rule),
  )
  const [sourceModule, setSourceModule] = useState(rule?.source_module ?? SOURCE_MODULES[0]?.key ?? "")
  const [severity, setSeverity] = useState(rule?.severity ?? "any")
  const [targetGroupId, setTargetGroupId] = useState(rule?.target_group_id ?? "")
  const [targetRoleKey, setTargetRoleKey] = useState(rule?.target_role_key ?? "")
  const [targetEmployeeId, setTargetEmployeeId] = useState(rule?.target_employee_id ?? "")
  const [targetDepartmentId, setTargetDepartmentId] = useState(
    rule?.target_department_id ?? "",
  )
  const [timing, setTiming] = useState<string>(rule?.timing ?? "immediate")
  const [areaId, setAreaId] = useState(rule?.area_id ?? "")
  const [attachPdf, setAttachPdf] = useState<boolean>(!!rule?.attach_pdf)
  const [requiresAck, setRequiresAck] = useState<boolean>(
    !!rule?.requires_acknowledgement,
  )
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
          <Select
            value={sourceModule}
            onValueChange={(v) => {
              setSourceModule(v)
              if (v !== rule?.source_module) setAreaId("")
              else setAreaId(rule?.area_id ?? "")
            }}
          >
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
        <AreaField
          rule={rule}
          sourceModule={sourceModule}
          areaOptions={areaOptionsByModule[sourceModule] ?? null}
          areaId={areaId}
          onAreaIdChange={setAreaId}
        />
        <div className="flex flex-col gap-1">
          <Label htmlFor={`rr-timing-${rule?.id ?? "new"}`}>Timing</Label>
          <input type="hidden" name="timing" value={timing} />
          <Select value={timing} onValueChange={(v) => setTiming(v)}>
            <SelectTrigger id={`rr-timing-${rule?.id ?? "new"}`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TIMINGS.map((t) => (
                <SelectItem key={t.key} value={t.key}>
                  {t.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="text-muted-foreground text-xs">
            End-of-day / weekly queue into <code>notification_outbox</code>;
            a scheduler drains them. See scheduler-todo.md.
          </span>
        </div>
        <div className="flex flex-col gap-1">
          <Label className="flex items-center gap-2">
            <input
              type="checkbox"
              name="attach_pdf"
              checked={attachPdf}
              onChange={(e) => setAttachPdf(e.target.checked)}
            />
            Attach PDF of the submission
          </Label>
          <span className="text-muted-foreground text-xs">
            Renders a PDF of the source record, links it from the in-app
            message, and attaches it to outbound emails.
          </span>
        </div>
        <div className="flex flex-col gap-1">
          <Label className="flex items-center gap-2">
            <input
              type="checkbox"
              name="requires_acknowledgement"
              checked={requiresAck}
              onChange={(e) => setRequiresAck(e.target.checked)}
            />
            Require recipient acknowledgement
          </Label>
          <span className="text-muted-foreground text-xs">
            Recipients must explicitly acknowledge the message in their
            inbox. Use for critical alerts (e.g. accident reports with
            severity = critical).
          </span>
        </div>
      </div>

      <fieldset className="flex flex-col gap-2 rounded-md border p-3">
        <legend className="text-muted-foreground px-1 text-xs font-medium uppercase">
          Target
        </legend>
        <div className="flex flex-wrap gap-3 text-sm">
          {(["group", "role", "department", "employee"] as const).map((k) => (
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
        {targetKind === "department" && (
          <div className="flex flex-col gap-1">
            <Label htmlFor={`rr-tgt-d-${rule?.id ?? "new"}`}>Department</Label>
            <input
              type="hidden"
              name="target_department_id"
              value={targetDepartmentId}
            />
            <Select
              value={targetDepartmentId || undefined}
              onValueChange={(v) => setTargetDepartmentId(v)}
            >
              <SelectTrigger id={`rr-tgt-d-${rule?.id ?? "new"}`}>
                <SelectValue placeholder="Pick department…" />
              </SelectTrigger>
              <SelectContent>
                {departments.length === 0 ? (
                  <SelectItem value="__none__" disabled>
                    No departments configured
                  </SelectItem>
                ) : (
                  departments.map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      {d.name}
                    </SelectItem>
                  ))
                )}
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

/**
 * Area scope for a routing rule. Modules whose submit path stamps an area id
 * on dispatch (daily reports, air quality) get a real picker; other modules
 * fall back to a raw-UUID input since there is no unified areas table to
 * enumerate.
 */
function AreaField({
  rule,
  sourceModule,
  areaOptions,
  areaId,
  onAreaIdChange,
}: {
  rule: RoutingRuleWithRefs | null
  sourceModule: string
  areaOptions: AreaOption[] | null
  areaId: string
  onAreaIdChange: (v: string) => void
}) {
  const fieldId = `rr-area-${rule?.id ?? "new"}`
  if (areaOptions && areaOptions.length > 0) {
    const ANY = "__any__"
    const known = areaOptions.some((a) => a.id === areaId)
    return (
      <div className="flex flex-col gap-1 sm:col-span-2">
        <Label htmlFor={fieldId}>Area (optional)</Label>
        <input type="hidden" name="area_id" value={areaId} />
        <Select
          value={known ? areaId : ANY}
          onValueChange={(v) => onAreaIdChange(v === ANY ? "" : v)}
        >
          <SelectTrigger id={fieldId}>
            <SelectValue placeholder="Any area" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>Any area</SelectItem>
            {areaOptions.map((a) => (
              <SelectItem key={a.id} value={a.id}>
                {a.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {!known && areaId ? (
          <span className="text-muted-foreground text-xs">
            Current value {areaId} isn&apos;t in the {sourceModule} area list;
            saving keeps it unless you pick another option.
          </span>
        ) : null}
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-1 sm:col-span-2">
      <Label htmlFor={fieldId}>Area ID (optional UUID)</Label>
      <Input
        id={fieldId}
        name="area_id"
        value={areaId}
        onChange={(e) => onAreaIdChange(e.target.value)}
        placeholder="leave blank to match all areas"
        className="font-mono text-xs"
      />
      <span className="text-muted-foreground text-xs">
        This module has no area list to pick from; events from it currently
        carry no area, so an area-scoped rule will not match.
      </span>
    </div>
  )
}
