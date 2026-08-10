"use client"

// Offline-capable Report Forms view (Phase 4 of the form builder). Renders the
// per-user IndexedDB snapshot the live /reports/daily/forms board writes on
// every visit: the areas' published forms plus today's instances (with their
// frozen snapshots + responses). Offline, staff can
//   * create a new titled report (queued; the server freezes the snapshot and
//     re-checks permissions + the day's lock at sync), and
//   * edit / submit their OWN cached drafts (queued the same way).
// Everything else renders read-only. If the day locks while items sit in the
// queue, the replay parks them as failed with an explicit message on the
// Pending Sync Queue page — data is never silently dropped.

import Link from "next/link"
import { useCallback, useEffect, useState } from "react"
import { CloudUpload, Lock, Plus, WifiOff } from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Callout } from "@/components/ui/callout"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  getFormsBoard,
  isFormsCacheForToday,
  putFormsBoard,
  type CachedFormsBoard,
  type CachedInstance,
} from "@/lib/offline/daily-forms-cache"
import { enqueueSubmission, useSyncQueue } from "@/lib/offline/use-sync-queue"
import { createClient } from "@/lib/supabase/client"

import type {
  ResponsesMap,
  ResponseValue,
} from "@/app/reports/daily/_lib/instance-compute"

import { SnapshotFieldInput } from "./snapshot-field-input"

type View =
  | { kind: "loading" }
  | { kind: "signed_out" }
  | { kind: "no_cache" }
  | { kind: "stale"; businessDate: string }
  | { kind: "ready"; board: CachedFormsBoard }

export function OfflineFormsView() {
  const [view, setView] = useState<View>({ kind: "loading" })
  const { isOnline, pendingCount, failedCount } = useSyncQueue()

  const load = useCallback(async () => {
    const supabase = createClient()
    // getSession reads the locally-stored session (no network), so the cache
    // key resolves even when offline.
    const {
      data: { session },
    } = await supabase.auth.getSession()
    const userId = session?.user?.id ?? null
    if (!userId) {
      setView({ kind: "signed_out" })
      return
    }
    const cached = await getFormsBoard(userId)
    if (!cached) {
      setView({ kind: "no_cache" })
      return
    }
    if (!isFormsCacheForToday(cached)) {
      setView({ kind: "stale", businessDate: cached.businessDate })
      return
    }
    setView({ kind: "ready", board: cached })
  }, [])

  useEffect(() => {
    // Load-on-mount from IndexedDB; setState only happens after awaits (same
    // pattern as OfflineMyAreas / OfflineMySchedule).
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async load; setState happens post-await
    void load()
  }, [load])

  if (view.kind === "loading") {
    return <p className="text-muted-foreground text-sm">Loading…</p>
  }
  if (view.kind === "signed_out") {
    return (
      <Callout tone="info">
        Sign in once while online to make your report forms available offline.
      </Callout>
    )
  }
  if (view.kind === "no_cache") {
    return (
      <Callout tone="info">
        No offline copy on this device yet. Open{" "}
        <Link href="/reports/daily/forms" className="underline">
          Report Forms
        </Link>{" "}
        once while online and today&rsquo;s forms will be cached here.
      </Callout>
    )
  }
  if (view.kind === "stale") {
    return (
      <Callout tone="warning">
        The offline copy on this device is from {view.businessDate}, a previous
        day, so it can&rsquo;t be shown as today&rsquo;s. Reconnect and open{" "}
        <Link href="/reports/daily/forms" className="underline">
          Report Forms
        </Link>{" "}
        to refresh it.
      </Callout>
    )
  }

  const board = view.board

  return (
    <div className="flex flex-col gap-5">
      {!isOnline ? (
        <Callout tone="info" icon={<WifiOff className="mt-0.5 h-4 w-4" aria-hidden />}>
          You&rsquo;re offline. Changes below are saved on this device and sync
          when you reconnect — the day&rsquo;s lock is re-checked at sync time.
        </Callout>
      ) : (
        <Callout tone="info">
          You&rsquo;re online — the live{" "}
          <Link href="/reports/daily/forms" className="underline">
            Report Forms
          </Link>{" "}
          page has the freshest data. This view shows the copy saved on this
          device.
        </Callout>
      )}

      {board.locked && (
        <Callout tone="warning" icon={<Lock className="mt-0.5 h-4 w-4" aria-hidden />}>
          Daily reports for {board.businessDate} were locked when this copy was
          saved. Everything is read-only.
        </Callout>
      )}

      {(pendingCount > 0 || failedCount > 0) && (
        <Callout
          tone={failedCount > 0 ? "warning" : "info"}
          icon={<CloudUpload className="mt-0.5 h-4 w-4" aria-hidden />}
        >
          {pendingCount > 0 && `${pendingCount} change(s) waiting to sync. `}
          {failedCount > 0 && `${failedCount} item(s) need attention. `}
          <Link href="/reports/offline-queue" className="underline">
            View sync queue
          </Link>
        </Callout>
      )}

      {board.areas.map((area) => (
        <section key={area.id} className="flex flex-col gap-2" aria-label={area.name}>
          <h2 className="flex items-center gap-2 text-sm font-semibold tracking-widest uppercase text-muted-foreground">
            {area.color && (
              <span
                aria-hidden
                className="inline-block size-2 rounded-full"
                style={{ backgroundColor: area.color }}
              />
            )}
            {area.name}
          </h2>

          {!board.locked &&
            area.templates.map((t) => (
              <OfflineAddReport
                key={t.id}
                areaId={area.id}
                templateId={t.id}
                templateName={t.name}
              />
            ))}

          {area.instances.length === 0 ? (
            <p className="text-muted-foreground text-[13px]">
              No reports yet today.
            </p>
          ) : (
            area.instances.map((inst) => (
              <OfflineInstanceCard
                key={inst.id}
                instance={inst}
                locked={board.locked}
                onQueued={(updated) => {
                  // Keep the device copy current so reopening this view shows
                  // the latest queued answers/state.
                  const next: CachedFormsBoard = {
                    ...board,
                    areas: board.areas.map((a) => ({
                      ...a,
                      instances: a.instances.map((i) =>
                        i.id === updated.id ? updated : i,
                      ),
                    })),
                  }
                  setView({ kind: "ready", board: next })
                  void putFormsBoard(next)
                }}
              />
            ))
          )}
        </section>
      ))}
    </div>
  )
}

