"use client"

// The per-asset detail panel: Pass/Fail condition check, replacement spec,
// door marking, open issues, the report-issue flow, and collapsed history.
// Rendered inside the segment-anchored popover on the condition map (all
// screen sizes). `OpenIssueRow` and `ReportIssueForm` are also reused by the
// checklist-item bottom sheet in condition-map.tsx.

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { X } from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { enqueueSubmission } from "@/lib/offline/use-sync-queue"
import { genLocalId } from "@/lib/offline/local-id"
import {
  convertAssetToDoor,
  convertDoorToBoard,
  setGlassSpec,
} from "@/app/admin/dasher-boards/actions"
import type { GlassSpecInput } from "@/app/admin/dasher-boards/types"

import {
  acknowledgeIssueAction,
  getAssetDetailAction,
  reportIssueAction,
  resolveIssueAction,
} from "../../actions"
import { thicknessToFraction, type IssueSeverity } from "../../_lib/compute"
import type {
  ChecklistItemRow,
  IssueRow,
  PerimeterAsset,
} from "../../_lib/queries"
import type { Tables } from "@/types/database"

type SubtypeRow = Tables<"dasher_boards_asset_subtypes">
type CategoryRow = Tables<"dasher_boards_issue_categories">

const SELECT_CLASS =
  "border-input bg-background h-10 w-full rounded-md border px-3 py-1 text-sm"

export const SEVERITY_LABEL: Record<IssueSeverity, string> = {
  a: "A — Safety critical",
  b: "B — Needs repair",
  c: "C — Cosmetic",
}

function severityBadge(s: IssueSeverity): "destructive" | "warning" {
  return s === "a" ? "destructive" : "warning"
}

export function AssetDetailPanel({
  asset,
  assets,
  openIssues,
  categories,
  doorSubtypes,
  supervisors,
  can,
  online,
  walkActive,
  assetChecks,
  checkPending,
  onSaveCheck,
  onIssueReported,
  onClose,
}: {
  asset: PerimeterAsset
  assets: PerimeterAsset[]
  openIssues: IssueRow[]
  categories: CategoryRow[]
  doorSubtypes: SubtypeRow[]
  supervisors: Array<{ id: string; name: string }>
  can: { submit: boolean; edit: boolean; admin: boolean }
  online: boolean
  walkActive: boolean
  assetChecks: Record<string, { status: "pass" | "fail"; note: string | null }>
  checkPending: boolean
  onSaveCheck: (assetId: string, status: "pass" | "fail", note: string | null) => void
  onIssueReported: (checklistItemId: string | null) => void
  onClose: () => void
}) {
  const glassChild =
    asset.asset_type === "board_panel"
      ? (assets.find(
          (a) => a.asset_type === "glass_panel" && a.parent_board_id === asset.id,
        ) ?? null)
      : null
  const specTarget =
    asset.asset_type === "door"
      ? asset
      : glassChild && glassChild.is_active
        ? glassChild
        : null
  const subtypeLabel = asset.subtype_id
    ? (doorSubtypes.find((s) => s.id === asset.subtype_id)?.label ?? null)
    : null
  const issuesHere = openIssues.filter(
    (i) => i.asset_id === asset.id || i.asset_id === glassChild?.id,
  )

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2 font-semibold">
            <span className="font-mono">{asset.label}</span>
            <Badge variant={asset.asset_type === "door" ? "special" : "secondary"}>
              {asset.asset_type === "door"
                ? (subtypeLabel ?? "Door")
                : asset.asset_type === "glass_panel"
                  ? "Glass"
                  : "Board panel"}
            </Badge>
          </div>
          <p className="text-muted-foreground text-sm">
            {asset.open_count > 0
              ? `${asset.open_count} open issue(s) on this asset.`
              : "No open issues."}
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Close"
          onClick={onClose}
        >
          <X aria-hidden />
        </Button>
      </div>

      {/* Pass/Fail condition check — the walk-doer's primary action for
          this piece. Only during an active walk, for submit-tier. */}
      {walkActive && can.submit && (
        <AssetCheckBlock
          key={`check-${asset.id}`}
          asset={asset}
          glassChild={glassChild}
          assetChecks={assetChecks}
          pending={checkPending}
          onSave={onSaveCheck}
        />
      )}

      {/* Replacement spec — first thing on screen when glass breaks.
          Re-keyed by target identity AND type so a board→door
          conversion with the panel open never edits stale fields. */}
      {specTarget && (
        <SpecBlock
          key={`${specTarget.id}:${specTarget.asset_type}`}
          target={specTarget}
          canEditSpec={can.edit || can.admin}
        />
      )}

      {/* Door marking — module admins only (post-launch corrections). */}
      {can.admin && asset.asset_type !== "glass_panel" && (
        <DoorToggle asset={asset} doorSubtypes={doorSubtypes} />
      )}

      {/* Open issues (with per-role ack/resolve controls). */}
      {issuesHere.length > 0 && (
        <div className="flex flex-col gap-2">
          <Label>Open issues</Label>
          {issuesHere.map((issue) => (
            <OpenIssueRow
              key={issue.id}
              issue={issue}
              categories={categories}
              canEdit={can.edit}
              canSubmit={can.submit}
              online={online}
            />
          ))}
        </div>
      )}

      {/* Report issue — re-keyed by asset so form state never survives a
          switch to a different asset. */}
      {can.submit && (
        <ReportIssueForm
          key={asset.id}
          asset={asset}
          glassChild={glassChild}
          item={null}
          categories={categories}
          supervisors={supervisors}
          online={online}
          onReported={onIssueReported}
        />
      )}

      {/* Collapsed full history (online only). */}
      <HistoryBlock assetId={asset.id} online={online} />
    </div>
  )
}

