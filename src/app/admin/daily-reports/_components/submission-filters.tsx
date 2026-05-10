"use client"

import { useRouter, useSearchParams } from "next/navigation"
import { useTransition } from "react"

import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

import type { AreaRow, EmployeeLite } from "../types"

type Props = {
  areas: AreaRow[]
  employees: EmployeeLite[]
  selectedAreaId: string | null
  selectedEmployeeId: string | null
  from: string | null
  to: string | null
}

export function SubmissionFilters({
  areas,
  employees,
  selectedAreaId,
  selectedEmployeeId,
  from,
  to,
}: Props) {
  const router = useRouter()
  const params = useSearchParams()
  const [pending, startTransition] = useTransition()

  function setParam(key: string, value: string) {
    const sp = new URLSearchParams(params.toString())
    if (value) sp.set(key, value)
    else sp.delete(key)
    sp.delete("submission")
    startTransition(() => {
      router.replace(`?${sp.toString()}`, { scroll: false })
    })
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="flex flex-col gap-1">
        <label className="text-muted-foreground text-xs font-medium">
          Area
        </label>
        <Select
          value={selectedAreaId || undefined}
          onValueChange={(v) => setParam("area", v)}
          disabled={pending}
        >
          <SelectTrigger className="min-w-48">
            <SelectValue placeholder="All areas" />
          </SelectTrigger>
          <SelectContent>
            {areas.map((a) => (
              <SelectItem key={a.id} value={a.id}>
                {a.name}
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
          value={selectedEmployeeId || undefined}
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
          From
        </label>
        <Input
          type="date"
          value={from ?? ""}
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
