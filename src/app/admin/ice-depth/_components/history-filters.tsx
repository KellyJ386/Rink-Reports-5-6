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
        <Select
          value={params.layout || undefined}
          onValueChange={(v) => setParam("layout", v)}
          disabled={pending}
        >
          <SelectTrigger className="min-w-48">
            <SelectValue placeholder="All layouts" />
          </SelectTrigger>
          <SelectContent>
            {layouts.map((l) => (
              <SelectItem key={l.id} value={l.id}>
                {l.name}
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
          Has low reading
        </label>
        <Select
          value={params.has_low || undefined}
          onValueChange={(v) => setParam("has_low", v)}
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
          Has high reading
        </label>
        <Select
          value={params.has_high || undefined}
          onValueChange={(v) => setParam("has_high", v)}
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