// Per-asset Pass/Fail check with a notes box — the walk-doer's per-piece
// checkoff. Tapping Pass or Fail saves immediately (with whatever note is
// typed). A board position's check can target the board OR its glass — same
// board/glass toggle as ReportIssueForm, so board vs. glass checks look
// consistent with board vs. glass issue reports in the same panel.
function AssetCheckBlock({
  asset,
  glassChild,
  assetChecks,
  pending,
  onSave,
}: {
  asset: PerimeterAsset
  glassChild: PerimeterAsset | null
  assetChecks: Record<string, { status: "pass" | "fail"; note: string | null }>
  pending: boolean
  onSave: (assetId: string, status: "pass" | "fail", note: string | null) => void
}) {
  const [targetGlass, setTargetGlass] = useState(false)
  const targetAsset = targetGlass && glassChild ? glassChild : asset
  const current = assetChecks[targetAsset.id] ?? null
  const [note, setNote] = useState(current?.note ?? "")

  return (
    <div className="flex flex-col gap-2 rounded-md border p-3">
      <div className="flex items-center justify-between">
        <Label>Condition check</Label>
        {current && (
          <Badge variant={current.status === "pass" ? "success" : "destructive"}>
            {current.status === "pass" ? "Pass" : "Fail"}
          </Badge>
        )}
      </div>
      {glassChild && glassChild.is_active && (
        <div className="flex gap-2">
          <Button
            size="sm"
            variant={targetGlass ? "outline" : "default"}
            onClick={() => {
              setTargetGlass(false)
              setNote(assetChecks[asset.id]?.note ?? "")
            }}
          >
            Board {asset.label}
          </Button>
          <Button
            size="sm"
            variant={targetGlass ? "default" : "outline"}
            onClick={() => {
              setTargetGlass(true)
              setNote(assetChecks[glassChild.id]?.note ?? "")
            }}
          >
            Glass {glassChild.label}
          </Button>
        </div>
      )}
      <Textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Notes on this piece (optional)"
        rows={2}
        className="text-base"
      />
      <div className="flex gap-2">
        <Button
          type="button"
          variant={current?.status === "pass" ? "default" : "outline"}
          className="flex-1"
          disabled={pending}
          onClick={() => onSave(targetAsset.id, "pass", note)}
        >
          Pass
        </Button>
        <Button
          type="button"
          variant={current?.status === "fail" ? "destructive" : "outline"}
          className="flex-1"
          disabled={pending}
          onClick={() => onSave(targetAsset.id, "fail", note)}
        >
          Fail
        </Button>
      </div>
    </div>
  )
}

