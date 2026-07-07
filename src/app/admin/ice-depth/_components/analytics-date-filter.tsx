"use client"

import { useRouter, useSearchParams } from "next/navigation"
import { useTransition } from "react"

import { Input } from "@/components/ui/input"

type Props = {
  from: string
  to: string | null
}

/**
 * From/To controls for the analytics window. Without these the loader's
 * default 30-day range was permanently in effect — the params flowed through
 * the layout chips but nothing in the UI could change them.
 */
export function AnalyticsDateFilter({ from, to }: Props) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [pending, startTransition] = useTransition()

  function setParam(key: string, value: string) {
    const sp = new URLSearchParams(searchParams.toString())
    if (value) sp.set(key, value)
    else sp.delete(key)
    sp.set("tab", "analytics")
    startTransition(() => {
      router.replace(`?${sp.toString()}`, { scroll: false })
    })
  }

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="flex flex-col gap-1">
        <label className="text-muted-foreground text-xs font-medium">
          From
        </label>
        <Input
          type="date"
          value={from}
          onChange={(e) => setParam("from", e.target.value)}
          disabled={pending}
          className="w-40"
        />
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-muted-foreground text-xs font-medium">To</label>
        <Input
          type="date"
          value={to ?? ""}
          onChange={(e) => setParam("to", e.target.value)}
          disabled={pending}
          className="w-40"
        />
      </div>
    </div>
  )
}
