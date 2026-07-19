"use client"

import Link from "next/link"

import { Badge } from "@/components/ui/badge"
import type { BadgeProps } from "@/components/ui/badge"
import { LocalDateTime } from "@/components/app/local-datetime"

import type { AuditLogEntry } from "../types"
import { ACTION_LABELS, ENTITY_TYPE_LABELS } from "../types"

interface Props {
  entries: AuditLogEntry[]
  activeEntryId: string | null
  buildDetailHref: (id: string) => string
}

export function AuditLogTable({ entries, activeEntryId, buildDetailHref }: Props) {
  if (entries.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        No audit log entries match the current filters.
      </p>
    )
  }

  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full text-sm">
        <thead className="border-b bg-muted/50">
          <tr>
            <th className="px-3 py-2 text-left font-medium text-muted-foreground">When</th>
            <th className="px-3 py-2 text-left font-medium text-muted-foreground">Actor</th>
            <th className="px-3 py-2 text-left font-medium text-muted-foreground">Action</th>
            <th className="px-3 py-2 text-left font-medium text-muted-foreground">Entity type</th>
            <th className="px-3 py-2 text-left font-medium text-muted-foreground">Entity ID</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => {
            const isActive = entry.id === activeEntryId
            const actorName = entry.actor_employee
              ? `${entry.actor_employee.first_name} ${entry.actor_employee.last_name}`
              : entry.actor_user_id
                ? `User ${entry.actor_user_id.slice(0, 8)}…`
                : "System"
            return (
              <tr
                key={entry.id}
                className={`border-b last:border-0 transition-colors hover:bg-muted/40 ${isActive ? "bg-accent" : ""}`}
              >
                <td className="px-3 py-2 whitespace-nowrap">
                  <Link
                    href={buildDetailHref(entry.id)}
                    className="text-primary underline-offset-2 hover:underline"
                  >
                    <LocalDateTime iso={entry.created_at} />
                  </Link>
                </td>
                <td className="px-3 py-2 whitespace-nowrap">{actorName}</td>
                <td className="px-3 py-2 whitespace-nowrap">
                  <ActionBadge action={entry.action} />
                </td>
                <td className="px-3 py-2 whitespace-nowrap">
                  {ENTITY_TYPE_LABELS[entry.entity_type] ?? entry.entity_type}
                </td>
                <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                  {entry.entity_id ? entry.entity_id.slice(0, 8) + "…" : "—"}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
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
