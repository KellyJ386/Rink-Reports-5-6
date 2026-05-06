"use client"

import { useRouter, useSearchParams } from "next/navigation"
import { useTransition } from "react"

import { Input } from "@/components/ui/input"

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
        <select
          value={selectedAreaId ?? ""}
          onChange={(e) => setParam("area", e.target.value)}
          disabled={pending}
          className="border-input bg-transparent h-9 min-w-48 rounded-md border px-3 text-sm shadow-xs"
        >
          <option value="">All areas</option>
          {areas.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-muted-foreground text-xs font-medium">
          Employee
        </label>
        <select
          value={selectedEmployeeId ?? ""}
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
