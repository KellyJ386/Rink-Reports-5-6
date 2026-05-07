"use client"

import { useState, useTransition } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import type { Json, Tables } from "@/types/database"

import {
  createComplianceRule,
  deleteComplianceRule,
  moveComplianceRule,
  setComplianceRuleActive,
  updateComplianceRule,
} from "../../_lib/governance-actions"
import {
  COMPLIANCE_RULE_TYPES,
  type ComplianceRuleType,
  isComplianceRuleType,
} from "../../_lib/governance-types"

type Rule = Tables<"schedule_compliance_rules">

const RULE_TYPE_LABEL: Record<ComplianceRuleType, string> = {
  minor_max_hours: "Minor max hours",
  overtime: "Overtime",
  break_required: "Break required",
  certification_required: "Certification required",
  min_rest_between_shifts: "Min rest between shifts",
  custom: "Custom",
}

function asObject(v: Json | null | undefined): Record<string, Json> {
  if (v && typeof v === "object" && !Array.isArray(v)) {
    return v as Record<string, Json>
  }
  return {}
}

function asNumber(v: Json | undefined): number | "" {
  if (typeof v === "number") return v
  if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))) {
    return Number(v)
  }
  return ""
}

function asBoolean(v: Json | undefined, fallback: boolean): boolean {
  if (typeof v === "boolean") return v
  return fallback
}

function asStringArray(v: Json | undefined): string[] {
  if (Array.isArray(v)) {
    return v.filter((x): x is string => typeof x === "string")
  }
  return []
}

