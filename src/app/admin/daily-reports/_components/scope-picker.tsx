"use client"

import { useRouter, useSearchParams } from "next/navigation"
import { useTransition } from "react"

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

type Option = { id: string; label: string }

type Props = {
  paramKey: "area" | "template"
  value: string | null
  options: Option[]
  placeholder: string
  /** Other params to clear when this changes (e.g. clear template when area changes) */
  clearKeys?: Array<"area" | "template" | "submission">
}

/**
 * Native <select> that updates a single search param. Server components below
 * read the URL and re-render. Cheap and works without a portal.
 */
export function ScopePicker({
  paramKey,
  value,
  options,
  placeholder,
  clearKeys,
}: Props) {
  const router = useRouter()
  const params = useSearchParams()
  const [pending, startTransition] = useTransition()

  function onChange(next: string) {
    const sp = new URLSearchParams(params.toString())
    if (next) sp.set(paramKey, next)
    else sp.delete(paramKey)
    if (clearKeys) {
      for (const k of clearKeys) sp.delete(k)
    }
    startTransition(() => {
      router.replace(`?${sp.toString()}`, { scroll: false })
    })
  }

  return (
    <Select
      value={value || undefined}
      onValueChange={(v) => onChange(v)}
      disabled={pending || options.length === 0}
    >
      <SelectTrigger className="min-w-56">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.id} value={o.id}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
