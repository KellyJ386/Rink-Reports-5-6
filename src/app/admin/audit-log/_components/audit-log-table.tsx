"use client"

import Link from "next/link"

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
                    {new Date(entry.created_at).toLocaleString()}
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

function ActionBadge({ action }: { action: string }) {
  const colorMap: Record<string, string> = {
    create: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
    update: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
    delete: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
    login: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400",
    logout: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
  }
  const cls =
    colorMap[action] ?? "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300"
  return (
    <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium ${cls}`}>
      {ACTION_LABELS[action] ?? action}
    </span>
  )
}