export function ComplianceClient({ rules }: { rules: Rule[] }) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [showAdd, setShowAdd] = useState(false)

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <Button onClick={() => setShowAdd((v) => !v)} variant="outline">
          {showAdd ? "Close add form" : "Add rule"}
        </Button>
      </div>

      {showAdd ? <AddRuleForm onDone={() => setShowAdd(false)} /> : null}

      {rules.length === 0 ? (
        <div className="bg-card text-muted-foreground rounded-md border p-6 text-sm">
          No compliance rules yet. Add one above, or seed defaults from{" "}
          Settings.
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {rules.map((r, i) => (
            <RuleCard
              key={r.id}
              rule={r}
              isFirst={i === 0}
              isLast={i === rules.length - 1}
              isEditing={editingId === r.id}
              onEdit={() =>
                setEditingId((cur) => (cur === r.id ? null : r.id))
              }
              onCloseEdit={() => setEditingId(null)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function RuleCard({
  rule,
  isFirst,
  isLast,
  isEditing,
  onEdit,
  onCloseEdit,
}: {
  rule: Rule
  isFirst: boolean
  isLast: boolean
  isEditing: boolean
  onEdit: () => void
  onCloseEdit: () => void
}) {
  const [pending, startTransition] = useTransition()
  const ruleType: ComplianceRuleType = isComplianceRuleType(rule.rule_type)
    ? rule.rule_type
    : "custom"

  function runMove(delta: 1 | -1) {
    startTransition(async () => {
      const r = await moveComplianceRule(rule.id, delta)
      if (r.ok === true) toast.success(r.message ?? "Reordered.")
      else if (r.ok === false) toast.error(r.error)
    })
  }

  function runToggle() {
    startTransition(async () => {
      const r = await setComplianceRuleActive(rule.id, !rule.is_active)
      if (r.ok === true) toast.success(r.message ?? "Updated.")
      else if (r.ok === false) toast.error(r.error)
    })
  }

  function runDelete() {
    if (!confirm(`Delete rule "${rule.name}"?`)) return
    startTransition(async () => {
      const r = await deleteComplianceRule(rule.id)
      if (r.ok === true) toast.success(r.message ?? "Deleted.")
      else if (r.ok === false) toast.error(r.error)
    })
  }

  return (
    <div className="bg-card flex flex-col gap-3 rounded-md border p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">{rule.name}</span>
            <span
              className={`${
                rule.is_active
                  ? "bg-green-100 text-green-900 dark:bg-green-900/40 dark:text-green-100"
                  : "bg-muted text-muted-foreground"
              } inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium`}
            >
              {rule.is_active ? "Active" : "Disabled"}
            </span>
            <span className="text-muted-foreground text-xs">
              {RULE_TYPE_LABEL[ruleType]}
            </span>
          </div>
          {rule.description ? (
            <div className="text-muted-foreground text-sm">
              {rule.description}
            </div>
          ) : null}
          <ParamsSummary ruleType={ruleType} params={rule.params} />
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => runMove(-1)}
            disabled={pending || isFirst}
          >
            ↑
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => runMove(1)}
            disabled={pending || isLast}
          >
            ↓
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={runToggle}
            disabled={pending}
          >
            {rule.is_active ? "Disable" : "Enable"}
          </Button>
          <Button size="sm" variant="outline" onClick={onEdit} disabled={pending}>
            {isEditing ? "Close" : "Edit"}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="text-destructive"
            onClick={runDelete}
            disabled={pending}
          >
            Delete
          </Button>
        </div>
      </div>

      {isEditing ? (
        <EditRuleForm rule={rule} onDone={onCloseEdit} />
      ) : null}
    </div>
  )
}

function ParamsSummary({
  ruleType,
  params,
}: {
  ruleType: ComplianceRuleType
  params: Json
}) {
  const obj = asObject(params)
  const items: string[] = []
  if (ruleType === "minor_max_hours") {
    if (obj.max_weekly_hours !== undefined) {
      items.push(`max_weekly_hours: ${String(obj.max_weekly_hours)}`)
    }
    if (obj.applies_to_minors !== undefined) {
      items.push(`applies_to_minors: ${String(obj.applies_to_minors)}`)
    }
  } else if (ruleType === "overtime") {
    if (obj.weekly_threshold !== undefined) {
      items.push(`weekly_threshold: ${String(obj.weekly_threshold)}`)
    }
  } else if (ruleType === "break_required") {
    if (obj.after_hours !== undefined) {
      items.push(`after_hours: ${String(obj.after_hours)}`)
    }
    if (obj.min_minutes !== undefined) {
      items.push(`min_minutes: ${String(obj.min_minutes)}`)
    }
  } else if (ruleType === "certification_required") {
    const keys = asStringArray(obj.certification_keys)
    items.push(`certification_keys: [${keys.join(", ")}]`)
  } else if (ruleType === "min_rest_between_shifts") {
    if (obj.min_hours !== undefined) {
      items.push(`min_hours: ${String(obj.min_hours)}`)
    }
  } else {
    items.push(JSON.stringify(obj))
  }
  if (items.length === 0) return null
  return (
    <div className="text-muted-foreground font-mono text-xs">
      {items.join("  ·  ")}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Add form
// ---------------------------------------------------------------------------

function AddRuleForm({ onDone }: { onDone: () => void }) {
  const [ruleType, setRuleType] = useState<ComplianceRuleType>("minor_max_hours")
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [sortOrder, setSortOrder] = useState<string>("0")
  const [paramsState, setParamsState] = useState<Record<string, Json>>(
    defaultParamsFor("minor_max_hours")
  )
  const [paramsJson, setParamsJson] = useState<string>("{}")
  const [pending, startTransition] = useTransition()

  function changeRuleType(next: ComplianceRuleType) {
    setRuleType(next)
    setParamsState(defaultParamsFor(next))
    if (next === "custom") setParamsJson("{}")
  }

  function submit() {
    if (!name.trim()) {
      toast.error("Name is required.")
      return
    }
    let paramsValue: Record<string, Json>
    if (ruleType === "custom") {
      try {
        const parsed = JSON.parse(paramsJson || "{}") as unknown
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
          toast.error("Custom params must be a JSON object.")
          return
        }
        paramsValue = parsed as Record<string, Json>
      } catch {
        toast.error("Invalid JSON.")
        return
      }
    } else {
      paramsValue = paramsState
    }

    const sortNum = Number.parseInt(sortOrder, 10)
    startTransition(async () => {
      const r = await createComplianceRule({
        rule_type: ruleType,
        name: name.trim(),
        description: description.trim() || null,
        params: paramsValue,
        is_active: true,
        sort_order: Number.isFinite(sortNum) ? sortNum : 0,
      })
      if (r.ok === true) {
        toast.success(r.message ?? "Created.")
        onDone()
      } else if (r.ok === false) {
        toast.error(r.error)
      }
    })
  }

  return (
    <div className="bg-card flex flex-col gap-3 rounded-md border p-4 shadow-sm">
      <h3 className="text-sm font-semibold">Add rule</h3>
      <div className="grid gap-3 md:grid-cols-2">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium">Rule type</label>
          <select
            value={ruleType}
            onChange={(e) => changeRuleType(e.target.value as ComplianceRuleType)}
            className="border-border bg-background h-9 rounded-md border px-2 text-sm"
          >
            {COMPLIANCE_RULE_TYPES.map((t) => (
              <option key={t} value={t}>
                {RULE_TYPE_LABEL[t]}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium">Name</label>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1 md:col-span-2">
          <label className="text-xs font-medium">Description</label>
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium">Sort order</label>
          <Input
            type="number"
            value={sortOrder}
            onChange={(e) => setSortOrder(e.target.value)}
          />
        </div>
      </div>

      <ParamsFields
        ruleType={ruleType}
        value={paramsState}
        onChange={setParamsState}
        rawJson={paramsJson}
        onRawJsonChange={setParamsJson}
      />

      <div className="flex gap-2">
        <Button onClick={submit} disabled={pending}>
          {pending ? "Saving…" : "Create rule"}
        </Button>
        <Button variant="ghost" onClick={onDone} disabled={pending}>
          Cancel
        </Button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Edit form
// ---------------------------------------------------------------------------

function EditRuleForm({ rule, onDone }: { rule: Rule; onDone: () => void }) {
  const ruleType: ComplianceRuleType = isComplianceRuleType(rule.rule_type)
    ? rule.rule_type
    : "custom"
  const [name, setName] = useState(rule.name)
  const [description, setDescription] = useState(rule.description ?? "")
  const [sortOrder, setSortOrder] = useState<string>(
    String(rule.sort_order ?? 0)
  )
  const [paramsState, setParamsState] = useState<Record<string, Json>>(
    asObject(rule.params)
  )
  const [paramsJson, setParamsJson] = useState<string>(
    JSON.stringify(asObject(rule.params), null, 2)
  )
  const [pending, startTransition] = useTransition()

  function submit() {
    if (!name.trim()) {
      toast.error("Name is required.")
      return
    }
    const sortNum = Number.parseInt(sortOrder, 10)

    if (ruleType === "custom") {
      try {
        const parsed = JSON.parse(paramsJson || "{}") as unknown
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
          toast.error("Custom params must be a JSON object.")
          return
        }
        startTransition(async () => {
          const r = await updateComplianceRule(rule.id, {
            name: name.trim(),
            description: description.trim() || null,
            sort_order: Number.isFinite(sortNum) ? sortNum : 0,
            params_replace: parsed as Record<string, Json>,
          })
          if (r.ok === true) {
            toast.success(r.message ?? "Saved.")
            onDone()
          } else if (r.ok === false) {
            toast.error(r.error)
          }
        })
      } catch {
        toast.error("Invalid JSON.")
      }
      return
    }

    startTransition(async () => {
      const r = await updateComplianceRule(rule.id, {
        name: name.trim(),
        description: description.trim() || null,
        sort_order: Number.isFinite(sortNum) ? sortNum : 0,
        params_patch: paramsState,
      })
      if (r.ok === true) {
        toast.success(r.message ?? "Saved.")
        onDone()
      } else if (r.ok === false) {
        toast.error(r.error)
      }
    })
  }

  return (
    <div className="bg-muted/30 flex flex-col gap-3 rounded-md border p-3">
      <div className="grid gap-3 md:grid-cols-2">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium">Name</label>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium">Sort order</label>
          <Input
            type="number"
            value={sortOrder}
            onChange={(e) => setSortOrder(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1 md:col-span-2">
          <label className="text-xs font-medium">Description</label>
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
          />
        </div>
      </div>

      <ParamsFields
        ruleType={ruleType}
        value={paramsState}
        onChange={setParamsState}
        rawJson={paramsJson}
        onRawJsonChange={setParamsJson}
      />

      <div className="flex gap-2">
        <Button size="sm" onClick={submit} disabled={pending}>
          {pending ? "Saving…" : "Save changes"}
        </Button>
        <Button size="sm" variant="ghost" onClick={onDone} disabled={pending}>
          Cancel
        </Button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Param field renderers
// ---------------------------------------------------------------------------

function defaultParamsFor(rt: ComplianceRuleType): Record<string, Json> {
  switch (rt) {
    case "minor_max_hours":
      return { max_weekly_hours: 18, applies_to_minors: true }
    case "overtime":
      return { weekly_threshold: 40 }
    case "break_required":
      return { after_hours: 6, min_minutes: 30 }
    case "certification_required":
      return { certification_keys: [] }
    case "min_rest_between_shifts":
      return { min_hours: 8 }
    case "custom":
    default:
      return {}
  }
}

function ParamsFields({
  ruleType,
  value,
  onChange,
  rawJson,
  onRawJsonChange,
}: {
  ruleType: ComplianceRuleType
  value: Record<string, Json>
  onChange: (next: Record<string, Json>) => void
  rawJson: string
  onRawJsonChange: (next: string) => void
}) {
  if (ruleType === "custom") {
    return (
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium">Params (JSON)</label>
        <Textarea
          value={rawJson}
          onChange={(e) => onRawJsonChange(e.target.value)}
          rows={6}
          className="font-mono text-xs"
        />
      </div>
    )
  }

  if (ruleType === "minor_max_hours") {
    const max = asNumber(value.max_weekly_hours)
    const applies = asBoolean(value.applies_to_minors, true)
    return (
      <div className="grid gap-3 md:grid-cols-2">
        <NumberField
          label="Max weekly hours"
          value={max}
          onChange={(n) => onChange({ ...value, max_weekly_hours: n })}
        />
        <BoolField
          label="Applies to minors"
          value={applies}
          onChange={(b) => onChange({ ...value, applies_to_minors: b })}
        />
      </div>
    )
  }

  if (ruleType === "overtime") {
    return (
      <div className="grid gap-3 md:grid-cols-2">
        <NumberField
          label="Weekly threshold (hours)"
          value={asNumber(value.weekly_threshold)}
          onChange={(n) => onChange({ ...value, weekly_threshold: n })}
        />
      </div>
    )
  }

  if (ruleType === "break_required") {
    return (
      <div className="grid gap-3 md:grid-cols-2">
        <NumberField
          label="After hours"
          value={asNumber(value.after_hours)}
          onChange={(n) => onChange({ ...value, after_hours: n })}
        />
        <NumberField
          label="Min minutes"
          value={asNumber(value.min_minutes)}
          onChange={(n) => onChange({ ...value, min_minutes: n })}
        />
      </div>
    )
  }

  if (ruleType === "certification_required") {
    const keys = asStringArray(value.certification_keys)
    const csv = keys.join(", ")
    return (
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium">
          Certification keys (comma-separated)
        </label>
        <Input
          value={csv}
          onChange={(e) => {
            const next = e.target.value
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean)
            onChange({ ...value, certification_keys: next as Json })
          }}
        />
      </div>
    )
  }

  if (ruleType === "min_rest_between_shifts") {
    return (
      <div className="grid gap-3 md:grid-cols-2">
        <NumberField
          label="Min hours"
          value={asNumber(value.min_hours)}
          onChange={(n) => onChange({ ...value, min_hours: n })}
        />
      </div>
    )
  }

  return null
}

function NumberField({
  label,
  value,
  onChange,
}: {
  label: string
  value: number | ""
  onChange: (next: number) => void
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium">{label}</label>
      <Input
        type="number"
        value={value === "" ? "" : String(value)}
        onChange={(e) => {
          const v = e.target.value
          const n = Number(v)
          if (v === "" || Number.isNaN(n)) {
            onChange(0)
          } else {
            onChange(n)
          }
        }}
      />
    </div>
  )
}

function BoolField({
  label,
  value,
  onChange,
}: {
  label: string
  value: boolean
  onChange: (next: boolean) => void
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
