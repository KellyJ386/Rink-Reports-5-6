"use client"

import { useCallback, useEffect, useRef, useState } from "react"

import type { DisplayBoard, DisplayRoom, DisplaySlot } from "@/lib/rink-scheduling/locker-display"

// ---------------------------------------------------------------------------
// The board itself. Runs unattended on a TV for weeks, which drives every
// decision here:
//
//   - Polls rather than streams. A dropped socket on a TV browser is invisible
//     to everyone; a failed poll simply retries on the next tick.
//   - Keeps the last good board on screen when a poll fails, with a small
//     "reconnecting" marker. A blank screen reads as a broken TV; stale-by-a-
//     minute reads as a working one, and the times are printed so a passer-by
//     can see for themselves.
//   - Sizes with vw/clamp so one component serves a 32" lobby screen and a
//     phone held up at the front desk.
//   - No interactivity at all: nothing here is clickable, because nobody is
//     holding a mouse.
// ---------------------------------------------------------------------------

type BoardPayload = DisplayBoard & {
  label: string
  refreshSeconds: number
  timeZone: string | null
}

const NAVY = "#002244"
const NAVY_CARD = "#00305e"
const LIME = "#4DFF00"

type Status = "loading" | "ok" | "stale" | "gone"

export function DisplayBoardClient({ token }: { token: string }) {
  const [board, setBoard] = useState<BoardPayload | null>(null)
  const [status, setStatus] = useState<Status>("loading")
  // Held in a ref, not state: changing the interval must not re-render the
  // board, and the effect below reads it without depending on it.
  const refreshRef = useRef(60)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/display/${encodeURIComponent(token)}`, {
        cache: "no-store",
      })
      if (res.status === 404) {
        setStatus("gone")
        return
      }
      if (!res.ok) {
        // 429 and 503 are both transient; keep whatever is on screen.
        setStatus((s) => (s === "loading" ? "loading" : "stale"))
        return
      }
      const payload = (await res.json()) as BoardPayload
      refreshRef.current = Math.max(15, Math.min(3600, payload.refreshSeconds || 60))
      setBoard(payload)
      setStatus("ok")
    } catch {
      setStatus((s) => (s === "loading" ? "loading" : "stale"))
    }
  }, [token])

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined

    const tick = async () => {
      await load()
      if (cancelled) return
      // Chained timeout rather than setInterval: the next poll is scheduled
      // only after the previous one settles, so a slow network cannot stack
      // requests on a TV that has been running for a month.
      timer = setTimeout(tick, refreshRef.current * 1000)
    }
    void tick()

    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [load])

  if (status === "gone") {
    return (
      <Shell>
        <div style={{ textAlign: "center", maxWidth: "44rem" }}>
          <h1 style={{ ...headlineStyle, fontSize: "clamp(2rem, 5vw, 4rem)" }}>
            Display not found
          </h1>
          <p style={{ ...monoStyle, marginTop: "1.5rem", fontSize: "clamp(1rem, 1.6vw, 1.4rem)" }}>
            This display link is no longer active. Ask a manager for a new one from
            Admin → Rink Scheduling → Displays.
          </p>
        </div>
      </Shell>
    )
  }

  if (!board) {
    return (
      <Shell>
        <p style={{ ...monoStyle, fontSize: "clamp(1rem, 2vw, 1.6rem)", opacity: 0.7 }}>
          Loading locker rooms…
        </p>
      </Shell>
    )
  }

  return (
    <Shell>
      <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: "clamp(1rem, 2vh, 2rem)" }}>
        <header
          style={{
            display: "flex",
            alignItems: "baseline",
            justifyContent: "space-between",
            gap: "1rem",
            flexWrap: "wrap",
            borderBottom: `2px solid ${LIME}`,
            paddingBottom: "clamp(0.5rem, 1.2vh, 1rem)",
          }}
        >
          <h1 style={{ ...headlineStyle, fontSize: "clamp(1.75rem, 4vw, 3.5rem)" }}>
            Locker Rooms
          </h1>
          <p style={{ ...monoStyle, fontSize: "clamp(0.8rem, 1.4vw, 1.25rem)", opacity: 0.75 }}>
            {board.label}
            {status === "stale" ? " · reconnecting…" : ""}
          </p>
        </header>

        {board.rooms.length === 0 ? (
          <p style={{ ...monoStyle, fontSize: "clamp(1rem, 2vw, 1.5rem)", opacity: 0.7 }}>
            No locker rooms are set up yet.
          </p>
        ) : (
          <div
            style={{
              display: "grid",
              gap: "clamp(0.75rem, 1.5vw, 1.5rem)",
              gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 20rem), 1fr))",
            }}
          >
            {board.rooms.map((room) => (
              <RoomCard key={room.lockerRoomId} room={room} />
            ))}
          </div>
        )}
      </div>
    </Shell>
  )
}

function RoomCard({ room }: { room: DisplayRoom }) {
  const occupied = room.now !== null
  return (
    <section
      style={{
        background: NAVY_CARD,
        borderRadius: "1rem",
        // The lime edge is the "in use" signal, readable from across a lobby.
        border: `2px solid ${occupied ? LIME : "rgba(255,255,255,0.18)"}`,
        padding: "clamp(0.9rem, 1.6vw, 1.5rem)",
        display: "flex",
        flexDirection: "column",
        gap: "0.75rem",
        minHeight: "clamp(9rem, 20vh, 14rem)",
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "0.5rem" }}>
        <h2 style={{ ...headlineStyle, fontSize: "clamp(1.2rem, 2.2vw, 2rem)" }}>{room.name}</h2>
        <span
          style={{
            ...monoStyle,
            fontSize: "clamp(0.7rem, 1vw, 0.95rem)",
            letterSpacing: "0.08em",
            color: occupied ? LIME : "rgba(255,255,255,0.55)",
          }}
        >
          {room.shortCode}
        </span>
      </div>

      {room.now ? (
        <SlotLine slot={room.now} emphasis />
      ) : (
        <p
          style={{
            ...monoStyle,
            fontSize: "clamp(1rem, 1.8vw, 1.5rem)",
            color: "rgba(255,255,255,0.5)",
          }}
        >
          Open
        </p>
      )}

      {room.next.length > 0 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem", marginTop: "auto" }}>
          <span
            style={{
              ...monoStyle,
              fontSize: "clamp(0.65rem, 0.9vw, 0.85rem)",
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              opacity: 0.55,
            }}
          >
            Next
          </span>
          {room.next.map((slot) => (
            <SlotLine key={slot.assignmentId} slot={slot} />
          ))}
        </div>
      ) : null}
    </section>
  )
}

function SlotLine({ slot, emphasis = false }: { slot: DisplaySlot; emphasis?: boolean }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.15rem" }}>
      <span
        style={{
          ...headlineStyle,
          fontSize: emphasis ? "clamp(1.3rem, 2.6vw, 2.4rem)" : "clamp(0.95rem, 1.4vw, 1.25rem)",
          color: emphasis ? LIME : "#ffffff",
          lineHeight: 1.15,
        }}
      >
        {slot.label}
      </span>
      <span
        style={{
          ...monoStyle,
          fontSize: emphasis ? "clamp(0.85rem, 1.3vw, 1.15rem)" : "clamp(0.7rem, 1vw, 0.95rem)",
          opacity: emphasis ? 0.9 : 0.65,
        }}
      >
        {slot.fromLabel} – {slot.untilLabel}
        {slot.rinkName ? ` · ${slot.rinkName}` : ""}
        {slot.state === "upcoming" && slot.startsInMinutes <= 60
          ? ` · in ${slot.startsInMinutes} min`
          : ""}
      </span>
    </div>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main
      style={{
        minHeight: "100dvh",
        background: NAVY,
        color: "#ffffff",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        padding: "clamp(1rem, 3vw, 3rem)",
      }}
    >
      {children}
    </main>
  )
}

const headlineStyle: React.CSSProperties = {
  fontFamily: '"Space Grotesk", system-ui, sans-serif',
  fontWeight: 700,
  margin: 0,
  letterSpacing: "-0.01em",
}

const monoStyle: React.CSSProperties = {
  fontFamily: '"Space Mono", ui-monospace, monospace',
  fontWeight: 400,
  margin: 0,
}
