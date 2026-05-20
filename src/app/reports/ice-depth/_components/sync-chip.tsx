"use client"

import { useSyncQueue } from "@/lib/offline/use-sync-queue"

export function SyncChip() {
  const { pendingCount, isOnline } = useSyncQueue()

  const showOffline = !isOnline || pendingCount > 0
  const label = !isOnline
    ? pendingCount > 0
      ? `${pendingCount} queued · offline`
      : "Synced · offline"
    : pendingCount > 0
      ? `${pendingCount} queued`
      : "Synced"

  const dotColor = showOffline ? "#FFB800" : "#4DFF00"
  const bg = showOffline ? "rgba(255,184,0,0.15)" : "rgba(77,255,0,0.15)"
  const border = showOffline ? "rgba(255,184,0,0.4)" : "rgba(77,255,0,0.4)"
  const fg = showOffline ? "#CC9300" : "#3DB800"

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "6px 10px",
        borderRadius: 9999,
        background: bg,
        border: `1px solid ${border}`,
        color: fg,
        fontSize: 10,
        fontWeight: 800,
        letterSpacing: "0.06em",
        textTransform: "uppercase",
        whiteSpace: "nowrap",
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: 9999,
          background: dotColor,
          boxShadow: showOffline ? "none" : `0 0 0 3px rgba(77,255,0,0.3)`,
        }}
      />
      {label}
    </span>
  )
}
