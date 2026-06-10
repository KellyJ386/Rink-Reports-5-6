"use client"

// beforeunload guard for long report forms (P4 from the 360 review): warns
// before a tab close / hard refresh discards in-progress work. Client-side
// route changes and server-action submits don't fire beforeunload, so the
// guard never interferes with normal submission — callers just pass
// `dirty: false` once the submission has been queued/accepted anyway, for
// defense in depth.

import { useEffect } from "react"

export function useUnsavedGuard(dirty: boolean): void {
  useEffect(() => {
    if (!dirty) return
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      // Chrome requires returnValue to be set; the string itself is ignored
      // by modern browsers, which show their own generic message.
      e.returnValue = ""
    }
    window.addEventListener("beforeunload", handler)
    return () => window.removeEventListener("beforeunload", handler)
  }, [dirty])
}
