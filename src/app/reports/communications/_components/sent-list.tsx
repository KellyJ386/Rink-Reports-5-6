"use client"

import Link from "next/link"
import { useMemo, useState } from "react"

import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"

import { excerpt, formatTimestamp, relativeAge } from "./format"

export type SentListItem = {
  messageId: string
  subject: string | null
  body: string
  sent_at: string
  requires_acknowledgement: boolean
  recipientCount: number
  readCount: number
  ackCount: number
}

type Props = {
  items: SentListItem[]
  timezone: string | null
}

export function SentList({ items, timezone }: Props) {
  const [search, setSearch] = useState("")

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (q.length === 0) return items
    return items.filter((item) =>
      `${item.subject ?? ""} ${item.body}`.toLowerCase().includes(q),
    )
  }, [items, search])

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 rounded-xl border bg-card p-3">
        <Input
          type="search"
          placeholder="Search sent messages…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-11 text-base"
          aria-label="Search sent messages"
        />
      </div>

      {filtered.length === 0 ? (
        <p className="rounded-xl border bg-card px-4 py-6 text-center text-sm text-muted-foreground">
          No sent messages match your filters.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {filtered.map((item) => {
            const subject =
              item.subject && item.subject.trim().length > 0
                ? item.subject
                : excerpt(item.body, 50)
            return (
              <li key={item.messageId}>
                <Link
                  href={`/reports/communications?sent=${item.messageId}`}
                  className="flex flex-col gap-1.5 rounded-xl border bg-card px-4 py-3 transition-colors hover:bg-accent/40 focus-visible:bg-accent/40"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-base font-medium">{subject}</span>
                    <span
                      className="text-xs text-muted-foreground"
                      title={formatTimestamp(item.sent_at, timezone)}
                    >
                      {relativeAge(item.sent_at)}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="secondary">
                      {item.recipientCount} recipient
                      {item.recipientCount === 1 ? "" : "s"}
                    </Badge>
                    <Badge variant={item.readCount > 0 ? "info" : "neutral"}>
                      {item.readCount} read
                    </Badge>
                    {item.requires_acknowledgement ? (
                      <Badge
                        variant={
                          item.ackCount === item.recipientCount
                            ? "success"
                            : "warning"
                        }
                      >
                        {item.ackCount}/{item.recipientCount} acknowledged
                      </Badge>
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
