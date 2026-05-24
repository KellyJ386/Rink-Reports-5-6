"use client"

import { Check, Minus } from "lucide-react"

import {
  MODULE_LABELS,
  MODULE_NAMES,
  USER_ACTIONS,
  USER_ACTION_LABELS,
  type PermissionMatrix,
} from "@/lib/permissions"
import { cn } from "@/lib/utils"

type Props = {
  matrix: PermissionMatrix | null
}

/**
 * Read-only preview of a role's default permission matrix. Driven entirely by
 * the selected role — this is the "permissions are a function of role" surface.
 * Per-user fine-tuning (manual overrides) happens on the permissions page after
 * the employee has a linked login.
 */
export function RolePermissionPreview({ matrix }: Props) {
  if (!matrix) {
    return (
      <p className="text-muted-foreground text-xs">
        Select a role to preview the permissions it grants.
      </p>
    )
  }

  return (
    <div className="overflow-hidden rounded-md border">
      <table className="w-full border-collapse text-xs">
        <thead className="bg-muted/60">
          <tr>
            <th className="px-2 py-1.5 text-left font-medium">Module</th>
            {USER_ACTIONS.map((a) => (
              <th key={a} className="px-2 py-1.5 text-center font-medium">
                {USER_ACTION_LABELS[a]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {MODULE_NAMES.map((m) => {
            const granted = USER_ACTIONS.some((a) => matrix[m][a])
            return (
              <tr key={m} className={cn(!granted && "opacity-50")}>
                <td className="border-t px-2 py-1.5 text-left">
                  {MODULE_LABELS[m]}
                </td>
                {USER_ACTIONS.map((a) => (
                  <td key={a} className="border-t px-2 py-1.5 text-center">
                    {matrix[m][a] ? (
                      <Check
                        aria-label="granted"
                        className="text-primary mx-auto size-3.5"
                      />
                    ) : (
                      <Minus
                        aria-label="not granted"
                        className="text-muted-foreground/40 mx-auto size-3.5"
                      />
                    )}
                  </td>
                ))}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
