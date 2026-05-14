"use client"

import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useTransition } from "react"

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

type Facility = {
  id: string
  name: string
  slug: string
  is_active: boolean
}

/**
 * Super-admin facility picker. Writes the chosen facility id to the
 * `?facility=` query param on the current page so every facility-scoped
 * admin page (employees, roles, permissions, dashboard) follows along.
 */
export function FacilitySwitcher({
  facilities,
  activeFacilityId,
}: {
  facilities: Facility[]
  activeFacilityId: string | null
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [pending, startTransition] = useTransition()

  function onChange(nextId: string) {
    const params = new URLSearchParams(searchParams.toString())
    params.set("facility", nextId)
    startTransition(() => {
      router.push(`${pathname}?${params.toString()}`)
      router.refresh()
    })
  }

  return (
    <Select
      value={activeFacilityId ?? undefined}
      onValueChange={onChange}
      disabled={pending}
    >
      <SelectTrigger className="w-[220px]">
        <SelectValue placeholder="Select a facility" />
      </SelectTrigger>
      <SelectContent>
        {facilities.map((f) => (
          <SelectItem key={f.id} value={f.id}>
            {f.name}
            {!f.is_active ? " (inactive)" : ""}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
