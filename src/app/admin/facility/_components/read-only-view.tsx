import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

import type { FacilityCounts, FacilityRow } from "../types"

type Props = {
  facility: FacilityRow
  counts: FacilityCounts
}

function formatDate(value: string | null): string {
  if (!value) return "—"
  try {
    const d = new Date(value)
    if (Number.isNaN(d.getTime())) return "—"
    return d.toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    })
  } catch {
    return "—"
  }
}

function ReadOnlyField({
  label,
  value,
  mono = false,
}: {
  label: string
  value: string
  mono?: boolean
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
        {label}
      </span>
      <span
        className={`text-foreground text-sm ${mono ? "font-mono" : ""}`.trim()}
      >
        {value}
      </span>
    </div>
  )
}

export function ReadOnlyFacilityView({ facility, counts }: Props) {
  const settingsJson = JSON.stringify(facility.settings ?? {}, null, 2)

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Facility settings</CardTitle>
          <CardDescription>
            Only super admins can edit facility settings. Contact your
            administrator to make changes.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-2">
            <ReadOnlyField label="Name" value={facility.name} />
            <ReadOnlyField label="Slug" value={facility.slug} mono />
            <ReadOnlyField label="Timezone" value={facility.timezone} />
            <ReadOnlyField
              label="Status"
              value={facility.is_active ? "Active" : "Inactive"}
            />
            <ReadOnlyField label="Address" value={facility.address ?? "—"} />
            <ReadOnlyField label="City" value={facility.city ?? "—"} />
            <ReadOnlyField label="State" value={facility.state ?? "—"} />
            <ReadOnlyField label="Zip code" value={facility.zip_code ?? "—"} />
            <ReadOnlyField label="Phone" value={facility.phone ?? "—"} />
            <ReadOnlyField label="Email" value={facility.email ?? "—"} />
            <ReadOnlyField
              label="Created"
              value={formatDate(facility.created_at)}
            />
            <ReadOnlyField
              label="Last updated"
              value={formatDate(facility.updated_at)}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>At a glance</CardTitle>
          <CardDescription>
            Counts of related records for this facility.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-3 gap-3 sm:gap-6">
            <div className="flex flex-col">
              <dt className="text-muted-foreground text-xs uppercase tracking-wide">
                Employees
              </dt>
              <dd className="text-foreground text-2xl font-semibold">
                {counts.employees}
              </dd>
            </div>
            <div className="flex flex-col">
              <dt className="text-muted-foreground text-xs uppercase tracking-wide">
                Departments
              </dt>
              <dd className="text-foreground text-2xl font-semibold">
                {counts.departments}
              </dd>
            </div>
            <div className="flex flex-col">
              <dt className="text-muted-foreground text-xs uppercase tracking-wide">
                Roles
              </dt>
              <dd className="text-foreground text-2xl font-semibold">
                {counts.roles}
              </dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Settings (JSON)</CardTitle>
          <CardDescription>
            Raw <code className="font-mono text-xs">settings</code> jsonb
            payload. Read only.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <pre className="bg-muted text-foreground/90 max-h-72 overflow-auto rounded-md border p-3 font-mono text-xs">
            {settingsJson}
          </pre>
        </CardContent>
      </Card>
    </div>
  )
}
