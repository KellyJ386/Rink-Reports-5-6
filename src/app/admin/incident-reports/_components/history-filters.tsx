"use client"

import { useRouter, useSearchParams } from "next/navigation"
import { useTransition } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

import type { EmployeeLite, IncidentTypeRow, SeverityRow } from "../types"
import { STATUSES } from "../types"

type HistoryParams = {
  status?: string
  type?: string
  severity?: string
  employee?: string
  location?: string
  from?: string
  to?: string
}

type Props = {
  types: Array<Pick<IncidentTypeRow, "id" | "name" | "color" | "slug">>
  severities: Array<Pick<SeverityRow, "id" | "key" | "display_name" | "color">>
  employees: EmployeeLite[]
  params: HistoryParams
}

export function HistoryFilters({
  types,
  severities,
  employees,
  params,
}: Props) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [pending, startTransition] = useTransition()

  function setParam(key: string, value: string) {
    const sp = new URLSearchParams(searchParams.toString())
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
    params.status ||
      params.type ||
      params.severity ||
      params.employee ||
      params.location ||
      params.from ||
      params.to,
  )

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="flex flex-col gap-1">
        <label className="text-muted-foreground text-xs font-medium">
          Status
        </label>
        <select
          value={params.status ?? ""}
          onChange={(e) => setParam("status", e.target.value)}
          disabled={pending}
          className="border-input bg-transparent h-9 min-w-36 rounded-md border px-3 text-sm shadow-xs"
        >
          <option value="">All statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s.charAt(0).toUpperCase() + s.slice(1)}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-muted-foreground text-xs font-medium">
          Type
        </label>
        <select
          value={params.type ?? ""}
          onChange={(e) => setParam("type", e.target.value)}
          disabled={pending}
          className="border-input bg-transparent h-9 min-w-44 rounded-md border px-3 text-sm shadow-xs"
        >
          <option value="">All types</option>
          {types.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
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
          className="border-input bg-transparent h-9 min-w-40 rounded-md border px-3 text-sm shadow-xs"
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
          Location prefix
        </label>
        <Input
          type="search"
          placeholder="e.g. Rink A"
          defaultValue={params.location ?? ""}
          onBlur={(e) => {
            const v = e.target.value.trim()
            if (v !== (params.location ?? "")) setParam("location", v)
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              const v = e.currentTarget.value.trim()
              if (v !== (params.location ?? "")) setParam("location", v)
            }
          }}
          disabled={pending}
          className="w-44"
        />
      </div>
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
