"use client"

// The single-screen Dasher Boards field tool: a tappable perimeter diagram
// where open issues persist on assets until resolved. Tap any asset → bottom
// sheet → report the failure. No walk required — the inspection walk is an
// opt-in overlay (see walk-bar.tsx): start it from the toolbar, keep tapping
// the same map, then sign off to attest "everything I didn't tap is OK"
// (the exception-based model the schema documents).
//
// The due checklist is its own lightweight view (due-card.tsx), independent
// of the walk. Answering an item with no walk open silently resumes/creates
// today's inspection as the response container (the schema stores responses
// per inspection); the walk bar stays the single sign-off surface.

import { useEffect, useMemo, useRef, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Footprints, Search, X } from "lucide-react"
import { toast } from "sonner"

import { LocalDateTime } from "@/components/app/local-datetime"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { RinkPerimeter } from "@/components/rink/rink-perimeter"
import type { PerimeterCondition } from "@/components/rink/rink-perimeter"
import { enqueueSubmission, useSyncQueue } from "@/lib/offline/use-sync-queue"
import { genLocalId } from "@/lib/offline/local-id"

import {
  completeWalkAction,
  saveAssetCheckAction,
  saveChecklistResponsesAction,
  startWalkAction,
} from "../../actions"
import { combineDisplayCondition } from "../../_lib/compute"
import { matchingSegmentIds } from "../../_lib/display-label"
import { AssetSheet } from "./asset-sheet"
import { DueCard } from "./due-card"
import { ItemSheet } from "./item-sheet"
import { WalkBar } from "./walk-bar"
import type {
  ChecklistItemRow,
  DueChecklist,
  InspectionStatus,
  IssueRow,
  PerimeterAsset,
  RinkRow,
} from "../../_lib/queries"
import type { Tables } from "@/types/database"
import { getPerimeterMeta, putPerimeterMeta } from "../../_lib/perimeter-cache"

type SubtypeRow = Tables<"dasher_boards_asset_subtypes">
type CategoryRow = Tables<"dasher_boards_issue_categories">

