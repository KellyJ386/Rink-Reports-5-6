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
          Severity
        </label>
        <Select
          value={params.severity || undefined}
          onValueChange={(v) => setParam("severity", v)}
          disabled={pending}
        >
          <SelectTrigger className="min-w-36">
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
          Body part
        </label>
        <Select
          value={params.body_part || undefined}
          onValueChange={(v) => setParam("body_part", v)}
          disabled={pending}
        >
          <SelectTrigger className="min-w-40">
            <SelectValue placeholder="All body parts" />
          </SelectTrigger>
          <SelectContent>
            {bodyParts.map((b) => (
              <SelectItem key={b.id} value={b.id}>
                {b.display_name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
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
                {l.display_name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-muted-foreground text-xs font-medium">
          Activity
        </label>
        <Select
          value={params.activity || undefined}
          onValueChange={(v) => setParam("activity", v)}
          disabled={pending}
        >
          <SelectTrigger className="min-w-40">
            <SelectValue placeholder="All activities" />
          </SelectTrigger>
          <SelectContent>
            {activities.map((a) => (
              <SelectItem key={a.id} value={a.id}>
                {a.display_name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-muted-foreground text-xs font-medium">
          Medical
        </label>
        <Select
          value={params.medical_attention || undefined}
          onValueChange={(v) => setParam("medical_attention", v)}
          disabled={pending}
        >
          <SelectTrigger className="min-w-40">
            <SelectValue placeholder="Any" />
          </SelectTrigger>
          <SelectContent>
            {medicals.map((m) => (
              <SelectItem key={m.id} value={m.id}>
                {m.display_name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-muted-foreground text-xs font-medium">
          Workers&apos; Comp
        </label>
        <Select
          value={params.wc || undefined}
          onValueChange={(v) => setParam("wc", v)}
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
