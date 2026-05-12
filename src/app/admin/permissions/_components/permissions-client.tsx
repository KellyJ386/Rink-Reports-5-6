"use client"

import { useMemo, useState } from "react"

import { Input } from "@/components/ui/input"

import type { Employee, ModulePermissionMap } from "../types"
import { PermissionsTable } from "./permissions-table"

type Props = {
  employees: Employee[]
  permissions: ModulePermissionMap
}

export function PermissionsClient({ employees, permissions }: Props) {
  const [query, setQuery] = useState("")

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return employees
    return employees.filter((e) => {
      const haystack = [
        e.full_name,
        e.email ?? "",
        e.role_display_name ?? "",
        e.role_key ?? "",
        ...e.departments,
      ]
        .join(" ")
        .toLowerCase()
      return haystack.includes(q)
    })
  }, [employees, query])

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <Input
          placeholder="Search by name, email, role, department..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="max-w-sm"
        />
        <span className="text-muted-foreground text-sm">
          {filtered.length} of {employees.length}
        </span>
      </div>

      <PermissionsTable
        employees={filtered}
        allEmployees={employees}
        permissions={permissions}
      />
    </div>
  )
}
