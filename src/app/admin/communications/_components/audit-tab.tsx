"use client"

import { useRouter, useSearchParams } from "next/navigation"
import { useState, useTransition } from "react"

import { Badge } from "@/components/ui/badge"
import type { BadgeProps } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

import type { AuditLogItem, EmployeeLite } from "../types"

type AuditParams = {
  entity_type?: string
  action?: string
  actor?: string
  from?: string
  to?: string
}

type Props = {
  items: AuditLogItem[]
  employees: EmployeeLite[]
  entityTypes: string[]
  actions: string[]
  params: AuditParams
}

function fmt(ts: string): string {
  try {
    return new Date(ts).toLocaleString()
  } catch {
    return ts
  }
}

function actionBadgeVariant(action: string): BadgeProps["variant"] {
  if (action === "delete") return "error"
  if (action === "create" || action === "resolve") return "success"
  if (action === "update") return "info"
  if (action === "activate" || action === "deactivate" || action === "reopen")
    return "warning"
  return "secondary"
}

export function AuditTab({
  items,
  employees,
  entityTypes,
  actions,
  params,
}: Props) {
  return (
    <div className="flex flex-col gap-4">
      <AuditFilters
        employees={employees}
        entityTypes={entityTypes}
        actions={actions}
        params={params}
      />
      {items.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>No audit entries</CardTitle>
            <CardDescription>
              Mutations across the Communications module will appear here once
              they happen.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((it) => (
            <AuditRowItem key={it.id} item={it} />
          ))}
        </ul>
      )}
    </div>
  )
}

function AuditFilters({
  employees,
  entityTypes,
  actions,
  params,
}: {
  employees: EmployeeLite[]
  entityTypes: string[]
  actions: string[]
  params: AuditParams
}) {
  const router = useRouter()
  const sp = useSearchParams()
  const [pending, startTransition] = useTransition()

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(sp.toString())
    if (value) next.set(key, value)
    else next.delete(key)
    startTransition(() => {
      router.replace(`?${next.toString()}`, { scroll: false })
    })
  }
  function clearAll() {
    const next = new URLSearchParams()
    next.set("tab", "audit")
    startTransition(() => {
      router.replace(`?${next.toString()}`, { scroll: false })
    })
  }
  const hasAny = Boolean(
    params.entity_type ||
      params.action ||
      params.actor ||
      params.from ||
      params.to,
  )

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="flex flex-col gap-1">
        <label className="text-muted-foreground text-xs font-medium">
          Entity
        </label>
        <Select
          value={params.entity_type || undefined}
          onValueChange={(v) => setParam("entity_type", v)}
          disabled={pending}
        >
          <SelectTrigger className="min-w-44">
            <SelectValue placeholder="All entities" />
          </SelectTrigger>
          <SelectContent>
            {entityTypes.map((t) => (
              <SelectItem key={t} value={t}>
                {t}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-muted-foreground text-xs font-medium">
          Action
        </label>
        <Select
          value={params.action || undefined}
          onValueChange={(v) => setParam("action", v)}
          disabled={pending}
        >
          <SelectTrigger className="min-w-32">
            <SelectValue placeholder="All actions" />
          </SelectTrigger>
          <SelectContent>
            {actions.map((a) => (
              <SelectItem key={a} value={a}>
                {a}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-muted-foreground text-xs font-medium">
          Actor
        </label>
        <Select
          value={params.actor || undefined}
          onValueChange={(v) => setParam("actor", v)}
          disabled={pending}
        >
          <SelectTrigger className="min-w-44">
            <SelectValue placeholder="All actors" />
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
      <div className="flex flex-col gap-1">
        <label className="text-muted-foreground text-xs font-medium">
          From
        </label>
        <Input
          type="date"
          value={params.from ?? ""}
          onChange={(e) => setParam("from", e.target.value)}
          disabled={pending}
          className="w-40"
        />
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-muted-foreground text-xs font-medium">To</label>
        <Input
          type="date"
          value={params.to ?? ""}
          onChange={(e) => setParam("to", e.target.value)}
          disabled={pending}
          className="w-40"
        />
      </div>
      {hasAny && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={clearAll}
          disabled={pending}
        >
          Clear filters
        </Button>
      )}
    </div>
  )
}

function AuditRowItem({ item }: { item: AuditLogItem }) {
  const [expanded, setExpanded] = useState(false)
  const hasDiff = item.before !== null || item.after !== null
  return (
    <li className="bg-muted/30 flex flex-col gap-2 rounded-md border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={actionBadgeVariant(item.action)} className="uppercase">
            {item.action}
          </Badge>
          <span className="text-sm font-medium">{item.entity_type}</span>
          {item.entity_id && (
            <code className="text-muted-foreground rounded bg-background px-1.5 py-0.5 text-[11px]">
              {item.entity_id}
            </code>
          )}
        </div>
        <div className="text-muted-foreground flex flex-wrap items-center gap-3 text-xs">
          <span>
            {item.actor
              ? `${item.actor.first_name} ${item.actor.last_name}`
              : "system"}
          </span>
          <span>{fmt(item.created_at)}</span>
          {hasDiff && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setExpanded((v) => !v)}
            >
              {expanded ? "Hide" : "Diff"}
            </Button>
          )}
        </div>
      </div>
      {expanded && hasDiff && (
        <div className="grid grid-cols-1 gap-3 border-t pt-3 sm:grid-cols-2">
          <div>
            <h5 className="text-muted-foreground mb-1 text-xs font-medium uppercase">
              Before
            </h5>
            <pre className="bg-background overflow-auto rounded border p-2 text-[11px] leading-snug">
              {item.before === null
                ? "—"
                : JSON.stringify(item.before, null, 2)}
            </pre>
          </div>
          <div>
            <h5 className="text-muted-foreground mb-1 text-xs font-medium uppercase">
              After
            </h5>
            <pre className="bg-background overflow-auto rounded border p-2 text-[11px] leading-snug">
              {item.after === null
                ? "—"
                : JSON.stringify(item.after, null, 2)}
            </pre>
          </div>
        </div>
      )}
    </li>
  )
}