function OfflineAddReport({
  areaId,
  templateId,
  templateName,
}: {
  areaId: string
  templateId: string
  templateName: string
}) {
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState("")

  function create() {
    const ok = enqueueSubmission({
      localId: crypto.randomUUID(),
      moduleKey: "daily_report_instances",
      action: "create",
      payload: { area_id: areaId, template_id: templateId, title },
    })
    if (ok) {
      toast.success(
        "Saved on this device. The report will be created when you're back online.",
      )
      setTitle("")
      setOpen(false)
    } else {
      toast.error(
        "The offline queue isn't ready yet. Keep this page open and try again.",
      )
    }
  }

  return (
    <div className="rounded-lg border bg-card px-3 py-2.5">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium">{templateName}</span>
        <Button
          type="button"
          size="sm"
          variant={open ? "outline" : "default"}
          onClick={() => setOpen((v) => !v)}
        >
          <Plus className="h-4 w-4" aria-hidden />
          Add Report
        </Button>
      </div>
      {open && (
        <form
          className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end"
          onSubmit={(e) => {
            e.preventDefault()
            create()
          }}
        >
          <div className="flex grow flex-col gap-1.5">
            <Label htmlFor={`offline-title-${templateId}`}>Report title</Label>
            <Input
              id={`offline-title-${templateId}`}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Friday Night Game"
              maxLength={200}
              autoFocus
            />
          </div>
          <Button type="submit" disabled={title.trim().length === 0}>
            Queue report
          </Button>
        </form>
      )}
    </div>
  )
}

function OfflineInstanceCard({
  instance,
  locked,
  onQueued,
}: {
  instance: CachedInstance
  locked: boolean
  onQueued: (updated: CachedInstance) => void
}) {
  const [open, setOpen] = useState(false)
  const [responses, setResponses] = useState<ResponsesMap>(instance.responses)
  const editable = !locked && instance.mine && instance.status === "draft"

  function setValue(fieldId: string, value: ResponseValue | undefined) {
    setResponses((prev) => {
      const next = { ...prev }
      if (value === undefined) delete next[fieldId]
      else next[fieldId] = value
      return next
    })
  }

  function enqueue(action: "save" | "submit") {
    const ok = enqueueSubmission({
      localId: crypto.randomUUID(),
      moduleKey: "daily_report_instances",
      action,
      payload: { instance_id: instance.id, responses },
    })
    if (!ok) {
      toast.error(
        "The offline queue isn't ready yet. Keep this page open and try again.",
      )
      return
    }
    toast.success(
      action === "submit"
        ? "Saved on this device. The report will submit when you're back online."
        : "Saved on this device. Your answers will sync when you're back online.",
    )
    onQueued({
      ...instance,
      responses,
      // Reflect a queued submit locally so the chip reads Submitted; the
      // server remains the authority when the queue drains.
      status: action === "submit" ? "submitted" : instance.status,
    })
    if (action === "submit") setOpen(false)
  }

  return (
    <div className="rounded-lg border bg-card">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium">
            {instance.title}
          </span>
          <span className="text-muted-foreground block truncate text-xs">
            {instance.templateName}
            {instance.ownerName ? ` · ${instance.ownerName}` : ""}
            {instance.mine ? " (you)" : ""}
          </span>
        </span>
        {instance.status === "submitted" ? (
          <Badge variant="success">Submitted</Badge>
        ) : (
          <Badge variant="secondary">Draft</Badge>
        )}
      </button>

      {open && (
        <div className="flex flex-col gap-4 border-t px-3 pt-3 pb-4">
          <div className="grid gap-4 sm:grid-cols-2">
            {instance.snapshot.fields.map((field) => (
              <SnapshotFieldInput
                key={field.id}
                field={field}
                value={responses[field.id]}
                onChange={(v) => setValue(field.id, v)}
                disabled={!editable}
                idPrefix={`offline-${instance.id}`}
              />
            ))}
          </div>
          {editable && (
            <div className="flex items-center justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => enqueue("save")}
              >
                Save draft
              </Button>
              <Button type="button" size="sm" onClick={() => enqueue("submit")}>
                Submit report
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
