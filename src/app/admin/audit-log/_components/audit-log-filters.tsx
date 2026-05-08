"use client"

import { useRouter, usePathname, useSearchParams } from "next/navigation"
import { useCallback } from "react"

import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

import type { EmployeeLite } from "../types"
import { ACTION_LABELS, ENTITY_TYPE_LABELS } from "../types"

interface Props {
  employees: EmployeeLite[]
  params: {
    action?: string
    entity_type?: string
    actor?: string
    from?: string
    to?: string
    q?: string
  }
}

export function AuditLogFilters({ employees, params }: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const update = useCallback(
    (key: string, value: string) => {
      const sp = new URLSearchParams(searchParams.toString())
      if (value) {
        sp.set(key, value)
      } else {
        sp.delete(key)
      }
      sp.delete("entry")
      router.push(`${pathname}?${sp.toString()}`)
    },
    [router, pathname, searchParams],
  )

  return (
    <div className="flex flex-wrap gap-3">
      <div className="flex flex-col gap-1 min-w-[160px]">
        <Label className="text-xs text-muted-foreground">Action</Label>
        <select
          className="rounded-md border bg-background px-2 py-1.5 text-sm"
          value={params.action ?? ""}
          onChange={(e) => update("action", e.target.value)}
        >
          <option value="">All actions</option>
          {Object.entries(ACTION_LABELS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1 min-w-[180px]">
        <Label className="text-xs text-muted-foreground">Entity type</Label>
        <select
          className="rounded-md border bg-background px-2 py-1.5 text-sm"
          value={params.entity_type ?? ""}
          onChange={(e) => update("entity_type", e.target.value)}
        >
          <option value="">All types</option>
          {Object.entries(ENTITY_TYPE_LABELS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1 min-w-[180px]">
        <Label className="text-xs text-muted-foreground">Actor</Label>
        <select
          className="rounded-md border bg-background px-2 py-1.5 text-sm"
          value={params.actor ?? ""}
          onChange={(e) => update("actor", e.target.value)}
        >
          <option value="">All actors</option>
          {employees.map((e) => (
            <option key={e.id} value={e.id}>
              {e.last_name}, {e.first_name}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1 min-w-[130px]">
        <Label className="text-xs text-muted-foreground">From</Label>
        <Input
          type="date"
          className="h-8 text-sm"
          value={params.from ?? ""}
          onChange={(e) => update("from", e.target.value)}
        />
      </div>

      <div className="flex flex-col gap-1 min-w-[130px]">
        <Label className="text-xs text-muted-foreground">To</Label>
        <Input
          type="date"
          className="h-8 text-sm"
          value={params.to ?? ""}
          onChange={(e) => update("to", e.target.value)}
        />
      </div>

      <div className="flex flex-col gap-1 min-w-[200px]">
        <Label className="text-xs text-muted-foreground">Search IP / entity ID</Label>
        <Input
          type="search"
          placeholder="IP address or UUID…"
          className="h-8 text-sm"
          value={params.q ?? ""}
          onChange={(e) => update("q", e.target.value)}
        />
      </div>
    </div>
  )
}
