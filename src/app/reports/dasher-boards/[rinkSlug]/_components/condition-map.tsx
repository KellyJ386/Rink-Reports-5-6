"use client"

// The staff-facing Dasher Boards condition map: a tappable perimeter diagram
// where open issues persist on assets until resolved, plus the exception-based
// inspection walk (start → tap problems → answer due checklist → sign off).
// Tapping an asset opens its detail panel in a popover anchored directly on
// that segment (all screen sizes); checklist-item dialogs stay a bottom sheet
// since they open from a list, not a diagram location.

import { useEffect, useMemo, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Footprints } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Popover, PopoverContent } from "@/components/ui/popover"
import { Switch } from "@/components/ui/switch"
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
  completeWalkAction,
  saveAssetCheckAction,
  saveChecklistResponsesAction,
  startWalkAction,
} from "../../actions"
import {
  combineDisplayCondition,
  firstPendingIndex,
  type GuidedStep,
} from "../../_lib/compute"
import {
  AssetDetailPanel,
  OpenIssueRow,
  ReportIssueForm,
} from "./asset-detail-panel"
import { SegmentPopoverAnchor } from "./segment-popover-anchor"
import { GuidedWalk, type GuidedPhase } from "./guided-walk"
import { CompleteWalkForm, DuePanel } from "./walk-panels"
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
    openIssues,
    categories,
    doorSubtypes,
    supervisors,
    due,
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

  const [dialog, setDialog] = useState<DialogTarget | null>(null)
  const [showGlass, setShowGlass] = useState(false)
  // Walk state: the server walk, or a locally-started offline walk awaiting sync.
  const [offlineWalk, setOfflineWalk] = useState(false)
  const activeWalk = walk ?? (offlineWalk ? { id: null, startedAt: null } : null)
  // Local response state so taps feel instant on the boards.
  const [responses, setResponses] = useState(walkResponses)
  // Per-asset Pass/Fail checks, local so taps feel instant.
  const [assetChecks, setAssetChecks] = useState(walkAssetChecks)
  // Checklist items flagged + reported this session (offline included).
  const [locallyLinkedItems, setLocallyLinkedItems] = useState<string[]>([])
  const [cacheSavedAt, setCacheSavedAt] = useState<number | null>(null)
  const [walkPending, startWalkTransition] = useTransition()

  // Guided stepped mode. Position state (phase / index / visited) lives HERE,
  // not in GuidedWalk, so exiting back to the free-tap map and re-entering
  // never loses the user's place. "visited" is the set of positioned assets
  // the user advanced past — implicit passes, tracked locally only (nothing
  // is written to the server per untouched asset; sign-off attests them OK).
  const [guided, setGuided] = useState(false)
  const [guidedPhase, setGuidedPhase] = useState<GuidedPhase>("assets")
  const [guidedIndex, setGuidedIndex] = useState(0)
  const [guidedVisited, setGuidedVisited] = useState<ReadonlySet<string>>(
    () => new Set(),
  )

  // One guided step per positioned board/door; the board's active glass child
  // rides on the same step (fail on either piece fails the step).
  const guidedSteps = useMemo<GuidedStep[]>(
    () =>
      positioned.map((a) => {
        const glass = glassByParent[a.id]
        return { id: a.id, glassChildId: glass?.isActive ? glass.id : null }
      }),
    [positioned, glassByParent],
  )

  // Walk-scoped state must not leak into the NEXT walk (complete one, start
  // another in the same session): re-seed when the server walk id changes.
  const [seenWalkId, setSeenWalkId] = useState(walk?.id ?? null)
  if ((walk?.id ?? null) !== seenWalkId) {
    setSeenWalkId(walk?.id ?? null)
    setResponses(walkResponses)
    setAssetChecks(walkAssetChecks)
    setLocallyLinkedItems([])
    setOfflineWalk(false)
    setGuided(false)
    setGuidedPhase("assets")
    setGuidedIndex(0)
    setGuidedVisited(new Set())
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

  // Enter guided mode, resuming at the first still-pending asset (skipping
  // explicit checks and locally-implicit passes). Nothing pending → straight
  // to the checklist/review phase.
  function enterGuided() {
    if (guidedPhase === "assets") {
      const statusById: Record<string, "pass" | "fail"> = {}
      for (const [id, check] of Object.entries(assetChecks)) {
        statusById[id] = check.status
      }
      const idx = firstPendingIndex(guidedSteps, statusById, guidedVisited)
      if (idx >= guidedSteps.length) {
        setGuidedPhase(dueItems.length > 0 ? "checklist" : "review")
        setGuidedIndex(Math.max(0, guidedSteps.length - 1))
      } else {
        setGuidedIndex(idx)
      }
    }
    setGuided(true)
  }

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
          // Queued sign-off stays on the map (there's no walk id to show a
          // done page for yet); guided mode has nothing left to step through.
          setGuided(false)
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
  const selectedAsset = selectedAssetId
    ? (assets.find((a) => a.id === selectedAssetId) ?? null)
    : null
  const selectedItem = dialog?.kind === "item" ? dialog.item : null

  const positionedLite = useMemo(
    () =>
      positioned.map((a) => ({
        id: a.id,
        label: a.label,
        asset_type: a.asset_type as "board_panel" | "door",
      })),
    [positioned],
  )

  // Zero-size anchor pinned on the selected segment; the popover content
  // positions itself against it. Rendered inside whichever diagram is mounted
  // (free-tap map or guided mode) — only one at a time, so one anchor.
  const segmentAnchor = (
    <SegmentPopoverAnchor
      positioned={positionedLite}
      direction={rink.perimeter_direction as "clockwise" | "counterclockwise"}
      anchorOffsetFraction={rink.perimeter_anchor_offset}
      assetId={selectedAssetId}
    />
  )

  const closeDialog = () => setDialog(null)
  const handleIssueReported = (itemId: string | null) => {
    if (itemId) setLocallyLinkedItems((cur) => [...cur, itemId])
    if (online) router.refresh()
  }

  return (
    <Popover
      open={dialog?.kind === "asset"}
      onOpenChange={(open) => {
        if (!open) closeDialog()
      }}
      modal={false}
    >
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

      {guided && activeWalk ? (
        /* Guided stepped mode: one asset at a time in sequence order, then
           the due checklist, then a review summary + the same sign-off. */
        <GuidedWalk
          rink={rink}
          positioned={positioned}
          steps={guidedSteps}
          glassByParent={glassByParent}
          conditionByAssetId={conditionByAssetId}
          assetChecks={assetChecks}
          dueItems={dueItems}
          responses={responses}
          linkedItems={linkedItems}
          openIssues={openIssues}
          walkId={walk?.id ?? null}
          pending={walkPending}
          phase={guidedPhase}
          index={guidedIndex}
          visited={guidedVisited}
          onPhaseChange={setGuidedPhase}
          onIndexChange={setGuidedIndex}
          onVisit={(id) =>
            setGuidedVisited((prev) => {
              if (prev.has(id)) return prev
              const next = new Set(prev)
              next.add(id)
              return next
            })
          }
          onSaveCheck={saveAssetCheck}
          onAnswerItem={answerItem}
          onOpenAsset={(id) => setDialog({ kind: "asset", assetId: id })}
          onComplete={completeWalk}
          onExit={() => setGuided(false)}
          diagramOverlay={segmentAnchor}
        />
      ) : (
        <>
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
                {can.submit && (
                  <Button variant="outline" onClick={enterGuided}>
                    <Footprints aria-hidden />
                    Guided walk — step through each asset
                  </Button>
                )}
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
                    // Mirror the server sign-off gates: an item is still outstanding
                    // if it's unanswered OR flagged without a linked issue (gate c).
                    dueItems.filter(
                      (i) =>
                        !responses[i.id] ||
                        (responses[i.id] === "flag" && !linkedItems.has(i.id)),
                    ).length
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
                  Red = open severity A · yellow = open B/C · coral = flagged
                  fail (no issue yet) · lime = door
                </CardDescription>
                <label className="flex items-center gap-2 text-sm">
                  <Switch checked={showGlass} onCheckedChange={setShowGlass} />
                  Glass
                </label>
              </div>
            </CardHeader>
            <CardContent>
              <div className="relative">
                <RinkPerimeter
                  className="w-full"
                  positioned={positionedLite}
                  direction={rink.perimeter_direction as "clockwise" | "counterclockwise"}
                  anchorOffsetFraction={rink.perimeter_anchor_offset}
                  glassByParent={glassByParent}
                  conditionByAssetId={conditionByAssetId}
                  selectedAssetId={selectedAssetId}
                  onSelectAsset={(id) => setDialog({ kind: "asset", assetId: id })}
                  showGlassLayer={showGlass}
                />
                {segmentAnchor}
              </div>
            </CardContent>
          </Card>
        </>
      )}

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

    {/* Asset detail, anchored directly on the tapped segment. Non-modal so
        the page still scrolls; Radix flips it below when a top-edge segment
        sits near the viewport top and keeps it inside the viewport. */}
    <PopoverContent
      side="top"
      align="center"
      sideOffset={12}
      collisionPadding={12}
      className="max-h-[min(60dvh,var(--radix-popover-content-available-height))] w-80 max-w-[calc(100vw-2rem)] overflow-y-auto"
    >
      {selectedAsset && (
        <AssetDetailPanel
          asset={selectedAsset}
          assets={assets}
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
      )}
    </PopoverContent>
    </Popover>
  )
}

