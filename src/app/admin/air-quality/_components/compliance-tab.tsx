"use client"

import Link from "next/link"
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
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"

import {
  createComplianceRule,
  deleteComplianceRule,
  setComplianceRuleActive,
  updateComplianceRule,
} from "../actions"
import type {
  ActionState,
  ComplianceData,
  ComplianceRuleRow,
} from "../types"

const NULL_STATE: ActionState = { ok: null }

type Props = {
  data: ComplianceData
  activeJurisdiction: string | null
}

export function ComplianceTab({ data, activeJurisdiction }: Props) {
  const { rules, jurisdictions, defaultJurisdiction } = data

  const filtered = activeJurisdiction
    ? rules.filter((r) => r.jurisdiction === activeJurisdiction)
    : rules

  const grouped = new Map<string, ComplianceRuleRow[]>()
  for (const r of filtered) {
    const arr = grouped.get(r.jurisdiction) ?? []
    arr.push(r)
    grouped.set(r.jurisdiction, arr)
  }
  const groupKeys = Array.from(grouped.keys()).sort()

  return (
    <div className="flex flex-col gap-4">
      <p className="text-muted-foreground text-sm">
        Compliance rules are reference text shown to admins for documentation;
        automated evaluation and alerting come from the compliance profile
        selected on the Setup tab, not from these rules.
      </p>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[16rem_1fr]">
      <div className="flex flex-col gap-3">
        <Card>
          <CardHeader>
            <CardTitle>Jurisdictions</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-1 p-2">
            <Link
              href="/admin/air-quality?tab=compliance"
              className={cn(
                "rounded-md px-3 py-2 text-sm transition-colors",
                !activeJurisdiction
                  ? "bg-primary text-primary-foreground"
                  : "hover:bg-accent hover:text-accent-foreground",
              )}
            >
              All ({rules.length})
            </Link>
            {jurisdictions.map((j) => {
              const count = rules.filter((r) => r.jurisdiction === j).length
              return (
                <Link
                  key={j}
                  href={`/admin/air-quality?tab=compliance&jurisdiction=${encodeURIComponent(j)}`}
                  className={cn(
                    "flex items-center justify-between gap-2 rounded-md px-3 py-2 text-sm transition-colors",
                    activeJurisdiction === j
                      ? "bg-primary text-primary-foreground"
                      : "hover:bg-accent hover:text-accent-foreground",
                  )}
                >
                  <span className="font-medium">{j}</span>
                  <span
                    className={cn(
                      "text-xs",
                      activeJurisdiction === j
                        ? "text-primary-foreground/80"
                        : "text-muted-foreground",
                    )}
                  >
                    {count}
                  </span>
                </Link>
              )
            })}
          </CardContent>
        </Card>
        <RuleCreateCard
          jurisdictions={jurisdictions}
          defaultJurisdiction={defaultJurisdiction}
        />
      </div>
      <div className="flex flex-col gap-6">
        {groupKeys.length === 0 ? (
          <Card>
            <CardHeader>
              <CardTitle>No rules configured</CardTitle>
              <CardDescription>
                {activeJurisdiction
                  ? `No compliance rules for "${activeJurisdiction}". Add one with the form on the left, or `
                  : "Add a compliance rule for your jurisdiction with the form on the left, or "}
                <Link
                  href="/admin/air-quality?tab=compliance"
                  className="text-primary underline"
                >
                  view all jurisdictions
                </Link>
                .
              </CardDescription>
            </CardHeader>
          </Card>
        ) : (
          groupKeys.map((j) => (
            <Card key={j}>
              <CardHeader>
                <CardTitle>{j}</CardTitle>
                <CardDescription>
                  {grouped.get(j)?.length ?? 0} rule
                  {(grouped.get(j)?.length ?? 0) === 1 ? "" : "s"}
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                {(grouped.get(j) ?? []).map((rule) => (
                  <ComplianceRuleItem
                    key={rule.id}
                    rule={rule}
                    jurisdictions={jurisdictions}
                  />
                ))}
              </CardContent>
            </Card>
          ))
        )}
      </div>
      </div>
    </div>
  )
}

