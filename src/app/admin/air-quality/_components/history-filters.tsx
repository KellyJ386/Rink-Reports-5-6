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

import type {
  EmployeeLite,
  EquipmentRow,
  LocationRow,
  ReadingTypeRow,
} from "../types"

type HistoryParams = {
  employee?: string
  location?: string
  equipment?: string
  reading_type?: string
  exceedance?: string
  from?: string
  to?: string
  q?: string
}

type Props = {
  employees: EmployeeLite[]
  locations: LocationRow[]
  equipment: EquipmentRow[]
  readingTypes: ReadingTypeRow[]
  params: HistoryParams
}

export function HistoryFilters({
  employees,
  locations,
  equipment,
  readingTypes,
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
    params.employee ||
      params.location ||
      params.equipment ||
      params.reading_type ||
      params.exceedance ||
      params.from ||
      params.to ||
      params.q,
  )

  return (
    <div className="flex flex-wrap items-end gap-3">
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
              {l.name}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-muted-foreground text-xs font-medium">
          Equipment
        </label>
        <select
          value={params.equipment ?? ""}
          onChange={(e) => setParam("equipment", e.target.value)}
          disabled={pending}
          className="border-input bg-transparent h-9 min-w-40 rounded-md border px-3 text-sm shadow-xs"
        >
          <option value="">Any equipment</option>
          {equipment.map((eq) => (
            <option key={eq.id} value={eq.id}>
              {eq.name}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-muted-foreground text-xs font-medium">
          Reading type
        </label>
        <select
          value={params.reading_type ?? ""}
          onChange={(e) => setParam("reading_type", e.target.value)}
          disabled={pending}
          className="border-input bg-transparent h-9 min-w-40 rounded-md border px-3 text-sm shadow-xs"
        >
          <option value="">Any</option>
          {readingTypes.map((rt) => (
            <option key={rt.id} value={rt.id}>
              {rt.label}
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
          className="border-input bg-transparent h-9 min-w-40 rounded-md border px-3 text-sm shadow-xs"
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
          Exceedance
        </label>
        <select
          value={params.exceedance ?? ""}
          onChange={(e) => setParam("exceedance", e.target.value)}
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
          Search notes
        </label>
        <Input
          type="search"
          placeholder="text in notes"
          defaultValue={params.q ?? ""}
          onBlur={(e) => {
            const v = e.target.value.trim()
            if (v !== (params.q ?? "")) setParam("q", v)
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              const v = e.currentTarget.value.trim()
              if (v !== (params.q ?? "")) setParam("q", v)
            }
          }}
          disabled={pending}
          className="w-48"
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
