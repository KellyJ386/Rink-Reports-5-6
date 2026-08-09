"use client"

// The staff "Report Forms" board: for each area, the available form templates
// with "+ Add Report" (titled-instance creation) and today's instances listed
// by title with status chips. A locked day renders everything read-only with
// a visible lock banner — the server actions and the DB reject writes anyway;
// this just tells the user why.

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState, useTransition } from "react"
import { Lock, Plus } from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Callout } from "@/components/ui/callout"
import { Card } from "@/components/ui/card"
import { EmptyState } from "@/components/ui/empty-state"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

import { createReportInstance } from "../../instance-actions"

export type BoardInstance = {
  id: string
  title: string
  status: "draft" | "submitted"
  templateName: string
  ownerName: string | null
  mine: boolean
}

export type BoardArea = {
  id: string
  name: string
  color: string | null
  templates: Array<{ id: string; name: string; version: number }>
  instances: BoardInstance[]
}

type Props = {
  areas: BoardArea[]
  today: string
  locked: boolean
}

export function FormsBoard({ areas, today, locked }: Props) {
  if (areas.length === 0) {
    return (
      <EmptyState
        title="No report forms yet"
        description="Your administrator hasn't published any custom report forms for your areas."
      />
    )
  }

  return (
    <div className="flex flex-col gap-6">
      {locked && (
        <Callout tone="warning" icon={<Lock className="mt-0.5 h-4 w-4" aria-hidden />}>
          Daily reports for {today} are locked. Everything below is read-only.
        </Callout>
      )}

      {areas.map((area) => (
        <AreaSection key={area.id} area={area} locked={locked} />
      ))}
    </div>
  )
}

function AreaSection({ area, locked }: { area: BoardArea; locked: boolean }) {
  return (
    <Card className="gap-4 py-5">
      <h2 className="flex items-center gap-2 px-6 text-lg font-semibold tracking-tight">
        {area.color && (
          <span
            aria-hidden
            className="inline-block size-2.5 rounded-full"
            style={{ backgroundColor: area.color }}
          />
        )}
        {area.name}
      </h2>

      <div className="flex flex-col gap-4 px-6">
        {area.templates.length > 0 && (
          <div className="flex flex-col gap-2">
            {area.templates.map((t) => (
              <AddReportRow
                key={t.id}
                areaId={area.id}
                template={t}
                locked={locked}
              />
            ))}
          </div>
        )}

        {area.instances.length > 0 ? (
          <div className="flex flex-col gap-1.5">
            <h3 className="text-muted-foreground text-sm font-semibold">
              Today&rsquo;s reports
            </h3>
            <ul className="divide-border divide-y rounded-lg border">
              {area.instances.map((inst) => (
                <li key={inst.id}>
                  <Link
                    href={`/reports/daily/forms/${inst.id}`}
                    className="hover:bg-muted/40 flex items-center justify-between gap-3 px-3 py-2.5"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">
                        {inst.title}
                      </span>
                      <span className="text-muted-foreground block truncate text-xs">
                        {inst.templateName}
                        {inst.ownerName ? ` · ${inst.ownerName}` : ""}
                        {inst.mine ? " (you)" : ""}
                      </span>
                    </span>
                    {inst.status === "submitted" ? (
                      <Badge variant="success">Submitted</Badge>
                    ) : (
                      <Badge variant="secondary">Draft</Badge>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="text-muted-foreground text-sm">
            No reports yet today.
          </p>
        )}
      </div>
    </Card>
  )
}

function AddReportRow({
  areaId,
  template,
  locked,
}: {
  areaId: string
  template: { id: string; name: string; version: number }
  locked: boolean
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState("")
  const [pending, startTransition] = useTransition()

  function create() {
    startTransition(async () => {
      const result = await createReportInstance({
        areaId,
        templateId: template.id,
        title,
      })
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      router.push(`/reports/daily/forms/${result.instanceId}`)
    })
  }

  return (
    <div className="rounded-lg border px-3 py-2.5">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium">{template.name}</span>
        <Button
          type="button"
          size="sm"
          variant={open ? "outline" : "default"}
          onClick={() => setOpen((v) => !v)}
          disabled={locked}
        >
          <Plus className="h-4 w-4" aria-hidden />
          Add Report
        </Button>
      </div>
      {open && !locked && (
        <form
          className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end"
          onSubmit={(e) => {
            e.preventDefault()
            create()
          }}
        >
          <div className="flex grow flex-col gap-1.5">
            <Label htmlFor={`title-${template.id}`}>Report title</Label>
            <Input
              id={`title-${template.id}`}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Friday Night Game"
              maxLength={200}
              autoFocus
            />
          </div>
          <Button type="submit" disabled={pending || title.trim().length === 0}>
            {pending ? "Creating…" : "Create"}
          </Button>
        </form>
      )}
    </div>
  )
}
