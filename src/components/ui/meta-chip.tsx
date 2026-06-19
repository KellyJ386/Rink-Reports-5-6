import * as React from "react"

import { cn } from "@/lib/utils"
import { MODULE_TEXT, type ModuleKey } from "@/components/ui/module-theme"

/**
 * Context chip used in the report meta row (employee / facility / date / time /
 * temperature). A Lucide icon in a small rounded chip + a value label. Pass
 * `module` to tint the icon in the module accent color.
 */
export function MetaChip({
  icon,
  module,
  children,
}: {
  icon: React.ReactNode
  module?: ModuleKey
  children: React.ReactNode
}) {
  return (
    <span className="flex items-center gap-2 text-muted-foreground">
      <span
        className={cn(
          "flex h-7 w-7 items-center justify-center rounded-full bg-muted",
          module ? MODULE_TEXT[module] : "text-muted-foreground",
        )}
      >
        {icon}
      </span>
      <span className="font-medium text-foreground">{children}</span>
    </span>
  )
}
