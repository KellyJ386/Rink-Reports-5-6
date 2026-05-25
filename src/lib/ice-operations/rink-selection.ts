"use client"

import { useCallback, useSyncExternalStore } from "react"

const STORAGE_KEY = "rink-reports:ice-ops:selected-rink"

type RinkByFacility = Record<string, string>

let store: RinkByFacility = readInitial()
const listeners = new Set<() => void>()

function readInitial(): RinkByFacility {
  if (typeof window === "undefined") return {}
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    return parsed && typeof parsed === "object"
      ? (parsed as RinkByFacility)
      : {}
  } catch {
    return {}
  }
}

function persist() {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store))
  } catch {
    // Quota or disabled-storage: keep the selection in memory for the session.
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function setRink(facilityId: string, rinkId: string) {
  if (store[facilityId] === rinkId) return
  store = { ...store, [facilityId]: rinkId }
  persist()
  for (const listener of listeners) listener()
}

/**
 * Browser-only, persisted selection of the active rink, scoped per facility.
 * Shared so the Ice Operations rink dropdown and each submission form's rink
 * field stay in sync and the choice survives navigation between operation tabs.
 */
export function useSelectedRink(
  facilityId: string,
): readonly [string, (rinkId: string) => void] {
  const selectedRinkId = useSyncExternalStore(
    subscribe,
    () => store[facilityId] ?? "",
    () => "",
  )
  const setSelectedRinkId = useCallback(
    (rinkId: string) => setRink(facilityId, rinkId),
    [facilityId],
  )
  return [selectedRinkId, setSelectedRinkId] as const
}
