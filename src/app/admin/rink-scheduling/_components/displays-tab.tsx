"use client"

import { useState, useTransition } from "react"
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

import { createDisplayToken, deleteDisplayToken, revokeDisplayToken } from "../actions"
import type { CreatedToken, DisplayTokenRow } from "../types"

/** The page deliberately does not select token_hash, so the client never
 *  receives it — not even hashed. `lastSeenLabel` is computed on the SERVER:
 *  deriving it here would both break React's purity rule and disagree with the
 *  server-rendered markup whenever the two clocks differ. */
export type DisplayTokenView = Omit<DisplayTokenRow, "token_hash"> & {
  lastSeenLabel: string
}

type Props = {
  tokens: DisplayTokenView[]
  defaultRefreshSeconds: number
}

function readSetting(settings: unknown, key: string, fallback: number): number {
  if (settings && typeof settings === "object" && !Array.isArray(settings)) {
    const v = (settings as Record<string, unknown>)[key]
    if (typeof v === "number" && Number.isFinite(v)) return v
  }
  return fallback
}

export function DisplaysTab({ tokens, defaultRefreshSeconds }: Props) {
  const [created, setCreated] = useState<CreatedToken | null>(null)

  return (
    <div className="flex flex-col gap-6">
      {created && <RevealCard token={created} onDismiss={() => setCreated(null)} />}

      <Card>
        <CardHeader>
          <CardTitle>Lobby displays ({tokens.length})</CardTitle>
          <CardDescription>
            Each display gets its own web address showing the locker room
            schedule. Point any browser at it — a smart TV, a streaming stick, or
            a mini PC. There is no app to install and nobody signs in on the
            device.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {tokens.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              No displays yet.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {tokens.map((t) => (
                <TokenRowItem key={t.id} token={t} />
              ))}
            </ul>
          )}
          <CreateForm
            defaultRefreshSeconds={defaultRefreshSeconds}
            onCreated={setCreated}
          />
        </CardContent>
      </Card>
    </div>
  )
}

/**
 * The address is shown here and nowhere else, ever. Only a hash of the token
 * reaches the database, so it genuinely cannot be looked up again — if it is
 * lost, the fix is to revoke this display and add another.
 */
function RevealCard({
  token,
  onDismiss,
}: {
  token: CreatedToken
  onDismiss: () => void
}) {
  const fullUrl =
    typeof window === "undefined" ? token.url : `${window.location.origin}${token.url}`

  async function onCopy() {
    try {
      await navigator.clipboard.writeText(fullUrl)
      toast.success("Address copied.")
    } catch {
      toast.error("Could not copy. Select the address and copy it manually.")
    }
  }

  return (
    <Card className="border-warning/40 bg-warning/10">
      <CardHeader>
        <CardTitle>Copy this address now</CardTitle>
        <CardDescription>
          This is the only time it will be shown. Only a hashed form is stored,
          so it cannot be retrieved later. If you lose it, revoke this display
          and create another.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <code className="bg-background min-w-0 flex-1 overflow-x-auto rounded-md border p-2 font-mono text-xs">
            {fullUrl}
          </code>
          <Button onClick={onCopy}>Copy</Button>
          <Button variant="outline" onClick={onDismiss}>
            Done
          </Button>
        </div>
        <p className="text-muted-foreground text-xs">
          Anyone with this address can see the locker room schedule for{" "}
          {token.label}. It shows times, room names and whatever label you chose
          — never contact details, rates or notes.
        </p>
      </CardContent>
    </Card>
  )
}

function TokenRowItem({ token }: { token: DisplayTokenView }) {
  const [revokePending, startRevoke] = useTransition()
  const [delPending, startDel] = useTransition()

  const revoked = !token.is_active || token.revoked_at !== null
  const hoursAhead = readSetting(token.settings, "hours_ahead", 12)
  const refresh = readSetting(token.settings, "refresh_seconds", 60)

  function onRevoke() {
    if (!confirm(`Revoke "${token.label}"? Its address stops working immediately.`)) {
      return
    }
    startRevoke(async () => {
      const r = await revokeDisplayToken(token.id)
      if (!r.ok) toast.error(r.error)
      else toast.success("Display revoked.")
    })
  }

  function onDelete() {
    if (!confirm(`Delete "${token.label}"?`)) return
    startDel(async () => {
      const r = await deleteDisplayToken(token.id)
      if (!r.ok) toast.error(r.error)
      else toast.success("Display deleted.")
    })
  }

  return (
    <li className="bg-muted/30 flex flex-wrap items-center justify-between gap-2 rounded-md border p-3">
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{token.label}</span>
          {revoked && (
            <Badge variant="secondary" className="uppercase">
              revoked
            </Badge>
          )}
        </div>
        <span className="text-muted-foreground font-mono text-xs">
          next {hoursAhead}h · refresh {refresh}s · {token.lastSeenLabel}
        </span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {!revoked && (
          <Button
            variant="outline"
            size="sm"
            onClick={onRevoke}
            disabled={revokePending}
          >
            Revoke
          </Button>
        )}
        <Button
          variant="destructive"
          size="sm"
          onClick={onDelete}
          disabled={delPending}
        >
          Delete
        </Button>
      </div>
    </li>
  )
}

function CreateForm({
  defaultRefreshSeconds,
  onCreated,
}: {
  defaultRefreshSeconds: number
  onCreated: (t: CreatedToken) => void
}) {
  const [pending, startTransition] = useTransition()
  const [label, setLabel] = useState("")
  const [hoursAhead, setHoursAhead] = useState("12")
  const [refresh, setRefresh] = useState(String(defaultRefreshSeconds))

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    startTransition(async () => {
      const r = await createDisplayToken(
        label,
        Number(hoursAhead),
        Number(refresh),
      )
      if (!r.ok) {
        toast.error(r.error)
        return
      }
      onCreated(r.token)
      setLabel("")
      toast.success("Display created.")
    })
  }

  return (
    <form
      onSubmit={onSubmit}
      className="flex flex-wrap items-end gap-3 rounded-md border p-3"
    >
      <div className="flex flex-col gap-1">
        <Label htmlFor="tok-label">Label</Label>
        <Input
          id="tok-label"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Lobby TV"
          required
        />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="tok-hours">Hours ahead</Label>
        <Input
          id="tok-hours"
          type="number"
          min={1}
          max={48}
          value={hoursAhead}
          onChange={(e) => setHoursAhead(e.target.value)}
          className="w-24"
        />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="tok-refresh">Refresh (s)</Label>
        <Input
          id="tok-refresh"
          type="number"
          min={15}
          max={3600}
          value={refresh}
          onChange={(e) => setRefresh(e.target.value)}
          className="w-24"
        />
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? "Creating…" : "Add display"}
      </Button>
    </form>
  )
}
