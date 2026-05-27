"use client"

import { useRef, useState, useTransition } from "react"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

import {
  bulkImportDailyAreaAccessCsv,
  setDailyAreaAccess,
} from "../area-access-actions"
import type { AreaRow, EmployeeLite } from "../types"

type EmployeeWithEmail = EmployeeLite & { email: string | null }

type Props = {
  employees: EmployeeWithEmail[]
  areas: Pick<AreaRow, "id" | "name" | "slug" | "color">[]
  // "employeeId:areaId" keys that currently have can_submit.
  initialGrants: string[]
}

const key = (employeeId: string, areaId: string) => `${employeeId}:${areaId}`

export function AreaAccessTab({ employees, areas, initialGrants }: Props) {
  const [grants, setGrants] = useState<Set<string>>(
    () => new Set(initialGrants),
  )
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const fileRef = useRef<HTMLInputElement>(null)

  function toggle(employeeId: string, areaId: string, next: boolean) {
    setError(null)
    setInfo(null)
    const k = key(employeeId, areaId)
    setGrants((prev) => {
      const copy = new Set(prev)
      if (next) copy.add(k)
      else copy.delete(k)
      return copy
    })
    startTransition(async () => {
      const res = await setDailyAreaAccess({ employeeId, areaId, enabled: next })
      if (!res.ok) {
        setGrants((prev) => {
          const copy = new Set(prev)
          if (next) copy.delete(k)
          else copy.add(k)
          return copy
        })
        setError(res.error)
      }
    })
  }

  function downloadTemplate() {
    const lines = ["email,area,can_submit"]
    for (const e of employees) {
      if (!e.email) continue
      for (const a of areas) {
        const has = grants.has(key(e.id, a.id))
        lines.push(`${csv(e.email)},${csv(a.slug)},${has ? "true" : "false"}`)
      }
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = "daily-area-access.csv"
    a.click()
    URL.revokeObjectURL(url)
  }

  function onUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setError(null)
    setInfo(null)
    startTransition(async () => {
      const text = await file.text()
      const res = await bulkImportDailyAreaAccessCsv(text)
      if (fileRef.current) fileRef.current.value = ""
      if (!res.ok) {
        setError(res.error)
        return
      }
      const parts = [
        `${res.granted} granted`,
        `${res.revoked} revoked`,
        `${res.skipped} skipped`,
      ]
      setInfo(
        `Import complete: ${parts.join(", ")}.` +
          (res.errors.length ? ` Issues: ${res.errors.join("; ")}` : ""),
      )
      // Reflect the committed state without a manual reload.
      window.location.reload()
    })
  }

  if (areas.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>No areas yet</CardTitle>
          <CardDescription>
            Add daily-report areas first, then grant staff submit access here.
          </CardDescription>
        </CardHeader>
      </Card>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Area Access</h2>
          <p className="text-muted-foreground text-sm">
            Check a box to let that staff member submit daily reports in that
            area. Enforced server-side; admins and super admins always have
            access.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" onClick={downloadTemplate}>
            Download CSV
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={pending}
            onClick={() => fileRef.current?.click()}
          >
            Import CSV
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={onUpload}
          />
        </div>
      </div>

      {error ? (
        <p className="text-destructive text-sm" role="alert">
          {error}
        </p>
      ) : null}
      {info ? <p className="text-muted-foreground text-sm">{info}</p> : null}

      <div className="overflow-auto rounded-md border">
        <table className="w-full border-collapse text-sm">
          <thead className="bg-muted/60 sticky top-0 z-10">
            <tr>
              <th className="border-b px-3 py-2 text-left font-medium">
                Staff
              </th>
              {areas.map((a) => (
                <th
                  key={a.id}
                  className="border-b px-3 py-2 text-center font-medium"
                >
                  <span className="inline-flex items-center gap-1.5">
                    {a.color ? (
                      <span
                        aria-hidden
                        className="inline-block size-2 rounded-full"
                        style={{ backgroundColor: a.color }}
                      />
                    ) : null}
                    {a.name}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {employees.map((emp) => (
              <tr key={emp.id} className="hover:bg-muted/30">
                <td className="border-b px-3 py-2 align-middle whitespace-nowrap">
                  {emp.first_name} {emp.last_name}
                  {emp.email ? (
                    <span className="text-muted-foreground block text-xs">
                      {emp.email}
                    </span>
                  ) : null}
                </td>
                {areas.map((a) => {
                  const checked = grants.has(key(emp.id, a.id))
                  return (
                    <td
                      key={a.id}
                      className="border-b px-3 py-2 text-center align-middle"
                    >
                      <input
                        type="checkbox"
                        className="size-4 cursor-pointer accent-primary"
                        checked={checked}
                        disabled={pending}
                        aria-label={`${emp.first_name} ${emp.last_name} — ${a.name}`}
                        onChange={(e) => toggle(emp.id, a.id, e.target.checked)}
                      />
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function csv(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}
