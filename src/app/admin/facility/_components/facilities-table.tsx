import Link from "next/link"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

import type { FacilityListItem } from "../types"

type Props = {
  facilities: ReadonlyArray<FacilityListItem>
  selectedId: string | null
}

function formatDate(value: string | null): string {
  if (!value) return "—"
  try {
    const d = new Date(value)
    if (Number.isNaN(d.getTime())) return "—"
    return d.toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    })
  } catch {
    return "—"
  }
}

export function FacilitiesTable({ facilities, selectedId }: Props) {
  if (facilities.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>No facilities yet</CardTitle>
          <CardDescription>
            Create your first facility to get started. Default roles will be
            seeded automatically.
          </CardDescription>
        </CardHeader>
      </Card>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {facilities.map((facility) => {
        const isSelected = facility.id === selectedId
        return (
          <Card
            key={facility.id}
            className={
              isSelected
                ? "ring-ring ring-2 ring-offset-2 ring-offset-background"
                : undefined
            }
          >
            <CardHeader>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex flex-col gap-1">
                  <CardTitle className="flex items-center gap-2 text-lg">
                    {facility.name}
                    {!facility.is_active && (
                      <span className="text-muted-foreground border-muted-foreground/30 rounded-md border px-1.5 py-0.5 text-xs font-normal">
                        Inactive
                      </span>
                    )}
                  </CardTitle>
                  <CardDescription>
                    <span className="font-mono text-xs">{facility.slug}</span>
                    <span className="mx-2">·</span>
                    <span>{facility.timezone}</span>
                    <span className="mx-2">·</span>
                    <span>Created {formatDate(facility.created_at)}</span>
                  </CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  <Button asChild size="sm" variant="outline">
                    <Link href={`/admin/facility?id=${facility.id}`}>
                      {isSelected ? "Editing" : "Edit"}
                    </Link>
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <dl className="text-muted-foreground grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                <div className="flex flex-col">
                  <dt className="text-xs uppercase tracking-wide">
                    Employees
                  </dt>
                  <dd className="text-foreground text-base font-medium">
                    {facility.employee_count}
                  </dd>
                </div>
                <div className="flex flex-col">
                  <dt className="text-xs uppercase tracking-wide">Status</dt>
                  <dd className="text-foreground text-base font-medium">
                    {facility.is_active ? "Active" : "Inactive"}
                  </dd>
                </div>
                <div className="flex flex-col">
                  <dt className="text-xs uppercase tracking-wide">Timezone</dt>
                  <dd className="text-foreground text-sm font-medium">
                    {facility.timezone}
                  </dd>
                </div>
                <div className="flex flex-col">
                  <dt className="text-xs uppercase tracking-wide">Slug</dt>
                  <dd className="text-foreground font-mono text-sm font-medium">
                    {facility.slug}
                  </dd>
                </div>
              </dl>
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}
