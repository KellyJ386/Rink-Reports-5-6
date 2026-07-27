"use client"

// Guided stepped walk mode for the Dasher Boards inspection — the ice-depth
// style flow (step through points with Save & Next, then review) applied to
// the perimeter: one board/door position at a time in sequence order, with a
// big Pass / Fail choice per step, then the due checklist, then a review
// summary before the existing sign-off.
//
// IMPLICIT PASS is the core rule: advancing past an untouched asset marks it
// "implicit" locally/visually ONLY — nothing is written to the server per
// asset. Explicit Pass/Fail taps use the exact same saveAssetCheck plumbing
// as the free-tap map, and the sign-off's "untapped assets are attested OK"
// semantics are unchanged. All step/summary math lives in _lib/compute.ts
// (guidedStepStatus / summarizeGuidedWalk / firstPendingIndex).

import { useMemo, useState, type ReactNode } from "react"
import { ArrowLeft, ArrowRight, X } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Textarea } from "@/components/ui/textarea"
import { RinkPerimeter } from "@/components/rink/rink-perimeter"
import type {
  PerimeterCondition,
  RinkPerimeterGlass,
} from "@/components/rink/rink-perimeter"

import {
  guidedStepStatus,
  summarizeGuidedWalk,
  type AssetCheckStatus,
  type GuidedStep,
  type GuidedStepStatus,
  type IssueSeverity,
} from "../../_lib/compute"
import type {
  ChecklistItemRow,
  IssueRow,
  PerimeterAsset,
  RinkRow,
} from "../../_lib/queries"
import { CompleteWalkForm, DuePanel } from "./walk-panels"

export type GuidedPhase = "assets" | "checklist" | "review"

export type GuidedWalkProps = {
  rink: RinkRow
  /** Positioned boards/doors in sequence order (the map's `positioned` memo). */
  positioned: PerimeterAsset[]
  /** One guided step per positioned asset, same order. */
  steps: GuidedStep[]
  glassByParent: Record<string, RinkPerimeterGlass>
  conditionByAssetId: Record<string, PerimeterCondition>
  assetChecks: Record<string, { status: AssetCheckStatus; note: string | null }>
  dueItems: Array<ChecklistItemRow & { due: boolean }>
  responses: Record<string, "pass" | "flag">
  linkedItems: Set<string>
  openIssues: IssueRow[]
  /** Server walk id (null while an offline-started walk awaits sync). */
  walkId: string | null
  pending: boolean
  // Guided position state is lifted to ConditionMap so exiting back to the
  // free-tap map and re-entering never loses the user's place.
  phase: GuidedPhase
  index: number
  visited: ReadonlySet<string>
  onPhaseChange: (phase: GuidedPhase) => void
  onIndexChange: (index: number) => void
  onVisit: (assetId: string) => void
  onSaveCheck: (
    assetId: string,
    status: AssetCheckStatus,
    note: string | null,
  ) => void
  onAnswerItem: (item: ChecklistItemRow, status: "pass" | "flag") => void
  /** Opens the segment-anchored asset detail (notes / issue reporting). */
  onOpenAsset: (assetId: string) => void
  onComplete: (notes: string) => void
  onExit: () => void
  /**
   * Rendered inside a `relative` wrapper around the rink diagram — the
   * condition map passes the segment popover anchor through here so the
   * asset detail popover can pin to the tapped segment in guided mode too.
   */
  diagramOverlay?: ReactNode
}

function StepStatusBadge({ status }: { status: GuidedStepStatus }) {
  switch (status) {
    case "pass":
      return <Badge variant="success">Pass</Badge>
    case "fail":
      return <Badge variant="destructive">Fail</Badge>
    case "implicit":
      return <Badge variant="neutral">Implicit pass</Badge>
    default:
      return <Badge variant="outline">Unchecked</Badge>
  }
}

