"use client"

import { useState, useTransition } from "react"
import { Send, Check, Loader2 } from "lucide-react"

import { sendIceDepthReport } from "../../../actions"

const DISPLAY_FONT =
  "var(--font-anton), Anton, Impact, 'Arial Narrow', sans-serif"

type Status =
  | { kind: "idle" }
  | { kind: "sent"; count: number }
  | { kind: "error"; message: string }

export function SendReportButton({ sessionId }: { sessionId: string }) {
  const [status, setStatus] = useState<Status>({ kind: "idle" })
  const [pending, startTransition] = useTransition()

  const sent = status.kind === "sent"

  const handleSend = () => {
    if (pending || sent) return
    startTransition(async () => {
      const result = await sendIceDepthReport(sessionId)
      if (result.ok) {
        setStatus({ kind: "sent", count: result.count })
      } else {
        setStatus({ kind: "error", message: result.error })
      }
    })
  }

  const label = sent
    ? status.count === 1
      ? "Sent to 1 recipient"
      : `Sent to ${status.count} recipients`
    : pending
      ? "Sending…"
      : "Send Report"

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <button
        type="button"
        onClick={handleSend}
        disabled={pending || sent}
        aria-live="polite"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
          width: "100%",
          minHeight: 52,
          borderRadius: 10,
          border: "none",
          background: sent
            ? "var(--muted)"
            : "linear-gradient(180deg, #7AFF40 0%, #4DFF00 100%)",
          color: sent ? "var(--muted-foreground)" : "#051200",
          fontFamily: DISPLAY_FONT,
          fontSize: 18,
          fontWeight: 900,
          textTransform: "uppercase",
          letterSpacing: "0.02em",
          cursor: pending || sent ? "default" : "pointer",
          boxShadow: sent
            ? "none"
            : "0 2px 0 0 #2E9900, 0 4px 12px rgba(77,255,0,0.25)",
        }}
      >
        {sent ? (
          <Check size={18} strokeWidth={3} aria-hidden />
        ) : pending ? (
          <Loader2 size={18} className="animate-spin" aria-hidden />
        ) : (
          <Send size={18} strokeWidth={2.5} aria-hidden />
        )}
        {label}
      </button>
      {status.kind === "sent" && status.count === 0 ? (
        <p
          style={{
            fontSize: 12,
            color: "var(--muted-foreground)",
            textAlign: "center",
            margin: 0,
          }}
        >
          No recipients are configured for ice depth. Set up a send list in
          Admin → Communications.
        </p>
      ) : null}
      {status.kind === "error" ? (
        <p
          style={{
            fontSize: 12,
            color: "#F42A2A",
            textAlign: "center",
            margin: 0,
          }}
        >
          {status.message}
        </p>
      ) : null}
    </div>
  )
}
