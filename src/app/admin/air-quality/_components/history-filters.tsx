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
        <Select
          value={params.location || undefined}
          onValueChange={(v) => setParam("location", v)}
          disabled={pending}
        >
          <SelectTrigger className="min-w-40">
            <SelectValue placeholder="All locations" />
          </SelectTrigger>
          <SelectContent>
            {locations.map((l) => (
              <SelectItem key={l.id} value={l.id}>
                {l.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-muted-foreground text-xs font-medium">
          Equipment
        </label>
        <Select
          value={params.equipment || undefined}
          onValueChange={(v) => setParam("equipment", v)}
          disabled={pending}
        >
          <SelectTrigger className="min-w-40">
            <SelectValue placeholder="Any equipment" />
          </SelectTrigger>
          <SelectContent>
            {equipment.map((eq) => (
              <SelectItem key={eq.id} value={eq.id}>
                {eq.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-muted-foreground text-xs font-medium">
          Reading type
        </label>
        <Select
          value={params.reading_type || undefined}
          onValueChange={(v) => setParam("reading_type", v)}
          disabled={pending}
        >
          <SelectTrigger className="min-w-40">
            <SelectValue placeholder="Any" />
          </SelectTrigger>
          <SelectContent>
            {readingTypes.map((rt) => (
              <SelectItem key={rt.id} value={rt.id}>
                {rt.label}
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
          <SelectTrigger className="min-w-40">
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
          Exceedance
        </label>
        <Select
          value={params.exceedance || undefined}
          onValueChange={(v) => setParam("exceedance", v)}
          disabled={pending}
        >
          <SelectTrigger className="min-w-32">
            <SelectValue placeholder="Any" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="yes">Yes</SelectItem>
            <SelectItem value="no">No</SelectItem>
          </SelectContent>
        </Select>
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
