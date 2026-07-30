"use client"

// The issue pipeline UI shared by the asset bottom sheet and the checklist-item
// sheet: open-issue rows (with per-role acknowledge/resolve controls) and the
// report-issue form. The form is the module's primary logging surface — it
// renders expanded by default so a failure report is: severity → category →
// description → save. It works with or without an active walk
// (reportIssueAction auto-links the caller's open walk server-side).

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { enqueueSubmission } from "@/lib/offline/use-sync-queue"
import { genLocalId } from "@/lib/offline/local-id"

import {
  acknowledgeIssueAction,
  reportIssueAction,
  resolveIssueAction,
} from "../../actions"
import type { IssueSeverity } from "../../_lib/compute"
import type { ChecklistItemRow, IssueRow, PerimeterAsset } from "../../_lib/queries"
import type { Tables } from "@/types/database"
import { glassLabelOf } from "../../_lib/glass-numbering"

type CategoryRow = Tables<"dasher_boards_issue_categories">

export const SELECT_CLASS =
  "border-input bg-background h-10 w-full rounded-md border px-3 py-1 text-sm"

export const SEVERITY_LABEL: Record<IssueSeverity, string> = {
  a: "A — Safety critical",
  b: "B — Needs repair",
  c: "C — Cosmetic",
}

function severityBadge(s: IssueSeverity): "destructive" | "warning" {
  return s === "a" ? "destructive" : "warning"
}

export function OpenIssueRow({
  issue,
  categories,
  canEdit,
  canSubmit,
  online,
}: {
  issue: IssueRow
  categories: CategoryRow[]
  canEdit: boolean
  canSubmit: boolean
  online: boolean
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const severity = issue.severity as IssueSeverity
  // Staff (submit) may mark B/C issues fixed; severity-A needs a supervisor.
  const canResolve = canEdit || (canSubmit && severity !== "a")
  const category = issue.category_id
    ? (categories.find((c) => c.id === issue.category_id)?.label ?? null)
    : null

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, ok: string) {
    start(async () => {
      const r = await fn()
      if (!r.ok) toast.error(r.error ?? "Failed.")
      else {
        toast.success(ok)
        router.refresh()
      }
    })
  }

  return (
    <div className="bg-muted/30 flex flex-col gap-1.5 rounded-md border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={severityBadge(severity)} aria-label={SEVERITY_LABEL[severity]}>
          {severity.toUpperCase()}
        </Badge>
        {category && <Badge variant="outline">{category}</Badge>}
        {severity === "a" && !issue.supervisor_ack_at && (
          <Badge variant="warning">awaiting ack</Badge>
        )}
      </div>
      <p className="text-sm">{issue.description}</p>
      {issue.action_taken && (
        <p className="text-muted-foreground text-xs">
          Action taken: {issue.action_taken}
        </p>
      )}
      <p className="text-muted-foreground font-mono text-xs">
        {new Date(issue.created_at).toLocaleString()}
      </p>
      {online && (canResolve || canEdit) && (
        <div className="flex gap-2">
          {canEdit && severity === "a" && !issue.supervisor_ack_at && (
            <Button
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() =>
                run(() => acknowledgeIssueAction(issue.id), "Acknowledged.")
              }
            >
              Acknowledge
            </Button>
          )}
          {canResolve && (
            <Button
              size="sm"
              disabled={pending}
              onClick={() => run(() => resolveIssueAction(issue.id), "Marked fixed.")}
            >
              Mark fixed
            </Button>
          )}
        </div>
      )}
    </div>
  )
}

