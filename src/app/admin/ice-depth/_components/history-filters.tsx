"use client"

import { useRouter, useSearchParams } from "next/navigation"
import { useTransition } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

import type { EmployeeLite, HistoryParams, LayoutRow } from "../types"

type Props = {
  layouts: LayoutRow[]
  employees: EmployeeLite[]
  params: HistoryParams
}

export function HistoryFilters({ layouts, employees, params }: Props) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [pending, startTransition] = useTransition()

  function setParam(key: string, value: string) {
    const sp = new URLSearchParams(searchParams.toString())
    if (value) sp.set(key, value)
    else sp.delete(key)
    sp.delete("session")
    startTransition(() => {
      router.replace(`?${sp.toString()}`, { scroll: false })
    })
  }
  function clearAll() {
    const sp = new URLSearchParams()
    sp.set("tab", "history")
    startTransition(() => {
      router.replace(`?${sp.toString()}`, { scroll: false })
    })
  }

  const hasAny = Boolean(
    params.layout ||
      params.employee ||
      params.has_low ||
      params.has_high ||
      params.from ||
      params.to,
  )

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="flex flex-col gap-1">
        <label className="text-muted-foreground text-xs font-medium">
          Layout
        </label>
        <select
          value={params.layout ?? ""}
          onChange={(e) => setParam("layout", e.target.value)}
          disabled={pending}
          className="border-input bg-transparent h-9 min-w-48 rounded-md border px-3 text-sm shadow-xs"
        >
          <option value="">All layouts</option>
          {layouts.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-muted-foreground text-xs font-medium">
          Employee
        </label>
        <select
          value={params.employee ?? ""}
          onChange={(e) => setParam("employee", e.target.value)}
          disabled={pending}
          className="border-input bg-transparent h-9 min-w-48 rounded-md border px-3 text-sm shadow-xs"
        >
          <option value="">All employees</option>
          {employees.map((e) => (
            <option key={e.id} value={e.id}>
              {e.last_name}, {e.first_name}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-muted-foreground text-xs font-medium">
          Has low reading
        </label>
        <select
          value={params.has_low ?? ""}
          onChange={(e) => setParam("has_low", e.target.value)}
          disabled={pending}
          className="border-input bg-transparent h-9 min-w-32 rounded-md border px-3 text-sm shadow-xs"
        >
          <option value="">Any</option>
          <option value="yes">Yes</option>
          <option value="no">No</option>
        </select>
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-muted-foreground text-xs font-medium">
          Has high reading
        </label>
        <select
          value={params.has_high ?? ""}
          onChange={(e) => setParam("has_high", e.target.value)}
          disabled={pending}
          className="border-input bg-transparent h-9 min-w-32 rounded-md border px-3 text-sm shadow-xs"
        >
          <option value="">Any</option>
          <option value="yes">Yes</option>
          <option value="no">No</option>
        </select>
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-muted-foreground text-xs font-medium">From</label>
        <Input
          type="date"
          value={params.from ?? ""}
          onChange={(e) => setParam("from", e.target.value)}
          disabled={pending}
          className="w-40"
        />
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-muted-foreground text-xs font-medium">To</label>
        <Input
          type="date"
          value={params.to ?? ""}
          onChange={(e) => setParam("to", e.target.value)}
          disabled={pending}
          className="w-40"
        />
      </div>
      {hasAny && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={clearAll}
          disabled={pending}
        >
          Clear filters
        </Button>
      )}
    </div>
  )
}
