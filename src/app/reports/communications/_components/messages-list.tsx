"use client"

import Link from "next/link"
import { useMemo, useState } from "react"

import { Badge } from "@/components/ui/badge"

import { excerpt, formatTimestamp, relativeAge } from "./format"

export type MessageListItem = {
  messageId: string
  subject: string | null
  body: string
  sent_at: string
  requires_acknowledgement: boolean
  read_at: string | null
  acknowledged_at: string | null
  senderName: string | null
}

type Props = {
  items: MessageListItem[]
  timezone: string | null
}

export function MessagesList({ items, timezone }: Props) {
  const [search, setSearch] = useState("")
  const [unreadOnly, setUnreadOnly] = useState(false)

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return items.filter((item) => {
      if (unreadOnly && item.read_at !== null) return false
      if (q.length > 0) {
        const hay =
          `${item.subject ?? ""} ${item.body} ${item.senderName ?? ""}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [items, search, unreadOnly])

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 rounded-xl border bg-card p-3">
        <input
          type="search"
          placeholder="Search messages…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="border-input bg-background focus-visible:ring-ring/50 focus-visible:border-ring h-11 w-full rounded-md border px-3 text-base shadow-xs outline-none focus-visible:ring-[3px]"
          aria-label="Search messages"
        />
        <label className="inline-flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={unreadOnly}
            onChange={(e) => setUnreadOnly(e.target.checked)}
            className="h-4 w-4 rounded border-input"
          />
          Unread only
        </label>
      </div>

      {filtered.length === 0 ? (
        <p className="rounded-xl border bg-card px-4 py-6 text-center text-sm text-muted-foreground">
          No messages match your filters.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {filtered.map((item) => {
            const unread = item.read_at === null
            const subject =
              item.subject && item.subject.trim().length > 0
                ? item.subject
                : excerpt(item.body, 50)
            return (
              <li key={item.messageId}>
                <Link
                  href={`/reports/communications?message=${item.messageId}`}
                  className={`flex flex-col gap-1.5 rounded-xl border bg-card px-4 py-3 transition-colors hover:bg-accent/40 focus-visible:bg-accent/40 ${
                    unread ? "border-primary/40" : ""
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-sm text-muted-foreground">
                      {item.senderName ?? "Unknown sender"}
                    </span>
                    <span
                      className="text-xs text-muted-foreground"
                      title={formatTimestamp(item.sent_at, timezone)}
                    >
                      {relativeAge(item.sent_at)}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`text-base ${
                        unread ? "font-semibold" : "font-medium"
                      }`}
                    >
                      {subject}
                    </span>
                    {unread ? (
                      <>
                        <span
                          className="inline-flex h-2 w-2 rounded-full bg-primary"
                          aria-hidden="true"
                        />
                        <span className="sr-only">Unread</span>
                      </>
                    ) : null}
                    {item.requires_acknowledgement &&
                    item.acknowledged_at === null ? (
                      <Badge variant="outline">Ack required</Badge>
                    ) : null}
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {excerpt(item.body, 140)}
                  </p>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
