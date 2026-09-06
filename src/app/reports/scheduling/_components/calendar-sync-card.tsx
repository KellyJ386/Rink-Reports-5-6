"use client"

import { useState, useTransition } from "react"
import { CalendarPlus, Check, Copy, RefreshCw } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"

import { createIcsToken, rotateIcsToken } from "../actions"

/**
 * Staff calendar sync: surfaces the personal ICS subscription URL
 * (/api/schedule-ics/<token>). Only the token's SHA-256 is stored (migration
 * 278), so the URL is shown ONCE — right after "Turn on" or "Reset link" —
 * and lives only in this component's state until the page unloads. A lost
 * URL is recovered by resetting, which also invalidates the old link.
 */
export function CalendarSyncCard({
  hasToken,
  feedBase,
}: {
  /** Whether a feed already exists for this employee (its URL is not readable). */
  hasToken: boolean
  /** Absolute origin + path prefix, e.g. "https://app.example.com/api/schedule-ics". */
  feedBase: string
}) {
  const [exists, setExists] = useState(hasToken)
  // Plaintext token from the action that just minted it; never re-fetched.
  const [freshToken, setFreshToken] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [pending, startTransition] = useTransition()

  const url = freshToken ? `${feedBase}/${freshToken}` : null

  function enable() {
    startTransition(async () => {
      const r = await createIcsToken()
      if (r.ok) {
        setExists(true)
        setFreshToken(r.token)
      } else {
        toast.error(r.error)
      }
    })
  }

  function reset() {
    startTransition(async () => {
      const r = await rotateIcsToken()
      if (r.ok) {
        setExists(true)
        setFreshToken(r.token)
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
            Copy this link into Google or Apple Calendar and your published
            shifts appear automatically (updates within a few hours).{" "}
            <span className="font-semibold text-foreground">
              Save it now — for your security it won&apos;t be shown again.
            </span>{" "}
            Anyone with the link can see your shifts; reset it if shared by
            mistake.
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
      ) : exists ? (
        <>
          <p className="text-muted-foreground text-xs">
            Calendar sync is on. Your subscription link isn&apos;t stored where
            it can be read back — if you&apos;ve lost it, reset it to get a new
            one (old links stop working).
          </p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="w-fit"
            onClick={reset}
            disabled={pending}
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden />
            {pending ? "Resetting…" : "Reset link"}
          </Button>
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
