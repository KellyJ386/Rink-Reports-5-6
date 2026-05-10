"use client"

import { useRouter, usePathname, useSearchParams } from "next/navigation"
import { useCallback } from "react"

import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

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
        <Select
          value={params.action || undefined}
          onValueChange={(v) => update("action", v)}
        >
          <SelectTrigger>
            <SelectValue placeholder="All actions" />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(ACTION_LABELS).map(([k, v]) => (
              <SelectItem key={k} value={k}>
                {v}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-1 min-w-[180px]">
        <Label className="text-xs text-muted-foreground">Entity type</Label>
        <Select
          value={params.entity_type || undefined}
          onValueChange={(v) => update("entity_type", v)}
        >
          <SelectTrigger>
            <SelectValue placeholder="All types" />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(ENTITY_TYPE_LABELS).map(([k, v]) => (
              <SelectItem key={k} value={k}>
                {v}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-1 min-w-[180px]">
        <Label className="text-xs text-muted-foreground">Actor</Label>
        <Select
          value={params.actor || undefined}
          onValueChange={(v) => update("actor", v)}
        >
          <SelectTrigger>
            <SelectValue placeholder="All actors" />
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