export function ReportIssueForm({
  asset,
  glassChild,
  glassNumbers,
  item,
  categories,
  supervisors,
  online,
  onReported,
}: {
  asset: PerimeterAsset | null
  glassChild: PerimeterAsset | null
  /** The rink's glass numbers; empty = show the permanent labels. */
  glassNumbers?: Record<string, string>
  item: ChecklistItemRow | null
  categories: CategoryRow[]
  supervisors: Array<{ id: string; name: string }>
  online: boolean
  onReported: (checklistItemId: string | null) => void
}) {
  // A board position's issue can be on the board OR its glass.
  const [targetGlass, setTargetGlass] = useState(false)
  const targetAsset = targetGlass && glassChild ? glassChild : asset
  const [categoryId, setCategoryId] = useState("")
  const [description, setDescription] = useState("")
  // Default to B — the most common real-world failure tier, so the fastest
  // path (tap asset → category → description → save) needs no severity tap.
  const [severity, setSeverity] = useState<IssueSeverity>("b")
  const [actionTaken, setActionTaken] = useState("")
  const [supervisorId, setSupervisorId] = useState("")
  const [pending, start] = useTransition()
  const [done, setDone] = useState(false)

  const availableCategories = targetAsset
    ? categories.filter((c) => c.asset_type === targetAsset.asset_type)
    : []

  function submit() {
    if (!description.trim()) {
      toast.error("Describe the issue.")
      return
    }
    if (targetAsset && !categoryId) {
      toast.error("Pick a category.")
      return
    }
    if (severity === "a" && (!supervisorId || !actionTaken.trim())) {
      toast.error("Severity A needs a supervisor and the action taken.")
      return
    }
    const payload = {
      assetId: targetAsset?.id ?? null,
      checklistItemId: item?.id ?? null,
      categoryId: targetAsset ? categoryId : null,
      description: description.trim(),
      severity,
      actionTaken: actionTaken.trim() || null,
      supervisorId: supervisorId || null,
    }
    start(async () => {
      if (!online) {
        const ok = enqueueSubmission({
          localId: genLocalId(),
          moduleKey: "dasher_boards",
          action: "report_issue",
          payload,
        })
        if (ok) {
          toast.success("Issue saved offline — it will sync when you reconnect.")
          setDone(true)
          onReported(item?.id ?? null)
        } else {
          toast.error("Offline queue unavailable.")
        }
        return
      }
      const r = await reportIssueAction(payload)
      if (!r.ok) toast.error(r.error)
      else {
        toast.success("Issue reported.")
        setDone(true)
        onReported(item?.id ?? null)
      }
    })
  }

  // After a successful save the form collapses to a confirmation + "report
  // another" so a re-render doesn't offer a half-stale form.
  if (done) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-md border p-3">
        <span className="text-sm">Issue reported.</span>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            setDone(false)
            setCategoryId("")
            setDescription("")
            setSeverity("b")
            setActionTaken("")
            setSupervisorId("")
          }}
        >
          Report another
        </Button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3 rounded-md border p-3">
      <Label>Report issue</Label>
      {asset && glassChild && glassChild.is_active && (
        <div className="flex gap-2">
          <Button
            size="sm"
            variant={targetGlass ? "outline" : "default"}
            onClick={() => {
              setTargetGlass(false)
              setCategoryId("")
            }}
          >
            Board {asset.label}
          </Button>
          <Button
            size="sm"
            variant={targetGlass ? "default" : "outline"}
            onClick={() => {
              setTargetGlass(true)
              setCategoryId("")
            }}
          >
            Glass {glassLabelOf(glassChild, glassNumbers)}
          </Button>
        </div>
      )}
      <div className="flex gap-2" role="group" aria-label="Severity">
        {(["a", "b", "c"] as const).map((s) => (
          <Button
            key={s}
            size="sm"
            variant={
              severity === s
                ? s === "a"
                  ? "destructive"
                  : "default"
                : "outline"
            }
            aria-pressed={severity === s}
            onClick={() => setSeverity(s)}
          >
            {SEVERITY_LABEL[s]}
          </Button>
        ))}
      </div>
      {severity === "a" && (
        // The A-tier requirements are stated up front, before the user starts
        // typing — a DB check constraint rejects an A issue without them.
        <p className="text-muted-foreground text-xs">
          Severity A is safety-critical: naming a supervisor and recording the
          action taken are required before it can be saved.
        </p>
      )}
      {targetAsset && (
        <select
          aria-label="Category"
          className={SELECT_CLASS}
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value)}
        >
          <option value="">Category…</option>
          {availableCategories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
      )}
      <Textarea
        placeholder="Describe the issue…"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        rows={2}
        className="text-base"
      />
      {severity === "a" && (
        <>
          <Textarea
            placeholder="Action taken (required for A)…"
            value={actionTaken}
            onChange={(e) => setActionTaken(e.target.value)}
            rows={2}
          />
          <select
            aria-label="Supervisor"
            className={SELECT_CLASS}
            value={supervisorId}
            onChange={(e) => setSupervisorId(e.target.value)}
          >
            <option value="">Supervisor (required for A)…</option>
            {supervisors.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </>
      )}
      <Button onClick={submit} disabled={pending}>
        {pending ? "Submitting…" : "Submit issue"}
      </Button>
    </div>
  )
}
