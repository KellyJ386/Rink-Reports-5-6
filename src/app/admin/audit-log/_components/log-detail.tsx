"use client"

import { useState } from "react"
import Link from "next/link"

import { Badge } from "@/components/ui/badge"
import type { BadgeProps } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { LocalDateTime } from "@/components/app/local-datetime"

import type { AuditLogEntry } from "../types"
import { ACTION_LABELS, ENTITY_TYPE_LABELS } from "../types"

interface Props {
  entry: AuditLogEntry
  backHref: string
}

function JsonBlock({ label, data }: { label: string; data: unknown }) {
  const [expanded, setExpanded] = useState(true)
  if (data === null || data === undefined) return null
  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors text-left"
      >
        <span>{expanded ? "▾" : "▸"}</span>
        {label}
      </button>
      {expanded && (
        <pre className="rounded-md border bg-muted/50 p-3 text-xs overflow-auto max-h-64 whitespace-pre-wrap break-all">
          {JSON.stringify(data, null, 2)}
        </pre>
      )}
    </div>
  )
}

export function LogDetail({ entry, backHref }: Props) {
  const actorName = entry.actor_employee
    ? `${entry.actor_employee.first_name} ${entry.actor_employee.last_name}`
    : entry.actor_user_id
      ? `User ${entry.actor_user_id.slice(0, 8)}…`
      : "System"

  const actionLabel = ACTION_LABELS[entry.action] ?? entry.action
  const entityLabel =
    ENTITY_TYPE_LABELS[entry.entity_type] ?? entry.entity_type

  return (
    <div className="flex flex-col gap-4">
      <Button asChild variant="outline" size="sm" className="w-fit">
        <Link href={backHref}>← Back to log</Link>
      </Button>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {actionLabel} · {entityLabel}
          </CardTitle>
          <CardDescription>
<LocalDateTime iso={entry.created_at} /> · {actorName}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 text-sm">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
            <dt className="text-muted-foreground font-medium">Action</dt>
            <dd>
              <ActionBadge action={entry.action} />
            </dd>
            <dt className="text-muted-foreground font-medium">Entity type</dt>
            <dd>{entityLabel}</dd>
            {entry.entity_id && (
              <>
                <dt className="text-muted-foreground font-medium">Entity ID</dt>
                <dd className="font-mono text-xs break-all">{entry.entity_id}</dd>
              </>
            )}
            <dt className="text-muted-foreground font-medium">Actor</dt>
            <dd>{actorName}</dd>
            {entry.ip != null && (
              <>
                <dt className="text-muted-foreground font-medium">IP address</dt>
                <dd className="font-mono text-xs">{String(entry.ip)}</dd>
              </>
            )}
            {entry.user_agent && (
              <>
                <dt className="text-muted-foreground font-medium">User agent</dt>
                <dd className="text-xs text-muted-foreground truncate max-w-[40ch]" title={entry.user_agent}>
                  {entry.user_agent}
                </dd>
              </>
            )}
          </dl>

          <div className="flex flex-col gap-3 pt-1">
            <JsonBlock label="Before" data={entry.before} />
            <JsonBlock label="After" data={entry.after} />
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

function actionBadgeVariant(action: string): BadgeProps["variant"] {
  if (action === "create") return "success"
  if (action === "update") return "info"
  if (action === "delete") return "error"
  if (action === "login") return "default"
  return "secondary"
}

function ActionBadge({ action }: { action: string }) {
  return (
    <Badge variant={actionBadgeVariant(action)}>
      {ACTION_LABELS[action] ?? action}
    </Badge>
  )
}
