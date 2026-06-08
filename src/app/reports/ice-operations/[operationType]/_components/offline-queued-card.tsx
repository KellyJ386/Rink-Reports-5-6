"use client"

import { Card } from "@/components/ui/card"

/**
 * Shared "Saved on this device" confirmation shown by each ice-operations form
 * after an offline submit is queued in the service worker. Mirrors the
 * air-quality offline card.
 */
export function OfflineQueuedCard() {
  return (
    <Card className="gap-4 py-8">
      <div className="flex flex-col items-center gap-4 px-6 text-center">
        <div
          aria-hidden
          className="bg-primary/10 text-primary flex h-14 w-14 items-center justify-center rounded-full"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={3}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-7 w-7"
          >
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </div>
        <h2 className="text-xl font-semibold tracking-tight">
          Saved on this device
        </h2>
        <p className="text-muted-foreground text-sm">
          You&apos;re offline, so this report is queued and will sync
          automatically once you&apos;re back online — the same checks run then.
          You can keep working.
        </p>
      </div>
    </Card>
  )
}