export type ConditionMapProps = {
  rink: RinkRow
  assets: PerimeterAsset[]
  /**
   * The rink's own glass numbers, keyed by position id AND glass id. Empty
   * when the facility hasn't configured numbering — the UI then shows the
   * permanent G-labels, as it always has.
   */
  glassNumbers: Record<string, string>
  openIssues: IssueRow[]
  categories: CategoryRow[]
  doorSubtypes: SubtypeRow[]
  supervisors: Array<{ id: string; name: string }>
  due: DueChecklist | null
  status: InspectionStatus | null
  walk: { id: string; startedAt: string } | null
  walkResponses: Record<string, "pass" | "flag">
  walkIssueItemIds: string[]
  walkAssetChecks: Record<string, { status: "pass" | "fail"; note: string | null }>
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
    glassNumbers,
    openIssues,
    categories,
    doorSubtypes,
    supervisors,
    due,
    status,
    walk,
    walkResponses,
    walkIssueItemIds,
    walkAssetChecks,
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
      const condition = combineDisplayCondition({
        worstOpenSeverity: a.worst_open_severity,
        latestCheckStatus: a.latest_check_status,
      })
      if (condition) map[a.id] = condition
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
            a.glass_thickness_in !== null ||
            a.glass_material !== null,
        }
      }
    }
    return map
  }, [assets])

  // Search — matches labels + aliases across positions AND their glass
  // children (matchingSegmentIds' documented contract), so an alias on a
  // glass row ("the Zam gate glass") lights up the board position it rides,
  // since glass has no segment of its own on the diagram.
  const [query, setQuery] = useState("")
  const glassParentOf = useMemo(() => {
    const map = new Map<string, string>()
    for (const a of assets) {
      if (a.asset_type === "glass_panel" && a.parent_board_id) {
        map.set(a.id, a.parent_board_id)
      }
    }
    return map
  }, [assets])
  const highlightedIds = useMemo(() => {
    if (!query.trim()) return undefined
    const rawMatches = matchingSegmentIds(assets, query, glassNumbers)
    const ids = new Set<string>()
    for (const id of rawMatches) {
      ids.add(glassParentOf.get(id) ?? id)
    }
    return ids
  }, [assets, query, glassNumbers, glassParentOf])
  const matchCount = highlightedIds?.size ?? 0

  const [dialog, setDialog] = useState<DialogTarget | null>(null)
  const [showGlass, setShowGlass] = useState(false)
  // Walk state: the server walk, or a locally-started offline walk awaiting sync.
  const [offlineWalk, setOfflineWalk] = useState(false)
  const activeWalk = walk ?? (offlineWalk ? { id: null, startedAt: null } : null)
  // Local response state so taps feel instant.
  const [responses, setResponses] = useState(walkResponses)
  // Per-asset Pass/Fail checks, local so taps feel instant.
  const [assetChecks, setAssetChecks] = useState(walkAssetChecks)
  // Checklist items flagged + reported this session (offline included).
  const [locallyLinkedItems, setLocallyLinkedItems] = useState<string[]>([])
  const [cacheSavedAt, setCacheSavedAt] = useState<number | null>(null)
  const [walkPending, startWalkTransition] = useTransition()
  // Inspection auto-created as the container for checklist answers given
  // outside an explicit walk (until router.refresh delivers it as `walk`).
  const [autoWalkId, setAutoWalkId] = useState<string | null>(null)
  const startInFlight = useRef<Promise<string | null> | null>(null)

  // Walk-scoped state must not leak into the NEXT walk (complete one, start
  // another in the same session): re-seed when the server walk id changes.
  const [seenWalkId, setSeenWalkId] = useState(walk?.id ?? null)
  if ((walk?.id ?? null) !== seenWalkId) {
    setSeenWalkId(walk?.id ?? null)
    setResponses(walkResponses)
    setAssetChecks(walkAssetChecks)
    setLocallyLinkedItems([])
    setOfflineWalk(false)
    setAutoWalkId(null)
  }

  function saveAssetCheck(
    assetId: string,
    status: "pass" | "fail",
    note: string | null,
  ) {
    const trimmed = note?.trim() ? note.trim() : null
    // Optimistic — the check reflects instantly on the boards.
    setAssetChecks((prev) => ({ ...prev, [assetId]: { status, note: trimmed } }))
    startWalkTransition(async () => {
      if (!online || !walk) {
        const ok = enqueueSubmission({
          localId: genLocalId(),
          moduleKey: "dasher_boards",
          action: "save_asset_check",
          payload: { rinkId: rink.id, assetId, status, note: trimmed },
        })
        if (ok) toast.success("Check saved offline — it will sync.")
        else toast.error("Offline queue unavailable. Reload once online.")
        return
      }
      const r = await saveAssetCheckAction(walk.id, assetId, status, trimmed)
      if (!r.ok) toast.error(r.error)
      else toast.success(status === "pass" ? "Marked pass." : "Marked fail.")
      router.refresh()
    })
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
        router.push(`/reports/dasher-boards/${rink.slug}/done?id=${walk.id}`)
      }
    })
  }

  // The checklist doesn't require a walk: answers need an inspection row as
  // their container (schema), so the first answer outside an explicit walk
  // resumes/creates today's inspection quietly. Deduped so two quick answers
  // never race two creates (the server resumes the open walk anyway).
  async function ensureWalkId(): Promise<string | null> {
    if (walk) return walk.id
    if (autoWalkId) return autoWalkId
    if (!startInFlight.current) {
      startInFlight.current = startWalkAction(rink.id).then((r) => {
        startInFlight.current = null
        if (!r.ok) {
          toast.error(r.error)
          return null
        }
        setAutoWalkId(r.inspectionId)
        return r.inspectionId
      })
    }
    return startInFlight.current
  }

  function answerItem(item: ChecklistItemRow, status: "pass" | "flag") {
    setResponses((cur) => ({ ...cur, [item.id]: status }))
    const persist = async () => {
      // Offline, or an offline-started walk not yet flushed: queue. The
      // container walk is queued once too — FIFO replay creates it before
      // the answers land on it.
      if (!online || offlineWalk) {
        if (!activeWalk) {
          const started = enqueueSubmission({
            localId: genLocalId(),
            moduleKey: "dasher_boards",
            action: "start_walk",
            payload: { rinkId: rink.id },
          })
          if (!started) {
            toast.error("Offline queue unavailable — answer not saved.")
            return
          }
          setOfflineWalk(true)
        }
        const ok = enqueueSubmission({
          localId: genLocalId(),
          moduleKey: "dasher_boards",
          action: "save_responses",
          payload: { rinkId: rink.id, responses: [{ itemId: item.id, status }] },
        })
        if (!ok) toast.error("Offline queue unavailable — answer not saved.")
        return
      }
      const walkId = await ensureWalkId()
      if (!walkId) return
      const r = await saveChecklistResponsesAction(walkId, [
        { itemId: item.id, status },
      ])
      if (!r.ok) toast.error(r.error)
      else router.refresh()
    }
    void persist()
    if (status === "flag" && !linkedItems.has(item.id)) {
      setDialog({ kind: "item", item })
    }
  }

  const selectedAsset =
    dialog?.kind === "asset"
      ? (assets.find((a) => a.id === dialog.assetId) ?? null)
      : null
  const selectedItem = dialog?.kind === "item" ? dialog.item : null

  const positionedLite = useMemo(
    () =>
      positioned.map((a) => ({
        id: a.id,
        label: a.label,
        asset_type: a.asset_type as "board_panel" | "door",
        custom_label: a.custom_label,
        aliases: a.aliases,
        out_of_service: a.out_of_service,
      })),
    [positioned],
  )

  const closeDialog = () => setDialog(null)
  const handleIssueReported = (itemId: string | null) => {
    if (itemId) setLocallyLinkedItems((cur) => [...cur, itemId])
    if (online) router.refresh()
  }

  // Mirror the server sign-off gates: an item is still outstanding if it's
  // unanswered OR flagged without a linked issue (gate c).
  const missingCount = dueItems.filter(
    (i) =>
      !responses[i.id] ||
      (responses[i.id] === "flag" && !linkedItems.has(i.id)),
  ).length

  return (
    <div className="flex flex-col gap-4">
      {(!online || pendingCount > 0) && (
        <div className="bg-warning-soft text-warning-soft-foreground rounded-md border px-3 py-2 text-sm">
          {!online ? (
            <>
              Offline — showing data last synced{" "}
              {cacheSavedAt ? (
                <LocalDateTime
                  iso={new Date(cacheSavedAt).toISOString()}
                  format="time"
                  placeholder="earlier"
                />
              ) : (
                "earlier"
              )}
              . Reports queue on this device.
            </>
          ) : (
            `${pendingCount} queued item(s) syncing…`
          )}
        </div>
      )}

      {/* Toolbar: walk status line + the opt-in walk as a secondary action. */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-muted-foreground text-sm">
          {status?.lastCompletedAt ? (
            <>
              Last walked{" "}
              <LocalDateTime iso={status.lastCompletedAt} format="date" />
              {status.lastInspectorName ? ` by ${status.lastInspectorName}` : ""}.
            </>
          ) : (
            "No completed walks yet."
          )}
          {status && !status.walkedToday && " Due today."}
        </p>
        {!activeWalk && can.submit && (
          <Button
            variant="outline"
            size="sm"
            onClick={startWalk}
            disabled={walkPending}
          >
            <Footprints aria-hidden />
            Start inspection walk
          </Button>
        )}
      </div>

      {/* Diagram — the whole tool. Tap an asset to log, walk or no walk. */}
      <Card className="gap-3 py-4">
        <CardHeader className="gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardDescription>
              Red = open severity A · yellow = open B/C · coral = flagged fail
              (no issue yet) · lime = door · dashed + × = out of service
            </CardDescription>
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={showGlass} onCheckedChange={setShowGlass} />
              Glass
            </label>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[180px] flex-1">
              <Search
                className="text-muted-foreground pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2"
                aria-hidden
              />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") setQuery("")
                }}
                placeholder="Search segments or aliases…"
                aria-label="Search segments or aliases"
                className="h-9 pl-8 pr-8"
              />
              {query && (
                <button
                  type="button"
                  aria-label="Clear search"
                  className="text-muted-foreground hover:text-foreground absolute right-2 top-1/2 -translate-y-1/2"
                  onClick={() => setQuery("")}
                >
                  <X className="size-4" />
                </button>
              )}
            </div>
            {query.trim() !== "" && (
              <span className="text-muted-foreground whitespace-nowrap text-xs">
                {matchCount} of {positioned.length}
              </span>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <RinkPerimeter
            className="w-full"
            positioned={positionedLite}
            direction={rink.perimeter_direction as "clockwise" | "counterclockwise"}
            anchorOffsetFraction={rink.perimeter_anchor_offset}
            glassByParent={glassByParent}
            glassNumberByAssetId={glassNumbers}
            conditionByAssetId={conditionByAssetId}
            selectedAssetId={selectedAsset?.id ?? null}
            onSelectAsset={(id) => setDialog({ kind: "asset", assetId: id })}
            highlightedIds={highlightedIds}
            showGlassLayer={showGlass}
            zoomable
          />
        </CardContent>
      </Card>

      {/* Due checklist — its own view, walk or no walk. */}
      {can.submit && dueItems.length > 0 && (
        <DueCard
          dueItems={dueItems}
          responses={responses}
          linkedItems={linkedItems}
          onAnswer={answerItem}
        />
      )}

      {/* Persistent walk companion — only while a walk is open. */}
      {activeWalk && (
        <WalkBar
          startedAt={walk?.startedAt ?? null}
          synced={!!walk}
          dueItems={dueItems}
          responses={responses}
          missingCount={missingCount}
          pending={walkPending}
          onComplete={completeWalk}
        />
      )}

      <AssetSheet
        asset={selectedAsset}
        assets={assets}
        glassNumbers={glassNumbers}
        openIssues={openIssues}
        categories={categories}
        doorSubtypes={doorSubtypes}
        supervisors={supervisors}
        can={can}
        online={online}
        walkActive={!!activeWalk}
        assetChecks={assetChecks}
        checkPending={walkPending}
        onSaveCheck={saveAssetCheck}
        onIssueReported={handleIssueReported}
        onClose={closeDialog}
      />

      <ItemSheet
        item={selectedItem}
        openIssues={openIssues}
        categories={categories}
        supervisors={supervisors}
        can={can}
        online={online}
        onClose={closeDialog}
        onIssueReported={handleIssueReported}
      />
    </div>
  )
}