// DuePanel and CompleteWalkForm live in ./walk-panels.tsx (shared with the
// guided stepped mode in ./guided-walk.tsx); the asset detail blocks live in
// ./asset-detail-panel.tsx (shared between the segment popover and ItemSheet).

// ---------------------------------------------------------------------------
// Checklist-item bottom sheet: open issues on the item + the report flow.
// Items open from the due-checklist list, not a diagram location, so they
// keep the bottom-sheet presentation.
// ---------------------------------------------------------------------------

function ItemSheet({
  item,
  openIssues,
  categories,
  supervisors,
  can,
  online,
  onClose,
  onIssueReported,
}: {
  item: ChecklistItemRow | null
  openIssues: IssueRow[]
  categories: CategoryRow[]
  supervisors: Array<{ id: string; name: string }>
  can: { submit: boolean; edit: boolean; admin: boolean }
  online: boolean
  onClose: () => void
  onIssueReported: (checklistItemId: string | null) => void
}) {
  const issuesHere = item
    ? openIssues.filter((i) => i.checklist_item_id === item.id)
    : []

  return (
    <Sheet open={item !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        side="bottom"
        className="max-h-[85dvh] overflow-y-auto rounded-t-xl px-4 pb-8"
      >
        {item && (
          <>
            <SheetHeader className="px-0">
              <SheetTitle>Checklist item</SheetTitle>
              <SheetDescription>{item.label}</SheetDescription>
            </SheetHeader>

            <div className="flex flex-col gap-4">
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

              {/* Report issue — re-keyed by item so form state never survives
                  a switch to a different item. */}
              {can.submit && (
                <ReportIssueForm
                  key={item.id}
                  asset={null}
                  glassChild={null}
                  item={item}
                  categories={categories}
                  supervisors={supervisors}
                  online={online}
                  onReported={onIssueReported}
                />
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}
