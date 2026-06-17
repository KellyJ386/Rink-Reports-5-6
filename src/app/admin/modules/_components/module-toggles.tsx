"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

import { Switch } from "@/components/ui/switch"
import {
  MODULE_LABELS,
  TOGGLEABLE_MODULE_KEYS,
  type ToggleableModuleKey,
} from "@/lib/modules/module-keys"

import { setFacilityModuleEnabled } from "../actions"

interface ModuleTogglesProps {
  // Current enabled state per module key (defaults handled by the page).
  enabled: Record<string, boolean>
}

export function ModuleToggles({ enabled }: ModuleTogglesProps) {
  const router = useRouter()
  const [state, setState] = React.useState<Record<string, boolean>>(enabled)
  const [pending, setPending] = React.useState<string | null>(null)

  async function toggle(key: ToggleableModuleKey, next: boolean) {
    setPending(key)
    setState((prev) => ({ ...prev, [key]: next })) // optimistic
    const res = await setFacilityModuleEnabled(key, next)
    if (!res.ok) {
      setState((prev) => ({ ...prev, [key]: !next })) // roll back
      toast.error(res.error)
    } else {
      toast.success(
        `${MODULE_LABELS[key]} ${next ? "enabled" : "disabled"} for this facility.`,
      )
      router.refresh()
    }
    setPending(null)
  }

  return (
    <ul className="divide-y divide-border">
      {TOGGLEABLE_MODULE_KEYS.map((key) => {
        const isOn = state[key] ?? true
        const labelId = `module-${key}-label`
        return (
          <li key={key} className="flex items-center justify-between gap-4 py-3">
            <span id={labelId} className="text-sm font-medium">
              {MODULE_LABELS[key]}
            </span>
            <Switch
              checked={isOn}
              disabled={pending === key}
              onCheckedChange={(next) => toggle(key, next)}
              aria-labelledby={labelId}
            />
          </li>
        )
      })}
    </ul>
  )
}
