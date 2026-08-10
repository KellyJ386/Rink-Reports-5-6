"use client"

// Dynamic form renderer for one report instance, driven entirely by the
// instance's FROZEN template_snapshot (never the live template tables — a
// later template edit must not change how this instance renders). Editable
// only while it's the caller's own draft on an unlocked day; otherwise the
// same fields render disabled with an explanatory banner.

import { useRouter } from "next/navigation"
import { useState, useTransition } from "react"
import { CheckCircle2, CloudUpload, Lock } from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Callout } from "@/components/ui/callout"
import { Card } from "@/components/ui/card"
import { enqueueSubmission, useSyncQueue } from "@/lib/offline/use-sync-queue"

import type {
  ResponsesMap,
  ResponseValue,
  TemplateSnapshot,
} from "@/app/reports/daily/_lib/instance-compute"
import {
  saveReportInstance,
  submitReportInstance,
} from "@/app/reports/daily/instance-actions"

import { SnapshotFieldInput } from "./snapshot-field-input"

type Props = {
  instanceId: string
  areaName: string | null
  reportDate: string
  status: "draft" | "submitted"
  snapshot: TemplateSnapshot
  initialResponses: ResponsesMap
  editable: boolean
  locked: boolean
  mine: boolean
}

export function InstanceEditor({
  instanceId,
  areaName,
  reportDate,
  status,
  snapshot,
  initialResponses,
  editable,
  locked,
  mine,
}: Props) {
  const router = useRouter()
  const { isOnline } = useSyncQueue()
  const [responses, setResponses] = useState<ResponsesMap>(initialResponses)
  const [queued, setQueued] = useState<"save" | "submit" | null>(null)
  const [pending, startTransition] = useTransition()

  function setValue(fieldId: string, value: ResponseValue | undefined) {
    setResponses((prev) => {
      const next = { ...prev }
      if (value === undefined) delete next[fieldId]
      else next[fieldId] = value
      return next
    })
  }

  // Offline: queue the write in the service worker instead of calling the
  // server action (which would fail with a confusing network error). The
  // replay endpoint runs the SAME validation + lock checks on reconnect; if
  // the day locked while this sat in the queue, the item is parked as failed
  // with an explicit message on the Pending Sync Queue page — never dropped.
  function enqueueOffline(action: "save" | "submit"): boolean {
    const ok = enqueueSubmission({
      localId: crypto.randomUUID(),
      moduleKey: "daily_report_instances",
      action,
      payload: { instance_id: instanceId, responses },
    })
    if (ok) {
      setQueued(action)
    } else {
      toast.error(
        "You're offline and the offline queue isn't ready yet. Keep this page open and try again — your answers are still here.",
      )
    }
    return ok
  }

  function save() {
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      enqueueOffline("save")
      return
    }
    startTransition(async () => {
      const result = await saveReportInstance({ instanceId, responses })
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      toast.success("Draft saved.")
      router.refresh()
    })
  }

  function submit() {
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      enqueueOffline("submit")
      return
    }
    startTransition(async () => {
      const result = await submitReportInstance({ instanceId, responses })
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      toast.success("Report submitted.")
      router.refresh()
    })
  }

  return (
    <div className="flex flex-col gap-4">
      {locked && (
        <Callout tone="warning" icon={<Lock className="mt-0.5 h-4 w-4" aria-hidden />}>
          Daily reports for {reportDate} are locked. This report is read-only.
        </Callout>
      )}
      {!locked && status === "submitted" && (
        <Callout
          tone="success"
          icon={<CheckCircle2 className="mt-0.5 h-4 w-4" aria-hidden />}
        >
          This report was submitted and can no longer be edited.
        </Callout>
      )}
      {!locked && status === "draft" && !mine && (
        <Callout tone="info">
          This draft belongs to someone else — you&rsquo;re viewing it read-only.
        </Callout>
      )}

      <Card className="gap-4 py-5">
        <div className="flex items-center justify-between gap-3 px-6">
          <h2 className="text-lg font-semibold tracking-tight">
            {snapshot.template_name}
          </h2>
          {status === "submitted" ? (
            <Badge variant="success">Submitted</Badge>
          ) : (
            <Badge variant="secondary">Draft</Badge>
          )}
        </div>
        <p className="text-muted-foreground -mt-2 px-6 text-sm">
          {areaName ? `${areaName} · ` : ""}
          {reportDate} · form v{snapshot.version}
        </p>

        <div className="grid gap-4 px-6 sm:grid-cols-2">
          {snapshot.fields.map((field) => (
            <SnapshotFieldInput
              key={field.id}
              field={field}
              value={responses[field.id]}
              onChange={(v) => setValue(field.id, v)}
              disabled={!editable || pending}
            />
          ))}
        </div>
      </Card>

      {queued && (
        <Callout
          tone="info"
          icon={<CloudUpload className="mt-0.5 h-4 w-4" aria-hidden />}
        >
          {queued === "submit"
            ? "Saved on this device. The report will submit automatically when you're back online — the same checks (including the day's lock) run then. If the day locks first, it stays in your sync queue instead of being dropped."
            : "Saved on this device. Your answers will sync automatically when you're back online."}
        </Callout>
      )}

      {editable && (
        <div className="flex flex-wrap items-center justify-end gap-2">
          {!isOnline && (
            <span className="text-muted-foreground mr-auto text-xs">
              offline — will sync when reconnected
            </span>
          )}
          <Button type="button" variant="outline" onClick={save} disabled={pending}>
            {pending ? "Working…" : "Save draft"}
          </Button>
          <Button type="button" onClick={submit} disabled={pending}>
            {pending ? "Working…" : "Submit report"}
          </Button>
        </div>
      )}
    </div>
  )
}
