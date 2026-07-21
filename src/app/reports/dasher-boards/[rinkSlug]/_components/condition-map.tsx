"use client"

// The staff-facing Dasher Boards condition map: a tappable perimeter diagram
// where open issues persist on assets until resolved, plus the exception-based
// inspection walk (start → tap problems → answer due checklist → sign off).
// Mobile-first: the asset dialog is a bottom sheet; phones are the primary
// form factor.

import { useEffect, useMemo, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { RinkPerimeter } from "@/components/rink/rink-perimeter"
import type { PerimeterCondition } from "@/components/rink/rink-perimeter"
import { enqueueSubmission, useSyncQueue } from "@/lib/offline/use-sync-queue"
import { genLocalId } from "@/lib/offline/local-id"
import {
  convertAssetToDoor,
  convertDoorToBoard,
  setGlassSpec,
} from "@/app/admin/dasher-boards/actions"
import type { GlassSpecInput } from "@/app/admin/dasher-boards/types"

import {
  acknowledgeIssueAction,
  completeWalkAction,
  getAssetDetailAction,
  reportIssueAction,
  resolveIssueAction,
  saveChecklistResponsesAction,
  startWalkAction,
} from "../../actions"
import { thicknessToFraction, type IssueSeverity } from "../../_lib/compute"
import type {
  ChecklistItemRow,
  DueChecklist,
  IssueRow,
  PerimeterAsset,
  RinkRow,
} from "../../_lib/queries"
import type { Tables } from "@/types/database"
import {
  getPerimeterMeta,
  putPerimeterMeta,
} from "../../_lib/perimeter-cache"

type SubtypeRow = Tables<"dasher_boards_asset_subtypes">
type CategoryRow = Tables<"dasher_boards_issue_categories">

const SELECT_CLASS =
  "border-input bg-background h-10 w-full rounded-md border px-3 py-1 text-sm"

const SEVERITY_LABEL: Record<IssueSeverity, string> = {
  a: "A — Safety critical",
  b: "B — Needs repair",
  c: "C — Cosmetic",
}

function severityBadge(s: IssueSeverity): "destructive" | "warning" {
  return s === "a" ? "destructive" : "warning"
}

export type ConditionMapProps = {
  rink: RinkRow
  assets: PerimeterAsset[]
  openIssues: IssueRow[]
  categories: CategoryRow[]
  doorSubtypes: SubtypeRow[]
  supervisors: Array<{ id: string; name: string }>
  due: DueChecklist | null
  walk: { id: string; startedAt: string } | null
  walkResponses: Record<string, "pass" | "flag">
  walkIssueItemIds: string[]
  employeeId: string | null
  ownerId: string
  can: { submit: boolean; edit: boolean; admin: boolean }
}

type DialogTarget =
  | { kind: "asset"; assetId: string }
  | { kind: "item"; item: ChecklistItemRow }

export function ConditionMap(props: ConditionMapProps) {
  const {
    rink,
    assets,
    openIssues,
    due,
    walk,
    walkResponses,
    walkIssueItemIds,
    can,
    ownerId,
  } = props
  const router = useRouter()
  const { isOnline: online, pendingCount } = useSyncQueue()

  const positioned = useMemo(
    () =>
      assets
        .filter(
          (a) =>
            (a.asset_type === "board_panel" || a.asset_type === "door") &&
            a.is_active &&
            a.sequence_position !== null,
        )
        .sort((a, b) => a.sequence_position! - b.sequence_position!),
    [assets],
  )
  const conditionByAssetId = useMemo(() => {
    const map: Record<string, PerimeterCondition> = {}
    for (const a of assets) {
      if (a.worst_open_severity === "a") map[a.id] = "alert"
      else if (a.worst_open_severity) map[a.id] = "warn"
    }
    return map
  }, [assets])
  const glassByParent = useMemo(() => {
    const map: Record<
      string,
      { id: string; label: string; parentBoardId: string; isActive: boolean; hasSpec: boolean }
    > = {}
    for (const a of assets) {
      if (a.asset_type === "glass_panel" && a.parent_board_id) {
        map[a.parent_board_id] = {
          id: a.id,
          label: a.label,
          parentBoardId: a.parent_board_id,
          isActive: a.is_active,
          hasSpec:
            a.glass_width_in !== null ||
            a.glass_height_in !== null ||
            a.glass_thickness_in !== null,
        }
      }
    }
    return map
  }, [assets])

  const [dialog, setDialog] = useState<DialogTarget | null>(null)
  const [showGlass, setShowGlass] = useState(false)
  // Walk state: the server walk, or a locally-started offline walk awaiting sync.
  const [offlineWalk, setOfflineWalk] = useState(false)
  const activeWalk = walk ?? (offlineWalk ? { id: null, startedAt: null } : null)
  // Local response state so taps feel instant on the boards.
  const [responses, setResponses] = useState(walkResponses)
  // Checklist items flagged + reported this session (offline included).
  const [locallyLinkedItems, setLocallyLinkedItems] = useState<string[]>([])
  const [cacheSavedAt, setCacheSavedAt] = useState<number | null>(null)
  const [walkPending, startWalkTransition] = useTransition()

  // Walk-scoped state must not leak into the NEXT walk (complete one, start
  // another in the same session): re-seed when the server walk id changes.
  const [seenWalkId, setSeenWalkId] = useState(walk?.id ?? null)
  if ((walk?.id ?? null) !== seenWalkId) {
    setSeenWalkId(walk?.id ?? null)
    setResponses(walkResponses)
    setLocallyLinkedItems([])
    setOfflineWalk(false)
  }

  // Stale-data indicator: remember when this rink's data last rendered live.
  useEffect(() => {
    if (online) {
      const savedAt = Date.now()
      void putPerimeterMeta({
        ownerId,
        rinkId: rink.id,
        savedAt,
        assetCount: assets.length,
        openIssueCount: openIssues.length,
      }).then(() => setCacheSavedAt(savedAt))
    } else {
      void getPerimeterMeta(ownerId, rink.id).then((meta) => {
        if (meta) setCacheSavedAt(meta.savedAt)
      })
    }
  }, [online, ownerId, rink.id, assets.length, openIssues.length])

  const dueItems = (due?.items ?? []).filter((i) => i.due)
  const linkedItems = new Set([...walkIssueItemIds, ...locallyLinkedItems])

  function startWalk() {
    startWalkTransition(async () => {
      if (!online) {
        const ok = enqueueSubmission({
          localId: genLocalId(),
          moduleKey: "dasher_boards",
          action: "start_walk",
          payload: { rinkId: rink.id },
        })
        if (ok) {
          setOfflineWalk(true)
          toast.success("Walk started offline — it will sync when you reconnect.")
        } else {
          toast.error("Offline queue unavailable. Reload once online.")
        }
        return
      }
      const r = await startWalkAction(rink.id)
      if (!r.ok) toast.error(r.error)
      else {
        toast.success(r.resumed ? "Resuming your open walk." : "Walk started.")
        router.refresh()
      }
    })
  }

  function completeWalk(notes: string) {
    startWalkTransition(async () => {
      // No server walk id yet (started offline, not yet synced — even if the
      // device is back online, the queue may not have flushed): queue the
      // sign-off too. FIFO replay lands it after start_walk.
      if (!online || !walk) {
        const ok = enqueueSubmission({
          localId: genLocalId(),
          moduleKey: "dasher_boards",
          action: "complete_walk",
          payload: { rinkId: rink.id, notes },
        })
        if (ok) {
          setOfflineWalk(false)
          toast.success(
            "Sign-off queued. It is validated when it syncs — unacknowledged severity-A issues or unanswered due items will reject it.",
          )
          if (online) router.refresh()
        } else {
          toast.error("Offline queue unavailable.")
        }
        return
      }
      const r = await completeWalkAction(walk.id, notes)
      if (!r.ok) toast.error(r.error)
      else {
        toast.success("Walk signed off. Untapped assets are attested OK.")
        router.refresh()
      }
    })
  }

  function answerItem(item: ChecklistItemRow, status: "pass" | "flag") {
    setResponses((cur) => ({ ...cur, [item.id]: status }))
    const persist = async () => {
      // Queue whenever there is no server walk id yet — otherwise an answer
      // given in the online-but-unsynced-walk window would be silently lost.
      if (!online || !walk) {
        const ok = enqueueSubmission({
          localId: genLocalId(),
          moduleKey: "dasher_boards",
          action: "save_responses",
          payload: { rinkId: rink.id, responses: [{ itemId: item.id, status }] },
        })
        if (!ok) toast.error("Offline queue unavailable — answer not saved.")
        return
      }
      const r = await saveChecklistResponsesAction(walk.id, [
        { itemId: item.id, status },
      ])
      if (!r.ok) toast.error(r.error)
    }
    void persist()
    if (status === "flag" && !linkedItems.has(item.id)) {
      setDialog({ kind: "item", item })
    }
  }

  const selectedAssetId = dialog?.kind === "asset" ? dialog.assetId : null

  return (
    <div className="flex flex-col gap-4">
      {(!online || pendingCount > 0) && (
        <div className="bg-warning-soft text-warning-soft-foreground rounded-md border px-3 py-2 text-sm">
          {!online
            ? `Offline — showing data last synced ${
                cacheSavedAt
                  ? new Date(cacheSavedAt).toLocaleTimeString()
                  : "earlier"
              }. Reports queue on this device.`
            : `${pendingCount} queued item(s) syncing…`}
        </div>
      )}

      {/* Walk banner */}
      <Card className="gap-3 py-4">
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle>
                {activeWalk ? "Walk in progress" : "Inspection walk"}
              </CardTitle>
              <CardDescription>
                {activeWalk
                  ? "Tap only the assets with problems — untapped assets are attested OK when you sign off."
                  : "Walk the perimeter and tap problem assets. A signed walk with no issues means all clear."}
              </CardDescription>
            </div>
            {!activeWalk && can.submit && (
              <Button onClick={startWalk} disabled={walkPending}>
                Start walk
              </Button>
            )}
          </div>
        </CardHeader>
        {activeWalk && (
          <CardContent className="flex flex-col gap-4">
            {dueItems.length > 0 && (
              <DuePanel
                dueItems={dueItems}
                responses={responses}
                linkedItems={linkedItems}
                onAnswer={answerItem}
              />
            )}
            <CompleteWalkForm
              pending={walkPending}
              onComplete={completeWalk}
              missingCount={
                dueItems.filter((i) => !responses[i.id]).length
              }
            />
          </CardContent>
        )}
      </Card>

      {/* Diagram */}
      <Card className="gap-3 py-4">
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardDescription>
              Red = open severity A · yellow = open B/C · lime = door
            </CardDescription>
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={showGlass} onCheckedChange={setShowGlass} />
              Glass
            </label>
          </div>
        </CardHeader>
        <CardContent>
          <RinkPerimeter
            className="w-full"
            positioned={positioned.map((a) => ({
              id: a.id,
              label: a.label,
              asset_type: a.asset_type as "board_panel" | "door",
            }))}
            direction={rink.perimeter_direction as "clockwise" | "counterclockwise"}
            glassByParent={glassByParent}
            conditionByAssetId={conditionByAssetId}
            selectedAssetId={selectedAssetId}
            onSelectAsset={(id) => setDialog({ kind: "asset", assetId: id })}
            showGlassLayer={showGlass}
          />
        </CardContent>
      </Card>

      <AssetSheet
        {...props}
        dialog={dialog}
        online={online}
        onClose={() => setDialog(null)}
        onIssueReported={(itemId) => {
          if (itemId) setLocallyLinkedItems((cur) => [...cur, itemId])
          if (online) router.refresh()
        }}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Due-today checklist panel (grouped by cadence)
// ---------------------------------------------------------------------------

function DuePanel({
  dueItems,
  responses,
  linkedItems,
  onAnswer,
}: {
  dueItems: Array<ChecklistItemRow & { due: boolean }>
  responses: Record<string, "pass" | "flag">
  linkedItems: Set<string>
  onAnswer: (item: ChecklistItemRow, status: "pass" | "flag") => void
}) {
  const groups = (["daily", "weekly", "monthly", "yearly"] as const)
    .map((cadence) => ({
      cadence,
      items: dueItems.filter((i) => i.cadence === cadence),
    }))
    .filter((g) => g.items.length > 0)

  return (
    <div className="flex flex-col gap-3 rounded-md border border-dashed p-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold">Due today</span>
        <span className="text-muted-foreground text-xs">
          {dueItems.filter((i) => responses[i.id]).length}/{dueItems.length}{" "}
          answered
        </span>
      </div>
      {groups.map((group) => (
        <div key={group.cadence} className="flex flex-col gap-1.5">
          <span className="text-muted-foreground text-xs font-semibold uppercase tracking-wide">
            {group.cadence}
          </span>
          {group.items.map((item) => {
            const answer = responses[item.id]
            return (
              <div
                key={item.id}
                className="bg-muted/30 flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2"
              >
                <span className="text-sm">{item.label}</span>
                <span className="flex items-center gap-1.5">
                  {answer === "flag" && !linkedItems.has(item.id) && (
                    <Badge variant="warning">needs issue</Badge>
                  )}
                  <Button
                    size="sm"
                    variant={answer === "pass" ? "default" : "outline"}
                    onClick={() => onAnswer(item, "pass")}
                  >
                    Pass
                  </Button>
                  <Button
                    size="sm"
                    variant={answer === "flag" ? "destructive" : "outline"}
                    onClick={() => onAnswer(item, "flag")}
                  >
                    Flag
                  </Button>
                </span>
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}

function CompleteWalkForm({
  pending,
  missingCount,
  onComplete,
}: {
  pending: boolean
  missingCount: number
  onComplete: (notes: string) => void
}) {
  const [notes, setNotes] = useState("")
  return (
    <div className="flex flex-col gap-2">
      <Textarea
        placeholder="Walk notes (optional)…"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        rows={2}
      />
      <Button onClick={() => onComplete(notes)} disabled={pending}>
        {pending ? "Signing off…" : "Complete walk"}
      </Button>
      {missingCount > 0 && (
        <p className="text-muted-foreground text-xs">
          {missingCount} due checklist item(s) still need an answer before
          sign-off.
        </p>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Asset / checklist-item bottom sheet: spec block, open issues, report flow,
// collapsed history.
// ---------------------------------------------------------------------------

function AssetSheet({
  dialog,
  online,
  onClose,
  onIssueReported,
  assets,
  openIssues,
  categories,
  doorSubtypes,
  supervisors,
  can,
}: ConditionMapProps & {
  dialog: DialogTarget | null
  online: boolean
  onClose: () => void
  onIssueReported: (checklistItemId: string | null) => void
}) {
  const asset =
    dialog?.kind === "asset"
      ? (assets.find((a) => a.id === dialog.assetId) ?? null)
      : null
  const item = dialog?.kind === "item" ? dialog.item : null
  const glassChild =
    asset?.asset_type === "board_panel"
      ? (assets.find(
          (a) => a.asset_type === "glass_panel" && a.parent_board_id === asset.id,
        ) ?? null)
      : null
  const specTarget =
    asset?.asset_type === "door"
      ? asset
      : glassChild && glassChild.is_active
        ? glassChild
        : null
  const subtypeLabel = asset?.subtype_id
    ? (doorSubtypes.find((s) => s.id === asset.subtype_id)?.label ?? null)
    : null
  const issuesHere = asset
    ? openIssues.filter(
        (i) => i.asset_id === asset.id || i.asset_id === glassChild?.id,
      )
    : item
      ? openIssues.filter((i) => i.checklist_item_id === item.id)
      : []

  return (
    <Sheet open={dialog !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        side="bottom"
        className="max-h-[85dvh] overflow-y-auto rounded-t-xl px-4 pb-8"
      >
        {dialog && (
          <>
            <SheetHeader className="px-0">
              <SheetTitle className="flex items-center gap-2">
                {asset ? (
                  <>
                    <span className="font-mono">{asset.label}</span>
                    <Badge
                      variant={asset.asset_type === "door" ? "special" : "secondary"}
                    >
                      {asset.asset_type === "door"
                        ? (subtypeLabel ?? "Door")
                        : asset.asset_type === "glass_panel"
                          ? "Glass"
                          : "Board panel"}
                    </Badge>
                  </>
                ) : (
                  <>Checklist item</>
                )}
              </SheetTitle>
              <SheetDescription>
                {asset
                  ? asset.open_count > 0
                    ? `${asset.open_count} open issue(s) on this asset.`
                    : "No open issues."
                  : item?.label}
              </SheetDescription>
            </SheetHeader>

            <div className="flex flex-col gap-4">
              {/* Replacement spec — first thing on screen when glass breaks.
                  Re-keyed by target identity AND type so a board→door
                  conversion with the sheet open never edits stale fields. */}
              {specTarget && (
                <SpecBlock
                  key={`${specTarget.id}:${specTarget.asset_type}`}
                  target={specTarget}
                  canAdmin={can.admin}
                />
              )}

              {/* Door marking — module admins only (post-launch corrections). */}
              {can.admin && asset && asset.asset_type !== "glass_panel" && (
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
                      online={online}
                    />
                  ))}
                </div>
              )}

              {/* Report issue — re-keyed by dialog target so form state never
                  survives a switch to a different asset/item. */}
              {can.submit && (
                <ReportIssueForm
                  key={asset?.id ?? item?.id ?? "none"}
                  asset={asset}
                  glassChild={glassChild}
                  item={item}
                  categories={categories}
                  supervisors={supervisors}
                  online={online}
                  onReported={onIssueReported}
                />
              )}

              {/* Collapsed full history (online only). */}
              {asset && <HistoryBlock assetId={asset.id} online={online} />}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}

function SpecBlock({
  target,
  canAdmin,
}: {
  target: PerimeterAsset
  canAdmin: boolean
}) {
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
      }
    })
  }

  return (
    <div className="bg-muted/30 flex flex-col gap-1.5 rounded-md border p-3">
      <div className="flex items-center justify-between">
        <Label>Replacement spec</Label>
        <span className="flex items-center gap-2">
          {!hasSpec &&
            (canAdmin ? (
              <Badge variant="warning">No spec on file</Badge>
            ) : (
              <span className="text-muted-foreground text-xs">
                No spec on file
              </span>
            ))}
          {canAdmin && (
            <Button variant="ghost" size="sm" onClick={() => setEditing((v) => !v)}>
              {editing ? "Close" : "Edit"}
            </Button>
          )}
        </span>
      </div>
      {editing && canAdmin ? (
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

function OpenIssueRow({
  issue,
  categories,
  canEdit,
  online,
}: {
  issue: IssueRow
  categories: CategoryRow[]
  canEdit: boolean
  online: boolean
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const severity = issue.severity as IssueSeverity
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
      {canEdit && online && (
        <div className="flex gap-2">
          {severity === "a" && !issue.supervisor_ack_at && (
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
          <Button
            size="sm"
            disabled={pending}
            onClick={() => run(() => resolveIssueAction(issue.id), "Resolved.")}
          >
            Resolve
          </Button>
        </div>
      )}
    </div>
  )
}

function ReportIssueForm({
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
