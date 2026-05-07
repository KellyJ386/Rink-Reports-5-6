"use client"

import { useRouter, useSearchParams } from "next/navigation"
import { useTransition } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

import type { DropdownLite, EmployeeLite } from "../types"

type HistoryParams = {
  from?: string
  to?: string
  employee?: string
  severity?: string
  body_part?: string
  location?: string
  activity?: string
  medical_attention?: string
  wc?: string
}

type Props = {
  employees: EmployeeLite[]
  severities: DropdownLite[]
  bodyParts: DropdownLite[]
  locations: DropdownLite[]
  activities: DropdownLite[]
  medicals: DropdownLite[]
  params: HistoryParams
}

export function HistoryFilters({
  employees,
  severities,
  bodyParts,
  locations,
  activities,
  medicals,
  params,
}: Props) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [pending, startTransition] = useTransition()

  function setParam(key: string, value: string) {
    const sp = new URLSearchParams(searchParams.toString())
    if (!sp.has("tab")) sp.set("tab", "history")
    if (value) sp.set(key, value)
    else sp.delete(key)
    sp.delete("report")
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
    params.employee ||
      params.severity ||
      params.body_part ||
      params.location ||
      params.activity ||
      params.medical_attention ||
      params.wc ||
      params.from ||
      params.to,
  )

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="flex flex-col gap-1">
        <label className="text-muted-foreground text-xs font-medium">
          From
        </label>
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
          Severity
        </label>
        <select
          value={params.severity ?? ""}
          onChange={(e) => setParam("severity", e.target.value)}
          disabled={pending}
          className="border-input bg-transparent h-9 min-w-36 rounded-md border px-3 text-sm shadow-xs"
        >
          <option value="">All severities</option>
          {severities.map((s) => (
            <option key={s.id} value={s.id}>
              {s.display_name}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-muted-foreground text-xs font-medium">
          Body part
        </label>
        <select
          value={params.body_part ?? ""}
          onChange={(e) => setParam("body_part", e.target.value)}
          disabled={pending}
          className="border-input bg-transparent h-9 min-w-40 rounded-md border px-3 text-sm shadow-xs"
        >
          <option value="">All body parts</option>
          {bodyParts.map((b) => (
            <option key={b.id} value={b.id}>
              {b.display_name}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-muted-foreground text-xs font-medium">
          Location
        </label>
        <select
          value={params.location ?? ""}
          onChange={(e) => setParam("location", e.target.value)}
          disabled={pending}
          className="border-input bg-transparent h-9 min-w-40 rounded-md border px-3 text-sm shadow-xs"
        >
          <option value="">All locations</option>
          {locations.map((l) => (
            <option key={l.id} value={l.id}>
              {l.display_name}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-muted-foreground text-xs font-medium">
          Activity
        </label>
        <select
          value={params.activity ?? ""}
          onChange={(e) => setParam("activity", e.target.value)}
          disabled={pending}
          className="border-input bg-transparent h-9 min-w-40 rounded-md border px-3 text-sm shadow-xs"
        >
          <option value="">All activities</option>
          {activities.map((a) => (
            <option key={a.id} value={a.id}>
              {a.display_name}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-muted-foreground text-xs font-medium">
          Medical
        </label>
        <select
          value={params.medical_attention ?? ""}
          onChange={(e) => setParam("medical_attention", e.target.value)}
          disabled={pending}
          className="border-input bg-transparent h-9 min-w-40 rounded-md border px-3 text-sm shadow-xs"
        >
          <option value="">Any</option>
          {medicals.map((m) => (
            <option key={m.id} value={m.id}>
              {m.display_name}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-muted-foreground text-xs font-medium">
          Workers&apos; Comp
        </label>
        <select
          value={params.wc ?? ""}
          onChange={(e) => setParam("wc", e.target.value)}
          disabled={pending}
          className="border-input bg-transparent h-9 min-w-32 rounded-md border px-3 text-sm shadow-xs"
        >
          <option value="">Any</option>
          <option value="yes">Yes</option>
          <option value="no">No</option>
        </select>
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
