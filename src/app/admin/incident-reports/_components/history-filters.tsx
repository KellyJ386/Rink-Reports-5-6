"use client"

import { useRouter, useSearchParams } from "next/navigation"
import { useTransition } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

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
        <Select
          value={params.status || undefined}
          onValueChange={(v) => setParam("status", v)}
          disabled={pending}
        >
          <SelectTrigger className="min-w-36">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            {STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {s.charAt(0).toUpperCase() + s.slice(1)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-muted-foreground text-xs font-medium">
          Type
        </label>
        <Select
          value={params.type || undefined}
          onValueChange={(v) => setParam("type", v)}
          disabled={pending}
        >
          <SelectTrigger className="min-w-44">
            <SelectValue placeholder="All types" />
          </SelectTrigger>
          <SelectContent>
            {types.map((t) => (
              <SelectItem key={t.id} value={t.id}>
                {t.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-muted-foreground text-xs font-medium">
          Severity
        </label>
        <Select
          value={params.severity || undefined}
          onValueChange={(v) => setParam("severity", v)}
          disabled={pending}
        >
          <SelectTrigger className="min-w-40">
            <SelectValue placeholder="All severities" />
          </SelectTrigger>
          <SelectContent>
            {severities.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.display_name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-muted-foreground text-xs font-medium">
          Employee
        </label>
        <Select
          value={params.employee || undefined}
          onValueChange={(v) => setParam("employee", v)}
          disabled={pending}
        >
          <SelectTrigger className="min-w-48">
            <SelectValue placeholder="All employees" />
          </SelectTrigger>
          <SelectContent>
            {employees.map((e) => (
              <SelectItem key={e.id} value={e.id}>
                {e.last_name}, {e.first_name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
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