function SpecBlock({
  target,
  canEditSpec,
}: {
  target: PerimeterAsset
  canEditSpec: boolean
}) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [pending, start] = useTransition()
  const [width, setWidth] = useState(
    target.glass_width_in === null ? "" : String(target.glass_width_in),
  )
  const [height, setHeight] = useState(
    target.glass_height_in === null ? "" : String(target.glass_height_in),
  )
  const [thickness, setThickness] = useState(
    target.glass_thickness_in === null ? "" : String(target.glass_thickness_in),
  )
  const [material, setMaterial] = useState(target.glass_material ?? "")
  const hasSpec =
    target.glass_width_in !== null ||
    target.glass_height_in !== null ||
    target.glass_thickness_in !== null ||
    target.glass_material !== null

  function save() {
    const toNum = (v: string) => {
      if (v.trim() === "") return null
      const n = Number(v)
      return Number.isFinite(n) ? n : null
    }
    const spec: GlassSpecInput = {
      widthIn: toNum(width),
      heightIn: toNum(height),
      thicknessIn: toNum(thickness),
      material: (material || null) as GlassSpecInput["material"],
      notes: target.spec_notes,
    }
    start(async () => {
      const r = await setGlassSpec(target.id, spec)
      if (!r.ok) toast.error(r.error)
      else {
        toast.success("Spec saved.")
        setEditing(false)
        // revalidateModule() doesn't cover this dynamic rink route; refresh so
        // the read view (and the diagram's spec indicator) shows the new values.
        router.refresh()
      }
    })
  }

  return (
    <div className="bg-muted/30 flex flex-col gap-1.5 rounded-md border p-3">
      <div className="flex items-center justify-between">
        <Label>Replacement spec</Label>
        <span className="flex items-center gap-2">
          {!hasSpec &&
            (canEditSpec ? (
              <Badge variant="warning">No spec on file</Badge>
            ) : (
              <span className="text-muted-foreground text-xs">
                No spec on file
              </span>
            ))}
          {canEditSpec && (
            <Button variant="ghost" size="sm" onClick={() => setEditing((v) => !v)}>
              {editing ? "Close" : "Edit"}
            </Button>
          )}
        </span>
      </div>
      {editing && canEditSpec ? (
        <div className="flex flex-col gap-2">
          <div className="grid grid-cols-2 gap-2">
            <input
              aria-label="Height (in)"
              placeholder="Height (in)"
              inputMode="decimal"
              value={height}
              onChange={(e) => setHeight(e.target.value)}
              className="border-input bg-background h-10 rounded-md border px-3 font-mono text-sm"
            />
            <input
              aria-label="Width (in)"
              placeholder="Width (in)"
              inputMode="decimal"
              value={width}
              onChange={(e) => setWidth(e.target.value)}
              className="border-input bg-background h-10 rounded-md border px-3 font-mono text-sm"
            />
            <input
              aria-label="Thickness (in)"
              placeholder="Thickness (in)"
              inputMode="decimal"
              value={thickness}
              onChange={(e) => setThickness(e.target.value)}
              className="border-input bg-background h-10 rounded-md border px-3 font-mono text-sm"
            />
            <select
              aria-label="Material"
              className={SELECT_CLASS}
              value={material}
              onChange={(e) => setMaterial(e.target.value)}
            >
              <option value="">Material…</option>
              <option value="tempered">tempered</option>
              <option value="acrylic">acrylic</option>
              <option value="polycarbonate">polycarbonate</option>
            </select>
          </div>
          <Button size="sm" onClick={save} disabled={pending}>
            {pending ? "Saving…" : "Save spec"}
          </Button>
        </div>
      ) : (
        <div className="font-mono text-sm">
          {/* Height × width lead — the ordering info when glass breaks. */}
          <div className="text-lg font-bold">
            {target.glass_height_in ?? "—"} × {target.glass_width_in ?? "—"} in
          </div>
          <div className="text-muted-foreground">
            {target.glass_thickness_in !== null
              ? `${thicknessToFraction(target.glass_thickness_in)}" thick`
              : "thickness —"}
            {target.glass_material ? ` · ${target.glass_material}` : ""}
          </div>
          {target.spec_notes && (
            <div className="text-muted-foreground mt-1 text-xs">
              {target.spec_notes}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function DoorToggle({
  asset,
  doorSubtypes,
}: {
  asset: PerimeterAsset
  doorSubtypes: SubtypeRow[]
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [subtypeId, setSubtypeId] = useState(asset.subtype_id ?? "")
  const isDoor = asset.asset_type === "door"

  return (
    <div className="flex flex-col gap-2 rounded-md border border-dashed p-3">
      <div className="flex items-center justify-between">
        <Label htmlFor="db-door-toggle">This is a door</Label>
        <Switch
          id="db-door-toggle"
          aria-label="This is a door"
          checked={isDoor}
          disabled={pending}
          onCheckedChange={(v) => {
            start(async () => {
              const r = v
                ? await convertAssetToDoor(asset.id, subtypeId || null)
                : await convertDoorToBoard(asset.id)
              if (!r.ok) toast.error(r.error)
              else {
                toast.success(
                  v
                    ? "Marked as a door (next door number assigned)."
                    : "Converted back to a board.",
                )
                router.refresh()
              }
            })
          }}
        />
      </div>
      {!isDoor && (
        <select
          aria-label="Door subtype"
          className={SELECT_CLASS}
          value={subtypeId}
          onChange={(e) => setSubtypeId(e.target.value)}
        >
          <option value="">Subtype (optional)…</option>
          {doorSubtypes.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
      )}
    </div>
  )
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
  item,
  categories,
  supervisors,
  online,
  onReported,
}: {
  asset: PerimeterAsset | null
  glassChild: PerimeterAsset | null
  item: ChecklistItemRow | null
  categories: CategoryRow[]
  supervisors: Array<{ id: string; name: string }>
  online: boolean
  onReported: (checklistItemId: string | null) => void
}) {
  const [open, setOpen] = useState(item !== null)
  // A board position's issue can be on the board OR its glass.
  const [targetGlass, setTargetGlass] = useState(false)
  const targetAsset = targetGlass && glassChild ? glassChild : asset
  const [categoryId, setCategoryId] = useState("")
  const [description, setDescription] = useState("")
  const [severity, setSeverity] = useState<IssueSeverity>("c")
  const [actionTaken, setActionTaken] = useState("")
  const [supervisorId, setSupervisorId] = useState("")
  const [pending, start] = useTransition()

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
          setOpen(false)
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
        setOpen(false)
        onReported(item?.id ?? null)
      }
    })
  }

  if (!open) {
    return (
      <Button variant="outline" onClick={() => setOpen(true)}>
        Report issue
      </Button>
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
            Glass {glassChild.label}
          </Button>
        </div>
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
      />
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
      <div className="flex gap-2">
        <Button onClick={submit} disabled={pending}>
          {pending ? "Submitting…" : "Submit issue"}
        </Button>
        <Button variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </div>
  )
}

function HistoryBlock({ assetId, online }: { assetId: string; online: boolean }) {
  const [history, setHistory] = useState<IssueRow[] | null>(null)
  const [loading, setLoading] = useState(false)

  async function load() {
    if (history !== null || loading) return
    if (!online) return
    setLoading(true)
    const r = await getAssetDetailAction(assetId)
    setLoading(false)
    if (r.ok) setHistory(r.detail.history)
  }

  return (
    <details onToggle={(e) => e.currentTarget.open && void load()}>
      <summary className="text-muted-foreground cursor-pointer text-sm">
        Issue history
      </summary>
      <div className="mt-2 flex flex-col gap-2">
        {!online && (
          <p className="text-muted-foreground text-xs">
            History is unavailable offline.
          </p>
        )}
        {loading && <p className="text-muted-foreground text-xs">Loading…</p>}
        {history?.length === 0 && (
          <p className="text-muted-foreground text-xs">No resolved issues.</p>
        )}
        {history?.map((issue) => (
          <div key={issue.id} className="bg-muted/20 rounded-md border p-2">
            <div className="flex items-center gap-2">
              <Badge variant="secondary">
                {(issue.severity as string).toUpperCase()}
              </Badge>
              <span className="text-muted-foreground font-mono text-xs">
                {new Date(issue.created_at).toLocaleDateString()} →{" "}
                {issue.resolved_at
                  ? new Date(issue.resolved_at).toLocaleDateString()
                  : ""}
              </span>
            </div>
            <p className="mt-1 text-sm">{issue.description}</p>
          </div>
        ))}
      </div>
    </details>
  )
}
