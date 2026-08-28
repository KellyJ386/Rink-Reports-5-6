"use client"

import { useState, useTransition } from "react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { EmptyState } from "@/components/ui/empty-state"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

import { approveRequest, archiveRequest, declineRequest } from "../../request-actions"

export type NewRequestView = {
  id: string
  requesterName: string
  requesterEmail: string
  requesterPhone: string | null
  organization: string | null
  dateLong: string
  timeLabel: string
  /** The rink the requester asked for, if any. */
  rinkId: string | null
  rinkName: string | null
  purpose: string | null
  receivedAt: string
}

export type DecidedRequestView = {
  id: string
  requesterName: string
  organization: string | null
  status: "approved" | "declined"
  dateLong: string
  timeLabel: string
  rinkName: string | null
  decidedAt: string
  decisionNote: string | null
}

type Props = {
  inbox: NewRequestView[]
  decided: DecidedRequestView[]
  rinks: Array<{ id: string; name: string }>
}

export function RequestInbox({ inbox, decided, rinks }: Props) {
  return (
    <div className="flex flex-col gap-6">
      {inbox.length === 0 ? (
        <EmptyState
          title="No new requests"
          description="Requests submitted through the facility's public ice-request form land here for a decision."
        />
      ) : (
        <div className="flex flex-col gap-4">
          {inbox.map((r) => (
            <RequestCard key={r.id} request={r} rinks={rinks} />
          ))}
        </div>
      )}

      {decided.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold tracking-tight">Decided recently</h2>
          <div className="overflow-hidden rounded-xl border">
            <ul className="divide-border divide-y">
              {decided.map((r) => (
                <DecidedRow key={r.id} request={r} />
              ))}
            </ul>
          </div>
        </section>
      )}
    </div>
  )
}

function RequestCard({
  request,
  rinks,
}: {
  request: NewRequestView
  rinks: Array<{ id: string; name: string }>
}) {
  const [rinkId, setRinkId] = useState(request.rinkId ?? "")
  const [note, setNote] = useState("")
  const [pending, startTransition] = useTransition()

  function onApprove() {
    if (!rinkId) {
      toast.error("Pick a rink to book this request onto.")
      return
    }
    startTransition(async () => {
      const r = await approveRequest(request.id, rinkId, note.trim() || null)
      if (!r.ok) {
        toast.error(r.error)
        return
      }
      toast.success("Approved — a tentative booking is on the calendar.")
    })
  }

  function onDecline() {
    startTransition(async () => {
      const r = await declineRequest(request.id, note.trim() || null)
      if (!r.ok) {
        toast.error(r.error)
        return
      }
      toast.success("Request declined.")
    })
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-4 py-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="font-semibold">
              {request.requesterName}
              {request.organization ? (
                <span className="text-muted-foreground font-normal">
                  {" "}
                  · {request.organization}
                </span>
              ) : null}
            </p>
            <p className="text-muted-foreground text-sm">
              {request.requesterEmail}
              {request.requesterPhone ? ` · ${request.requesterPhone}` : ""}
            </p>
          </div>
          <span className="text-muted-foreground text-xs">
            Received {request.receivedAt}
          </span>
        </div>

        <div className="rounded-lg border p-3">
          <p className="text-sm font-medium">{request.dateLong}</p>
          <p className="text-muted-foreground text-sm">
            {request.timeLabel} · {request.rinkName ?? "Any rink"}
          </p>
        </div>

        {request.purpose ? (
          <p className="text-sm whitespace-pre-wrap">{request.purpose}</p>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <Label htmlFor={`req-rink-${request.id}`}>Rink to book</Label>
            <select
              id={`req-rink-${request.id}`}
              value={rinkId}
              onChange={(e) => setRinkId(e.target.value)}
              className="border-input bg-background h-10 rounded-md border px-2 text-sm"
            >
              <option value="">Select a rink…</option>
              {rinks.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor={`req-note-${request.id}`}>Decision note (optional)</Label>
            <Input
              id={`req-note-${request.id}`}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Kept internally with the decision"
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={onApprove} disabled={pending || !rinkId}>
            {pending ? "Working…" : "Approve as tentative booking"}
          </Button>
          <Button variant="outline" onClick={onDecline} disabled={pending}>
            Decline
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

function DecidedRow({ request }: { request: DecidedRequestView }) {
  const [pending, startTransition] = useTransition()

  function onArchive() {
    startTransition(async () => {
      const r = await archiveRequest(request.id)
      if (!r.ok) {
        toast.error(r.error)
        return
      }
      toast.success("Request archived.")
    })
  }

  return (
    <li className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
      <div className="min-w-0">
        <p className="text-sm">
          <Badge variant={request.status === "approved" ? "success" : "neutral"}>
            {request.status}
          </Badge>{" "}
          <span className="font-medium">
            {request.organization ?? request.requesterName}
          </span>{" "}
          <span className="text-muted-foreground">
            — {request.dateLong}, {request.timeLabel}
            {request.rinkName ? ` · ${request.rinkName}` : ""}
          </span>
        </p>
        {request.decisionNote ? (
          <p className="text-muted-foreground text-xs">{request.decisionNote}</p>
        ) : null}
      </div>
      <div className="flex items-center gap-3">
        <span className="text-muted-foreground text-xs">{request.decidedAt}</span>
        <Button size="sm" variant="ghost" onClick={onArchive} disabled={pending}>
          Archive
        </Button>
      </div>
    </li>
  )
}
