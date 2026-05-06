import Link from "next/link"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

import type { FacilityRow } from "../types"
import { FacilityForm } from "./facility-form"

type Props = {
  facility: FacilityRow
}

export function EditFacilitySection({ facility }: Props) {
  const settingsJson = JSON.stringify(facility.settings ?? {}, null, 2)

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <CardTitle>Edit {facility.name}</CardTitle>
            <CardDescription>
              Update name, slug, timezone, and active status.
            </CardDescription>
          </div>
          <Button asChild size="sm" variant="ghost">
            <Link href="/admin/facility">Close</Link>
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid gap-6 lg:grid-cols-2">
          <FacilityForm mode="edit" initial={facility} />
          <div className="flex flex-col gap-2">
            <span className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
              Settings (read only)
            </span>
            <pre className="bg-muted text-foreground/90 max-h-72 overflow-auto rounded-md border p-3 font-mono text-xs">
              {settingsJson}
            </pre>
            <p className="text-muted-foreground text-xs">
              The <code className="font-mono">settings</code> jsonb is managed
              elsewhere in the app.
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
