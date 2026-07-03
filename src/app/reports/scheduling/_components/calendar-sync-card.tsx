"use client"

import { useState, useTransition } from "react"
import { CalendarPlus, Check, Copy, RefreshCw } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"

import { getOrCreateIcsToken, rotateIcsToken } from "../actions"

/**
 * Staff calendar sync: surfaces the personal ICS subscription URL
 * (/api/schedule-ics/<token>). The token is owner-only; "Reset link"
 * rotates it, invalidating any previously shared URL.
 */
export function CalendarSyncCard({
  initialToken,
  feedBase,
}: {
  initialToken: string | null
  /** Absolute origin + path prefix, e.g. "https://app.example.com/api/schedule-ics". */
  feedBase: string
}) {
  const [token, setToken] = useState<string | null>(initialToken)
  const [copied, setCopied] = useState(false)
  const [pending, startTransition] = useTransition()

  const url = token ? `${feedBase}/${token}` : null

  function enable() {
    startTransition(async () => {
      const r = await getOrCreateIcsToken()
      if (r.ok) setToken(r.token)
      else toast.error(r.error)
    })
  }

  function reset() {
    startTransition(async () => {
      const r = await rotateIcsToken()
      if (r.ok) {
        setToken(r.token)
        setCopied(false)
        toast.success("Calendar link reset — old links no longer work.")
      } else {
        toast.error(r.error)
      }
    })
  }

  async function copy() {
    if (!url) return
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      toast.success("Link copied — paste it into your calendar app.")
      setTimeout(() => setCopied(false), 2500)
    } catch {
      toast.error("Couldn't copy — select the link text instead.")
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-[14px] border border-border bg-card px-4 py-[14px]">
      <div className="flex items-center gap-2">
        <CalendarPlus className="h-4 w-4 text-primary" aria-hidden />
        <h2 className="text-sm font-bold uppercase tracking-wide">
          Calendar sync
        </h2>
      </div>
      {url ? (
        <>
          <p className="text-muted-foreground text-xs">
            Subscribe in Google or Apple Calendar and your published shifts
            appear automatically (updates within a few hours). Anyone with
            this link can see your shifts — reset it if shared by mistake.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-md border border-border bg-background px-2 py-1.5 text-xs">
              {url}
            </code>
            <Button type="button" size="sm" onClick={copy} disabled={pending}>
              {copied ? (
                <Check className="h-3.5 w-3.5" aria-hidden />
              ) : (
                <Copy className="h-3.5 w-3.5" aria-hidden />
              )}
              {copied ? "Copied" : "Copy link"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={reset}
              disabled={pending}
            >
              <RefreshCw className="h-3.5 w-3.5" aria-hidden />
              Reset link
            </Button>
          </div>
        </>
      ) : (
        <>
          <p className="text-muted-foreground text-xs">
            Get your published shifts in Google or Apple Calendar with a
            personal subscription link.
          </p>
          <Button
            type="button"
            size="sm"
            className="w-fit"
            onClick={enable}
            disabled={pending}
          >
            <CalendarPlus className="h-3.5 w-3.5" aria-hidden />
            {pending ? "Setting up…" : "Turn on calendar sync"}
          </Button>
        </>
      )}
    </div>
  )
}
