"use client"

import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { useTransition } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

import { reopenAlert, resolveAlert } from "../actions"
import type {
  AlertDetailData,
  AlertWithCounts,
  EmployeeLite,
  InboxView,
  MessageListItem,
  Severity,
} from "../types"
import { SEVERITIES, SOURCE_MODULES } from "../types"

type InboxParams = {
  inbox?: string
  alert?: string
  module?: string
  severity?: string
  resolved?: string
  q?: string
  from?: string
  to?: string
}

type Props = {
  view: InboxView
  alerts: AlertWithCounts[]
  alertDetail: AlertDetailData | null
  messages: MessageListItem[]
  params: InboxParams
}

function fmt(ts: string | null | undefined): string {
  if (!ts) return "—"
  try {
    return new Date(ts).toLocaleString()
  } catch {
    return ts
  }
}

function ageString(ts: string): string {
  try {
    const ms = Date.now() - new Date(ts).getTime()
    if (ms < 0) return "now"
    const min = Math.floor(ms / 60_000)
    if (min < 1) return "just now"
    if (min < 60) return `${min}m ago`
    const hr = Math.floor(min / 60)
    if (hr < 24) return `${hr}h ago`
    const d = Math.floor(hr / 24)
    return `${d}d ago`
  } catch {
    return ts
  }
}

function severityClass(sev: string): string {
  if (sev === "critical")
    return "bg-destructive/15 text-destructive border-destructive/30"
  if (sev === "high")
    return "bg-orange-500/15 text-orange-700 border-orange-500/30 dark:text-orange-300"
  if (sev === "warn")
    return "bg-yellow-500/15 text-yellow-700 border-yellow-500/30 dark:text-yellow-300"
  return "bg-blue-500/15 text-blue-700 border-blue-500/30 dark:text-blue-300"
}

function moduleClass(mod: string): string {
  // Stable per-module hash to a small palette for visual distinction.
  let h = 0
  for (let i = 0; i < mod.length; i += 1) h = (h * 31 + mod.charCodeAt(i)) | 0
  const palette = [
    "bg-sky-500/15 text-sky-700 border-sky-500/30 dark:text-sky-300",
    "bg-emerald-500/15 text-emerald-700 border-emerald-500/30 dark:text-emerald-300",
    "bg-violet-500/15 text-violet-700 border-violet-500/30 dark:text-violet-300",
    "bg-rose-500/15 text-rose-700 border-rose-500/30 dark:text-rose-300",
    "bg-amber-500/15 text-amber-700 border-amber-500/30 dark:text-amber-300",
    "bg-teal-500/15 text-teal-700 border-teal-500/30 dark:text-teal-300",
    "bg-indigo-500/15 text-indigo-700 border-indigo-500/30 dark:text-indigo-300",
  ]
  return palette[Math.abs(h) % palette.length] ?? palette[0]!
}

function moduleLabel(key: string): string {
  return SOURCE_MODULES.find((m) => m.key === key)?.label ?? key
}

function excerpt(s: string | null, n = 140): string {
  if (!s) return ""
  const t = s.trim()
  if (t.length <= n) return t
  return `${t.slice(0, n - 1).trim()}…`
}

function nameOf(e: EmployeeLite | null): string {
  return e ? `${e.first_name} ${e.last_name}` : "—"
}

export function InboxTab({
  view,
  alerts,
  alertDetail,
  messages,
  params,
}: Props) {
  if (view === "alerts" && alertDetail) {
    return <AlertDrilldown detail={alertDetail} params={params} />
  }
  return (
    <div className="flex flex-col gap-4">
      <ViewToggle view={view} />
      <InboxFilters view={view} params={params} />
      {view === "alerts" ? (
        <AlertsList alerts={alerts} params={params} />
      ) : (
        <MessagesList messages={messages} />
      )}
    </div>
  )
}

function buildHref(params: Record<string, string | undefined>): string {
  const sp = new URLSearchParams()
  sp.set("tab", "inbox")
  for (const [k, v] of Object.entries(params)) {
    if (v) sp.set(k, v)
  }
  return `/admin/communications?${sp.toString()}`
}

function ViewToggle({ view }: { view: InboxView }) {
  return (
    <nav className="inline-flex gap-1 rounded-md border p-1 self-start">
      <Link
        href={buildHref({ inbox: "alerts" })}
        className={cn(
          "rounded px-3 py-1 text-sm font-medium",
          view === "alerts"
            ? "bg-primary text-primary-foreground"
            : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
        )}
      >
        Alerts
      </Link>
      <Link
        href={buildHref({ inbox: "messages" })}
        className={cn(
          "rounded px-3 py-1 text-sm font-medium",
          view === "messages"
            ? "bg-primary text-primary-foreground"
            : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
        )}
      >
        Messages
      </Link>
    </nav>
  )
}

