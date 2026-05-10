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
import { cn } from "@/lib/utils"

import type {
  EmployeeLite,
  EquipmentRow,
  OperationType,
  RinkRow,
} from "../types"
import { OPERATION_TYPES } from "../types"

type HistoryParams = {
  employee?: string
  rink?: string
  equipment?: string
  op?: OperationType[]
  failed?: string
  from?: string
  to?: string
  q?: string
}

type Props = {
  employees: EmployeeLite[]
  rinks: RinkRow[]
  equipment: EquipmentRow[]
  params: HistoryParams
}

export function HistoryFilters({ employees, rinks, equipment, params }: Props) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [pending, startTransition] = useTransition()

  function setParam(key: string, value: string) {
    const sp = new URLSearchParams(searchParams.toString())
    if (value) sp.set(key, value)
    else sp.delete(key)
    sp.delete("submission")
    startTransition(() => {
      router.replace(`?${sp.toString()}`, { scroll: false })
    })
  }
  function toggleOp(op: OperationType) {
    const sp = new URLSearchParams(searchParams.toString())
    const current = sp.getAll("op")
    sp.delete("op")
    sp.delete("submission")
    const next = current.includes(op)
      ? current.filter((c) => c !== op)
      : [...current, op]
    for (const v of next) sp.append("op", v)
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

  const selectedOps = new Set(params.op ?? [])
  const hasAny = Boolean(
    params.employee ||
      params.rink ||
      params.equipment ||
      (params.op && params.op.length > 0) ||
      params.failed ||
      params.q,
  )

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-muted-foreground text-xs font-medium">
          Operation type:
        </span>
        {OPERATION_TYPES.map((t) => {
          const on = selectedOps.has(t.key)
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => toggleOp(t.key)}
              disabled={pending}
              className={cn(
                "rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors",
                on
                  ? "bg-primary text-primary-foreground border-primary"
                  : "border-input text-muted-foreground hover:bg-accent hover:text-accent-foreground",
              )}
            >
              {t.label}
            </button>
          )
        })}
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-muted-foreground text-xs font-medium">
            Employee
          </label>
          <Select
            value={params.employee || undefined}
            onValueChange={(v) => setParam("employee", v)}
            disabled={pending}
          >
            <SelectTrigger className="min-w-44">
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
            Rink
          </label>
          <Select
            value={params.rink || undefined}
            onValueChange={(v) => setParam("rink", v)}
            disabled={pending}
          >
            <SelectTrigger className="min-w-40">
              <SelectValue placeholder="All rinks" />
            </SelectTrigger>
            <SelectContent>
              {rinks.map((r) => (
                <SelectItem key={r.id} value={r.id}>
                  {r.name}
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
            <SelectTrigger className="min-w-44">
              <SelectValue placeholder="All equipment" />
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
            Failed check
          </label>
          <Select
            value={params.failed || undefined}
            onValueChange={(v) => setParam("failed", v)}
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
    </div>
  )
}