function RuleCreateCard({
  jurisdictions,
  defaultJurisdiction,
}: {
  jurisdictions: string[]
  defaultJurisdiction: string | null
}) {
  const [state, action, pending] = useActionState(
    createComplianceRule,
    NULL_STATE,
  )
  useEffect(() => {
    if (state.ok === true) toast.success(state.message ?? "Rule created.")
    if (state.ok === false) toast.error(state.error)
  }, [state])
  return (
    <Card>
      <CardHeader>
        <CardTitle>Add compliance rule</CardTitle>
      </CardHeader>
      <CardContent>
        <form action={action} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor="new-rule-jur">Jurisdiction</Label>
            <Input
              id="new-rule-jur"
              name="jurisdiction"
              required
              defaultValue={defaultJurisdiction ?? ""}
              list="new-rule-jur-list"
              placeholder="e.g. us_federal"
            />
            <datalist id="new-rule-jur-list">
              {jurisdictions.map((j) => (
                <option key={j} value={j} />
              ))}
            </datalist>
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="new-rule-name">Rule name</Label>
            <Input id="new-rule-name" name="rule_name" required />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="new-rule-body">Rule body</Label>
            <Textarea id="new-rule-body" name="rule_body" required rows={4} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <Label htmlFor="new-rule-from">Effective from</Label>
              <Input id="new-rule-from" name="effective_from" type="date" />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="new-rule-to">Effective to</Label>
              <Input id="new-rule-to" name="effective_to" type="date" />
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="new-rule-sort">Sort</Label>
            <Input
              id="new-rule-sort"
              name="sort_order"
              type="number"
              defaultValue={0}
              className="w-24"
            />
          </div>
          <Button type="submit" size="sm" disabled={pending}>
            {pending ? "Adding…" : "Add rule"}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}

function fmtDate(d: string | null): string {
  if (!d) return "—"
  return d
}

function ComplianceRuleItem({
  rule,
  jurisdictions,
}: {
  rule: ComplianceRuleRow
  jurisdictions: string[]
}) {
  const [editing, setEditing] = useState(false)
  const [state, action, pending] = useActionState(
    updateComplianceRule,
    NULL_STATE,
  )
  const [activePending, startActive] = useTransition()
  const [delPending, startDel] = useTransition()

  useEffect(() => {
    if (state.ok === true) toast.success(state.message ?? "Rule updated.")
    if (state.ok === false) toast.error(state.error)
  }, [state])

  function onToggleActive() {
    startActive(async () => {
      const r = await setComplianceRuleActive(rule.id, !rule.is_active)
      if (!r.ok) toast.error(r.error)
    })
  }
  function onDelete() {
    if (!confirm(`Delete rule "${rule.rule_name}"?`)) return
    startDel(async () => {
      const r = await deleteComplianceRule(rule.id)
      if (!r.ok) toast.error(r.error)
      else toast.success("Rule deleted.")
    })
  }

  return (
    <div className="bg-muted/30 flex flex-col gap-2 rounded-md border p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold">{rule.rule_name}</span>
            {!rule.is_active && (
              <Badge variant="secondary" className="uppercase">
                off
              </Badge>
            )}
          </div>
          <span className="text-muted-foreground text-xs">
            Effective {fmtDate(rule.effective_from)} → {fmtDate(rule.effective_to)}{" "}
            · sort {rule.sort_order}
          </span>
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
      {!editing ? (
        <p className="bg-background rounded-md border p-2 text-sm whitespace-pre-wrap">
          {rule.rule_body}
        </p>
      ) : (
        <form action={action} className="flex flex-col gap-3">
          <input type="hidden" name="id" value={rule.id} />
          <div className="flex flex-col gap-1">
            <Label htmlFor={`r-jur-${rule.id}`}>Jurisdiction</Label>
            <Input
              id={`r-jur-${rule.id}`}
              name="jurisdiction"
              defaultValue={rule.jurisdiction}
              list={`r-jur-list-${rule.id}`}
              required
            />
            <datalist id={`r-jur-list-${rule.id}`}>
              {jurisdictions.map((j) => (
                <option key={j} value={j} />
              ))}
            </datalist>
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor={`r-name-${rule.id}`}>Rule name</Label>
            <Input
              id={`r-name-${rule.id}`}
              name="rule_name"
              defaultValue={rule.rule_name}
              required
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor={`r-body-${rule.id}`}>Rule body</Label>
            <Textarea
              id={`r-body-${rule.id}`}
              name="rule_body"
              defaultValue={rule.rule_body}
              rows={4}
              required
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <Label htmlFor={`r-from-${rule.id}`}>Effective from</Label>
              <Input
                id={`r-from-${rule.id}`}
                name="effective_from"
                type="date"
                defaultValue={rule.effective_from ?? ""}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor={`r-to-${rule.id}`}>Effective to</Label>
              <Input
                id={`r-to-${rule.id}`}
                name="effective_to"
                type="date"
                defaultValue={rule.effective_to ?? ""}
              />
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor={`r-sort-${rule.id}`}>Sort</Label>
            <Input
              id={`r-sort-${rule.id}`}
              name="sort_order"
              type="number"
              defaultValue={rule.sort_order}
              className="w-24"
            />
          </div>
          <div className="flex justify-end">
            <Button type="submit" size="sm" disabled={pending}>
              {pending ? "Saving…" : "Save rule"}
            </Button>
          </div>
        </form>
      )}
    </div>
  )
}