export function GuidedWalk({
  rink,
  positioned,
  steps,
  glassByParent,
  conditionByAssetId,
  assetChecks,
  dueItems,
  responses,
  linkedItems,
  openIssues,
  walkId,
  pending,
  phase,
  index,
  visited,
  onPhaseChange,
  onIndexChange,
  onVisit,
  onSaveCheck,
  onAnswerItem,
  onOpenAsset,
  onComplete,
  onExit,
  diagramOverlay,
}: GuidedWalkProps) {
  const checkStatusById = useMemo(() => {
    const map: Record<string, AssetCheckStatus> = {}
    for (const [id, check] of Object.entries(assetChecks)) {
      map[id] = check.status
    }
    return map
  }, [assetChecks])

  const summary = useMemo(
    () => summarizeGuidedWalk(steps, checkStatusById),
    [steps, checkStatusById],
  )
  const doneCount = useMemo(
    () =>
      steps.filter(
        (s) => guidedStepStatus(s, checkStatusById, visited) !== "pending",
      ).length,
    [steps, checkStatusById, visited],
  )

  const total = steps.length
  const currentAsset = phase === "assets" ? (positioned[index] ?? null) : null
  const hasChecklist = dueItems.length > 0

  function advance() {
    const asset = positioned[index]
    if (asset) onVisit(asset.id)
    if (index >= total - 1) {
      onPhaseChange(hasChecklist ? "checklist" : "review")
    } else {
      onIndexChange(index + 1)
    }
  }

  function goBack() {
    if (phase === "review") {
      if (hasChecklist) onPhaseChange("checklist")
      else if (total > 0) {
        onPhaseChange("assets")
        onIndexChange(total - 1)
      }
      return
    }
    if (phase === "checklist") {
      if (total > 0) {
        onPhaseChange("assets")
        onIndexChange(total - 1)
      }
      return
    }
    if (index > 0) onIndexChange(index - 1)
  }

  const backDisabled =
    phase === "assets"
      ? index <= 0
      : phase === "checklist"
        ? total === 0
        : !hasChecklist && total === 0

  const stepLabel =
    phase === "assets"
      ? total > 0
        ? `${Math.min(index + 1, total)} of ${total}`
        : "No positioned assets"
      : phase === "checklist"
        ? "Due checklist"
        : "Review & sign off"

  // Same outstanding-items gate the free-tap map mirrors from the server:
  // unanswered, or flagged without a linked issue.
  const missingCount = dueItems.filter(
    (i) =>
      !responses[i.id] ||
      (responses[i.id] === "flag" && !linkedItems.has(i.id)),
  ).length

  return (
    <div className="flex flex-col gap-4">
      {/* Guided header: progress + exit. */}
      <Card className="gap-3 py-4">
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle>Guided walk</CardTitle>
              <CardDescription>{stepLabel}</CardDescription>
            </div>
            <Button variant="ghost" size="sm" onClick={onExit}>
              <X aria-hidden />
              Exit to map
            </Button>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-1.5">
          <div
            role="progressbar"
            aria-label="Assets stepped"
            aria-valuemin={0}
            aria-valuemax={total}
            aria-valuenow={doneCount}
            aria-valuetext={`${doneCount} of ${total} assets stepped`}
            className="bg-muted h-1.5 w-full overflow-hidden rounded-full"
          >
            <div
              aria-hidden
              className="bg-primary h-full rounded-full transition-[width] duration-300"
              style={{
                width: `${total > 0 ? Math.max((doneCount / total) * 100, 2) : 100}%`,
              }}
            />
          </div>
          <p className="text-muted-foreground text-xs">
            {doneCount} of {total} assets stepped ·{" "}
            {summary.explicitPass + summary.fail} explicitly checked
          </p>
        </CardContent>
      </Card>

      {/* Rink diagram stays visible; the current asset is highlighted via the
          selection halo. Tapping a segment jumps the guided pointer there. */}
      <Card className="gap-3 py-4">
        <CardHeader>
          <CardDescription>
            {phase === "assets"
              ? "The highlighted segment is the asset you're on. Tap any segment to jump to it."
              : "Perimeter overview."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="relative">
            <RinkPerimeter
              className="w-full"
              positioned={positioned.map((a) => ({
                id: a.id,
                label: a.label,
                asset_type: a.asset_type as "board_panel" | "door",
              }))}
              direction={
                rink.perimeter_direction as "clockwise" | "counterclockwise"
              }
              anchorOffsetFraction={rink.perimeter_anchor_offset}
              glassByParent={glassByParent}
              conditionByAssetId={conditionByAssetId}
              selectedAssetId={currentAsset?.id ?? null}
              onSelectAsset={(id) => {
                const idx = positioned.findIndex((a) => a.id === id)
                if (idx < 0) return
                onPhaseChange("assets")
                onIndexChange(idx)
              }}
            />
            {diagramOverlay}
          </div>
        </CardContent>
      </Card>

      {phase === "assets" &&
        (currentAsset ? (
          <GuidedStepCard
            key={currentAsset.id}
            asset={currentAsset}
            glass={glassByParent[currentAsset.id]}
            status={
              steps[index]
                ? guidedStepStatus(steps[index], checkStatusById, visited)
                : "pending"
            }
            existingNote={assetChecks[currentAsset.id]?.note ?? null}
            pending={pending}
            isLast={index >= total - 1}
            backDisabled={backDisabled}
            onPass={(note) => {
              onSaveCheck(currentAsset.id, "pass", note)
              advance()
            }}
            onFail={(note) => {
              onSaveCheck(currentAsset.id, "fail", note)
              onVisit(currentAsset.id)
              onOpenAsset(currentAsset.id)
            }}
            onNext={advance}
            onBack={goBack}
            onOpenDetails={() => onOpenAsset(currentAsset.id)}
          />
        ) : (
          <Card className="gap-3 py-4">
            <CardContent className="flex flex-col gap-3">
              <p className="text-muted-foreground text-sm">
                No positioned boards or doors on this rink yet.
              </p>
              <Button
                onClick={() =>
                  onPhaseChange(hasChecklist ? "checklist" : "review")
                }
              >
                Continue
                <ArrowRight aria-hidden />
              </Button>
            </CardContent>
          </Card>
        ))}

      {phase === "checklist" && (
        <Card className="gap-3 py-4">
          <CardHeader>
            <CardTitle>Due checklist</CardTitle>
            <CardDescription>
              Answer today&apos;s items, then continue to review.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <DuePanel
              dueItems={dueItems}
              responses={responses}
              linkedItems={linkedItems}
              onAnswer={onAnswerItem}
            />
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={goBack}
                disabled={backDisabled}
              >
                <ArrowLeft aria-hidden />
                Back
              </Button>
              <Button className="flex-1" onClick={() => onPhaseChange("review")}>
                Continue to review
                <ArrowRight aria-hidden />
              </Button>
            </div>
            {missingCount > 0 && (
              <p className="text-muted-foreground text-xs">
                {missingCount} item(s) still outstanding — sign-off will be
                rejected until they&apos;re answered (flags need a reported
                issue).
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {phase === "review" && (
        <GuidedReview
          positioned={positioned}
          steps={steps}
          checkStatusById={checkStatusById}
          visited={visited}
          summary={summary}
          assetChecks={assetChecks}
          dueItems={dueItems}
          responses={responses}
          openIssues={openIssues}
          walkId={walkId}
          pending={pending}
          missingCount={missingCount}
          onJumpToAsset={(idx) => {
            onPhaseChange("assets")
            onIndexChange(idx)
          }}
          onBack={goBack}
          backDisabled={backDisabled}
          onComplete={onComplete}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// One asset step: big Pass / Fail, optional note, Back / Next navigation.
// ---------------------------------------------------------------------------

function GuidedStepCard({
  asset,
  glass,
  status,
  existingNote,
  pending,
  isLast,
  backDisabled,
  onPass,
  onFail,
  onNext,
  onBack,
  onOpenDetails,
}: {
  asset: PerimeterAsset
  glass: RinkPerimeterGlass | undefined
  status: GuidedStepStatus
  existingNote: string | null
  pending: boolean
  isLast: boolean
  backDisabled: boolean
  onPass: (note: string | null) => void
  onFail: (note: string | null) => void
  onNext: () => void
  onBack: () => void
  onOpenDetails: () => void
}) {
  const [note, setNote] = useState(existingNote ?? "")
  const trimmedNote = note.trim() ? note.trim() : null
  const coversGlass = glass?.isActive ?? false

  return (
    <Card className="gap-3 py-4">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2">
            <span className="font-mono">{asset.label}</span>
            <Badge
              variant={asset.asset_type === "door" ? "special" : "secondary"}
            >
              {asset.asset_type === "door" ? "Door" : "Board panel"}
            </Badge>
          </CardTitle>
          <StepStatusBadge status={status} />
        </div>
        <CardDescription>
          {coversGlass
            ? `Check the board and its glass (${glass!.label}) together. Use Details to check the glass separately or report an issue.`
            : asset.open_count > 0
              ? `${asset.open_count} open issue(s) on this asset.`
              : "Pass, fail, or skip ahead — untouched assets count as pass at sign-off."}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
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
            variant={status === "pass" ? "default" : "outline"}
            className="h-12 flex-1 text-base"
            disabled={pending}
            onClick={() => onPass(trimmedNote)}
          >
            Pass
          </Button>
          <Button
            type="button"
            variant={status === "fail" ? "destructive" : "outline"}
            className="h-12 flex-1 text-base"
            disabled={pending}
            onClick={() => onFail(trimmedNote)}
          >
            Fail
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={onBack}
            disabled={backDisabled}
            aria-label="Previous asset"
          >
            <ArrowLeft aria-hidden />
            Back
          </Button>
          <Button
            type="button"
            variant="secondary"
            className="flex-1"
            onClick={onNext}
          >
            {isLast ? "Continue" : "Next"}
            <ArrowRight aria-hidden />
          </Button>
        </div>
        <div className="flex items-center justify-between gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={onOpenDetails}>
            Details &amp; report issue
          </Button>
          <p className="text-muted-foreground text-xs">
            Skipping ahead counts this asset as pass.
          </p>
        </div>
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Review: summary counts, fails, issues reported this walk, checklist
// answers, then the existing sign-off form.
// ---------------------------------------------------------------------------

function GuidedReview({
  positioned,
  steps,
  checkStatusById,
  visited,
  summary,
  assetChecks,
  dueItems,
  responses,
  openIssues,
  walkId,
  pending,
  missingCount,
  onJumpToAsset,
  onBack,
  backDisabled,
  onComplete,
}: {
  positioned: PerimeterAsset[]
  steps: GuidedStep[]
  checkStatusById: Record<string, AssetCheckStatus>
  visited: ReadonlySet<string>
  summary: ReturnType<typeof summarizeGuidedWalk>
  assetChecks: Record<string, { status: AssetCheckStatus; note: string | null }>
  dueItems: Array<ChecklistItemRow & { due: boolean }>
  responses: Record<string, "pass" | "flag">
  openIssues: IssueRow[]
  walkId: string | null
  pending: boolean
  missingCount: number
  onJumpToAsset: (index: number) => void
  onBack: () => void
  backDisabled: boolean
  onComplete: (notes: string) => void
}) {
  const failedSteps = steps
    .map((step, idx) => ({ step, idx }))
    .filter(
      ({ step }) => guidedStepStatus(step, checkStatusById, visited) === "fail",
    )
  const assetById = new Map(positioned.map((a) => [a.id, a]))
  // Issues attributable to this walk. Offline-reported issues (and issues on
  // a not-yet-synced offline walk) aren't in the server snapshot yet.
  const walkIssues = walkId
    ? openIssues.filter((i) => i.inspection_id === walkId)
    : []

  return (
    <Card className="gap-3 py-4">
      <CardHeader>
        <CardTitle>Review &amp; sign off</CardTitle>
        <CardDescription>
          Everything you didn&apos;t flag counts as pass when you sign off.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {/* Counts */}
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant="success">{summary.explicitPass} passed</Badge>
          <Badge variant={summary.fail > 0 ? "destructive" : "neutral"}>
            {summary.fail} failed
          </Badge>
          <Badge variant="neutral">
            {summary.implicitPass} implicitly passed
          </Badge>
        </div>

        {/* Failed assets */}
        {failedSteps.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-semibold">Failed this walk</span>
            {failedSteps.map(({ step, idx }) => {
              const asset = assetById.get(step.id)
              const note =
                assetChecks[step.id]?.note ??
                (step.glassChildId
                  ? (assetChecks[step.glassChildId]?.note ?? null)
                  : null)
              return (
                <button
                  key={step.id}
                  type="button"
                  onClick={() => onJumpToAsset(idx)}
                  className="bg-muted/30 hover:bg-muted/50 flex flex-col items-start gap-0.5 rounded-md border px-3 py-2 text-left"
                >
                  <span className="flex items-center gap-2 text-sm">
                    <span className="font-mono">{asset?.label ?? "?"}</span>
                    <Badge variant="destructive">Fail</Badge>
                  </span>
                  {note && (
                    <span className="text-muted-foreground text-xs">{note}</span>
                  )}
                </button>
              )
            })}
          </div>
        )}

        {/* Issues reported this walk */}
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-semibold">
            Issues reported this walk
          </span>
          {walkIssues.length === 0 ? (
            <p className="text-muted-foreground text-xs">
              {walkId
                ? "None reported."
                : "Walk not synced yet — issues will attach when it syncs."}
            </p>
          ) : (
            walkIssues.map((issue) => (
              <div
                key={issue.id}
                className="bg-muted/30 flex flex-col gap-0.5 rounded-md border px-3 py-2"
              >
                <span className="flex items-center gap-2">
                  <Badge
                    variant={
                      (issue.severity as IssueSeverity) === "a"
                        ? "destructive"
                        : "warning"
                    }
                  >
                    {(issue.severity as string).toUpperCase()}
                  </Badge>
                  <span className="text-sm">{issue.description}</span>
                </span>
              </div>
            ))
          )}
        </div>

        {/* Checklist answers */}
        {dueItems.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-semibold">Checklist answers</span>
            {dueItems.map((item) => {
              const answer = responses[item.id]
              return (
                <div
                  key={item.id}
                  className="bg-muted/30 flex items-center justify-between gap-2 rounded-md border px-3 py-2"
                >
                  <span className="text-sm">{item.label}</span>
                  {answer === "pass" ? (
                    <Badge variant="success">Pass</Badge>
                  ) : answer === "flag" ? (
                    <Badge variant="warning">Flagged</Badge>
                  ) : (
                    <Badge variant="outline">Unanswered</Badge>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {/* Sign-off (same behavior as the map's form). */}
        <CompleteWalkForm
          pending={pending}
          missingCount={missingCount}
          onComplete={onComplete}
        />
        <Button
          type="button"
          variant="ghost"
          onClick={onBack}
          disabled={backDisabled}
        >
          <ArrowLeft aria-hidden />
          Back
        </Button>
      </CardContent>
    </Card>
  )
}
