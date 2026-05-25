"use client"

import { useRouter } from "next/navigation"

import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useSelectedRink } from "@/lib/ice-operations/rink-selection"

import {
  OPERATION_LABELS,
  OPERATION_TYPES,
  type OperationType,
} from "../../types"
import type { RinkOption } from "./shared"

type Props = {
  activeOperation: OperationType | null
  facilityId?: string | null
  rinks?: RinkOption[]
}

export function IceOperationsControls({
  activeOperation,
  facilityId,
  rinks,
}: Props) {
  const router = useRouter()

  return (
    <div className="flex flex-col gap-3 border-b border-border pb-4 sm:flex-row sm:items-end sm:gap-4">
      {facilityId ? (
        <RinkPicker facilityId={facilityId} rinks={rinks ?? []} />
      ) : null}

      <div className="flex flex-col gap-2 sm:w-56">
        <Label htmlFor="ice-ops-module">Module</Label>
        <Select
          value={activeOperation ?? undefined}
          onValueChange={(value) =>
            router.push(`/reports/ice-operations/${value}`)
          }
        >
          <SelectTrigger id="ice-ops-module">
            <SelectValue placeholder="Select a module" />
          </SelectTrigger>
          <SelectContent>
            {OPERATION_TYPES.map((op) => (
              <SelectItem key={op} value={op}>
                {OPERATION_LABELS[op]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  )
}

function RinkPicker({
  facilityId,
  rinks,
}: {
  facilityId: string
  rinks: RinkOption[]
}) {
  const [storedRinkId, setSelectedRinkId] = useSelectedRink(facilityId)
  // Guard against a persisted rink that's been removed/deactivated.
  const selectedRinkId = rinks.some((r) => r.id === storedRinkId)
    ? storedRinkId
    : ""
  const hasRinks = rinks.length > 0

  return (
    <div className="flex flex-col gap-2 sm:w-56">
      <Label htmlFor="ice-ops-rink">Rink</Label>
      <Select
        value={selectedRinkId || undefined}
        onValueChange={setSelectedRinkId}
        disabled={!hasRinks}
      >
        <SelectTrigger id="ice-ops-rink">
          <SelectValue
            placeholder={hasRinks ? "Select a rink" : "No rinks configured"}
          />
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
  )
}