function InboxFilters({
  view,
  params,
}: {
  view: InboxView
  params: InboxParams
}) {
  const router = useRouter()
  const sp = useSearchParams()
  const [pending, startTransition] = useTransition()

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(sp.toString())
    if (value) next.set(key, value)
    else next.delete(key)
    next.delete("alert")
    startTransition(() => {
      router.replace(`?${next.toString()}`, { scroll: false })
    })
  }
  function clearAll() {
    const next = new URLSearchParams()
    next.set("tab", "inbox")
    if (view === "messages") next.set("inbox", "messages")
    startTransition(() => {
      router.replace(`?${next.toString()}`, { scroll: false })
    })
  }

  const hasAny = Boolean(
    params.module ||
      params.severity ||
      params.resolved ||
      params.q ||
      params.from ||
      params.to,
  )

  return (
    <div className="flex flex-wrap items-end gap-3">
      {view === "alerts" && (
        <>
          <div className="flex flex-col gap-1">
            <label className="text-muted-foreground text-xs font-medium">
              Source module
            </label>
            <select
              value={params.module ?? ""}
              onChange={(e) => setParam("module", e.target.value)}
              disabled={pending}
              className="border-input bg-transparent h-9 min-w-44 rounded-md border px-3 text-sm shadow-xs"
            >
              <option value="">All modules</option>
              {SOURCE_MODULES.map((m) => (
                <option key={m.key} value={m.key}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-muted-foreground text-xs font-medium">
              Severity
            </label>
            <select
              value={params.severity ?? ""}
              onChange={(e) => setParam("severity", e.target.value)}
              disabled={pending}
              className="border-input bg-transparent h-9 min-w-32 rounded-md border px-3 text-sm shadow-xs"
            >
              <option value="">Any severity</option>
              {SEVERITIES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-muted-foreground text-xs font-medium">
              Resolved
            </label>
            <select
              value={params.resolved ?? ""}
              onChange={(e) => setParam("resolved", e.target.value)}
              disabled={pending}
              className="border-input bg-transparent h-9 min-w-28 rounded-md border px-3 text-sm shadow-xs"
            >
              <option value="">Any</option>
              <option value="no">Open</option>
              <option value="yes">Resolved</option>
            </select>
          </div>
        </>
      )}
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
      <div className="flex flex-col gap-1">
        <label className="text-muted-foreground text-xs font-medium">
          Search
        </label>
        <Input
          type="search"
          placeholder={view === "alerts" ? "title or body" : "subject or body"}
          defaultValue={params.q ?? ""}
          onBlur={(e) => {
            const v = e.target.value.trim()
            if (v !== (params.q ?? "")) setParam("q", v)
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              const v = e.currentTarget.value.trim()
              if (v !== (params.q ?? "")) setParam("q", v)
            }
          }}
          disabled={pending}
          className="w-56"
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

function AlertsList({
  alerts,
  params,
}: {
  alerts: AlertWithCounts[]
  params: InboxParams
}) {
  if (alerts.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>No alerts in selected window</CardTitle>
          <CardDescription>
            Adjust the filters above to widen your search, or wait for new
            activity.
          </CardDescription>
        </CardHeader>
      </Card>
    )
  }
  return (
    <ul className="flex flex-col gap-2">
      {alerts.map((a) => (
        <li key={a.id}>
          <Link
            href={buildHref({ ...params, inbox: "alerts", alert: a.id })}
            className="hover:bg-accent/50 flex flex-col gap-2 rounded-md border p-3 transition-colors"
          >
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={cn(
                  "rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase",
                  moduleClass(a.source_module),
                )}
              >
                {moduleLabel(a.source_module)}
              </span>
              <span
                className={cn(
                  "rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase",
                  severityClass(a.severity),
                )}
              >
                {a.severity}
              </span>
              {a.resolved_at && (
                <span className="rounded-full border bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30 px-2 py-0.5 text-[10px] font-medium uppercase">
                  resolved
                </span>
              )}
              {a.requires_acknowledgement && (
                <span className="rounded-full bg-secondary text-secondary-foreground px-2 py-0.5 text-[10px] font-medium uppercase">
                  ack {a.ack_count}
                </span>
              )}
              <span className="text-muted-foreground ml-auto text-xs">
                {ageString(a.created_at)}
              </span>
            </div>
            <div className="text-sm font-semibold">{a.title}</div>
            {a.body && (
              <div className="text-muted-foreground text-sm">
                {excerpt(a.body)}
              </div>
            )}
          </Link>
        </li>
      ))}
    </ul>
  )
}

function MessagesList({ messages }: { messages: MessageListItem[] }) {
  if (messages.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>No messages in selected window</CardTitle>
          <CardDescription>
            Staff-sent messages will appear here once activity exists.
          </CardDescription>
        </CardHeader>
      </Card>
    )
  }
  return (
    <div className="overflow-auto rounded-md border">
      <table className="w-full border-collapse text-sm">
        <thead className="bg-muted/60 sticky top-0 z-10">
          <tr>
            <th className="border-b px-3 py-2 text-left font-medium">Sent</th>
            <th className="border-b px-3 py-2 text-left font-medium">Sender</th>
            <th className="border-b px-3 py-2 text-left font-medium">
              Subject
            </th>
            <th className="border-b px-3 py-2 text-left font-medium">Body</th>
            <th className="border-b px-3 py-2 text-left font-medium">
              Recipients
            </th>
            <th className="border-b px-3 py-2 text-left font-medium">Read</th>
            <th className="border-b px-3 py-2 text-left font-medium">Ack</th>
          </tr>
        </thead>
        <tbody>
          {messages.map((m) => (
            <tr key={m.id} className="hover:bg-muted/30">
              <td className="border-b px-3 py-2 align-middle">
                {fmt(m.sent_at)}
              </td>
              <td className="border-b px-3 py-2 align-middle">
                {nameOf(m.sender)}
              </td>
              <td className="border-b px-3 py-2 align-middle">
                {m.subject ?? "—"}
              </td>
              <td className="border-b px-3 py-2 align-middle">
                <span className="text-muted-foreground line-clamp-1">
                  {excerpt(m.body, 80)}
                </span>
              </td>
              <td className="border-b px-3 py-2 align-middle">
                {m.recipient_count}
              </td>
              <td className="border-b px-3 py-2 align-middle">
                {m.read_count}
              </td>
              <td className="border-b px-3 py-2 align-middle">
                {m.requires_acknowledgement ? m.ack_count : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function AlertDrilldown({
  detail,
  params,
}: {
  detail: AlertDetailData
  params: InboxParams
}) {
  const [pending, startTransition] = useTransition()
  const a = detail.alert
  const sev: Severity = (
    SEVERITIES as readonly string[]
  ).includes(a.severity)
    ? (a.severity as Severity)
    : "info"

  const backHref = buildHref({
    ...params,
    inbox: "alerts",
    alert: undefined,
  })

  function onResolve() {
    startTransition(async () => {
      const r = await resolveAlert(a.id)
      if (!r.ok) toast.error(r.error)
      else toast.success("Alert resolved.")
    })
  }
  function onReopen() {
    startTransition(async () => {
      const r = await reopenAlert(a.id)
      if (!r.ok) toast.error(r.error)
      else toast.success("Alert re-opened.")
    })
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Link
          href={backHref}
          className="text-primary text-sm font-medium hover:underline"
        >
          ← Back to alerts
        </Link>
      </div>
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={cn(
                "rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase",
                moduleClass(a.source_module),
              )}
            >
              {moduleLabel(a.source_module)}
            </span>
            <span
              className={cn(
                "rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase",
                severityClass(sev),
              )}
            >
              {sev}
            </span>
            {a.resolved_at ? (
              <span className="rounded-full border bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30 px-2 py-0.5 text-[10px] font-medium uppercase">
                resolved
              </span>
            ) : (
              <span className="rounded-full border bg-muted px-2 py-0.5 text-[10px] font-medium uppercase">
                open
              </span>
            )}
            <div className="ml-auto flex flex-wrap gap-2">
              {a.resolved_at ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onReopen}
                  disabled={pending}
                >
                  Re-open
                </Button>
              ) : (
                <Button size="sm" onClick={onResolve} disabled={pending}>
                  Resolve
                </Button>
              )}
            </div>
          </div>
          <CardTitle className="mt-3">{a.title}</CardTitle>
          <CardDescription>
            Created {fmt(a.created_at)} ({ageString(a.created_at)})
            {detail.created_by ? ` by ${nameOf(detail.created_by)}` : ""}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {a.body && (
            <p className="text-sm whitespace-pre-wrap">{a.body}</p>
          )}
          <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-muted-foreground text-xs uppercase">
                Source record
              </dt>
              <dd className="font-mono text-xs break-all">
                {a.source_record_id ?? "—"}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground text-xs uppercase">
                Area ID
              </dt>
              <dd className="font-mono text-xs break-all">
                {a.area_id ?? "—"}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground text-xs uppercase">
                Requires ack
              </dt>
              <dd>{a.requires_acknowledgement ? "Yes" : "No"}</dd>
            </div>
            {a.resolved_at && (
              <div>
                <dt className="text-muted-foreground text-xs uppercase">
                  Resolved
                </dt>
                <dd>
                  {fmt(a.resolved_at)}
                  {detail.resolved_by
                    ? ` by ${nameOf(detail.resolved_by)}`
                    : ""}
                </dd>
              </div>
            )}
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Acknowledgements ({detail.acknowledgements.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {detail.acknowledgements.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              No acknowledgements yet.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {detail.acknowledgements.map((ack) => (
                <li
                  key={ack.id}
                  className="bg-muted/30 flex flex-col gap-1 rounded-md border p-3 text-sm"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium">{nameOf(ack.employee)}</span>
                    <span className="text-muted-foreground text-xs">
                      {fmt(ack.acknowledged_at)}
                    </span>
                  </div>
                  {ack.notes && (
                    <p className="text-muted-foreground whitespace-pre-wrap">
                      {ack.notes}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
