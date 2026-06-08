"use client"

import {
  type FormEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react"
import { useActionState } from "react"
import { useFormStatus } from "react-dom"
import { Building2, Calendar, Clock, User } from "lucide-react"
import { toast } from "sonner"

import { FormError } from "@/components/auth/form-error"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { SectionCard } from "@/components/ui/section-card"
import { enqueueSubmission } from "@/lib/offline/use-sync-queue"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { readableForeground } from "@/lib/color-contrast"
import { cn } from "@/lib/utils"

import {
  submitDailyReportAction,
  type SubmissionFormState,
} from "../actions"

export type ConsoleItem = {
  id: string
  label: string
  description: string | null
}

export type ConsoleTemplate = {
  id: string
  name: string
  description: string | null
  items: ConsoleItem[]
}

export type ConsoleArea = {
  id: string
  slug: string
  name: string
  color: string | null
  templates: ConsoleTemplate[]
}

type Props = {
  areas: ConsoleArea[]
  userName: string
  facilityName: string
}

const initialState: SubmissionFormState = {}

function formatDate(d: Date): string {
  return d.toLocaleDateString(undefined, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  })
}

function formatTime(d: Date): string {
  return d.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  })
}

// Live clock via useSyncExternalStore. The snapshot must be CACHED — returning a
// fresh Date.now() on every getSnapshot call makes the store look perpetually
// changed and sends React into an infinite render loop. We mutate `clockNow`
// only inside the interval (alongside the notify callback), so getClockSnapshot
// is stable between ticks. getServerSnapshot is null so SSR shows "—" and there
// is no hydration mismatch.
let clockNow = Date.now()
function subscribeClock(cb: () => void) {
  const id = setInterval(() => {
    clockNow = Date.now()
    cb()
  }, 1000)
  return () => clearInterval(id)
}
function getClockSnapshot(): number {
  return clockNow
}
function getClockServerSnapshot(): number | null {
  return null
}

// Auto-select a shift when the area has exactly one template (mirrors the old
// single-template redirect); otherwise force the "Choose shift type…" prompt.
function defaultTemplateId(area: ConsoleArea | undefined): string {
  return area && area.templates.length === 1 ? area.templates[0]!.id : ""
}

function genLocalId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID()
  }
  return `daily-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export function DailyReportConsole({ areas, userName, facilityName }: Props) {
  const [state, formAction] = useActionState(
    submitDailyReportAction,
    initialState
  )

  const [selectedAreaId, setSelectedAreaId] = useState<string>(
    () => areas[0]?.id ?? ""
  )
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>(() =>
    defaultTemplateId(areas[0])
  )
  const [checked, setChecked] = useState<Record<string, boolean>>({})
  const [note, setNote] = useState("")
  const [localId] = useState<string>(genLocalId)
  const [queued, setQueued] = useState(false)

  const selectedArea =
    areas.find((a) => a.id === selectedAreaId) ?? areas[0]
  const templates = selectedArea?.templates ?? []
  const selectedTemplate =
    templates.find((t) => t.id === selectedTemplateId) ?? null
  const items = useMemo(
    () => selectedTemplate?.items ?? [],
    [selectedTemplate]
  )

  const nowMs = useSyncExternalStore(
    subscribeClock,
    getClockSnapshot,
    getClockServerSnapshot
  )
  const now = nowMs == null ? null : new Date(nowMs)

  useEffect(() => {
    if (state.error) {
      toast.error(state.error)
    }
  }, [state.error])

  function handleAreaChange(areaId: string) {
    setSelectedAreaId(areaId)
    setSelectedTemplateId(defaultTemplateId(areas.find((a) => a.id === areaId)))
    setChecked({})
  }

  function handleTemplateChange(templateId: string) {
    // Ignore the spurious empty callback Radix Select fires when its item set
    // changes on area switch — it would otherwise clobber an auto-selected shift.
    if (!templateId) return
    setSelectedTemplateId(templateId)
    setChecked({})
  }

  const itemsJson = useMemo(() => {
    return JSON.stringify(
      items.map((i) => ({
        checklist_item_id: i.id,
        label_snapshot: i.label,
        is_checked: !!checked[i.id],
      }))
    )
  }, [items, checked])

  const checkedCount = useMemo(
    () => items.reduce((n, i) => n + (checked[i.id] ? 1 : 0), 0),
    [items, checked]
  )
  const pct =
    items.length === 0 ? 0 : Math.round((checkedCount / items.length) * 100)

  // Area color (e.g. "#6366f1") accents the checklist so each area reads
  // distinct. Null/blank => fall back to neutral token styles.
  const accent = selectedArea?.color?.trim() || null

  // Serialize the current selection into the SAME shape buildInputFromPayload
  // parses (template/area identifiers + checklist item results + note). The
  // replay endpoint runs the same area/template/permission checks online.
  function buildPayload(): Record<string, unknown> {
    return {
      template_id: selectedTemplateId,
      area_id: selectedArea?.id ?? "",
      area_slug: selectedArea?.slug ?? "",
      note: note.trim(),
      items: items.map((i) => ({
        checklist_item_id: i.id,
        label_snapshot: i.label,
        is_checked: !!checked[i.id],
      })),
    }
  }

  // Offline submit: queue in the service worker; it replays to /api/offline-sync
  // (which runs the same area/template/permission checks) once back online. If
  // the SW isn't controlling the page yet, fall through to the normal action so
  // the network error surfaces instead of silently dropping the report.
  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      const ok = enqueueSubmission({
        localId,
        moduleKey: "daily_reports",
        action: "submit",
        payload: buildPayload(),
      })
      if (ok) {
        e.preventDefault()
        setQueued(true)
      }
    }
  }

  if (queued) {
    return (
      <Card className="gap-4 py-8">
        <div className="flex flex-col items-center gap-4 px-6 text-center">
          <div
            aria-hidden
            className="bg-primary/10 text-primary flex h-14 w-14 items-center justify-center rounded-full"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={3}
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-7 w-7"
            >
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
          <h2 className="text-xl font-semibold tracking-tight">
            Saved on this device
          </h2>
          <p className="text-muted-foreground text-sm">
            You&apos;re offline, so this report is queued and will submit
            automatically once you&apos;re back online — the same checks run
            then. You can keep working.
          </p>
        </div>
      </Card>
    )
  }

  return (
    <form
      action={formAction}
      onSubmit={handleSubmit}
      className="flex flex-col gap-5"
    >
      <input type="hidden" name="template_id" value={selectedTemplateId} />
      <input type="hidden" name="area_id" value={selectedArea?.id ?? ""} />
      <input type="hidden" name="area_slug" value={selectedArea?.slug ?? ""} />
      <input type="hidden" name="items_json" value={itemsJson} />

      <SectionCard
        as="div"
        className="flex-row flex-wrap items-center gap-x-3 gap-y-2 p-4 text-sm"
      >
        <MetaChip icon={<User className="h-4 w-4" aria-hidden />}>
          {userName}
        </MetaChip>
        <MetaChip icon={<Building2 className="h-4 w-4" aria-hidden />}>
          {facilityName}
        </MetaChip>
        <MetaChip icon={<Calendar className="h-4 w-4" aria-hidden />}>
          {now ? formatDate(now) : "—"}
        </MetaChip>
        <MetaChip icon={<Clock className="h-4 w-4" aria-hidden />}>
          {now ? formatTime(now) : "—"}
        </MetaChip>
      </SectionCard>

      <FormError message={state.error} />

      {/* Select Work Area — compact, single-select pill tabs */}
      <Card className="gap-4 py-5">
        <h2 className="px-6 text-lg font-semibold tracking-tight">
          Select Work Area
        </h2>
        <div
          className="flex flex-wrap gap-2 px-6"
          role="radiogroup"
          aria-label="Work area"
        >
          {areas.map((area) => {
            const color = area.color?.trim() || null
            const selected = area.id === selectedArea?.id
            const fg = color ? readableForeground(color) : null
            return (
              <button
                key={area.id}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => handleAreaChange(area.id)}
                className={cn(
                  "inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium outline-none transition-colors ring-offset-background focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                  !color &&
                    (selected
                      ? "border-transparent bg-primary text-primary-foreground"
                      : "border-border bg-card text-foreground hover:bg-accent/40"),
                  color && !selected && "bg-card text-foreground hover:opacity-90"
                )}
                style={
                  color
                    ? selected
                      ? { backgroundColor: color, color: fg!, borderColor: color }
                      : { borderColor: color }
                    : undefined
                }
              >
                <span
                  aria-hidden
                  className="flex size-4 shrink-0 items-center justify-center rounded-full border-2 border-current"
                >
                  {selected ? (
                    <span className="size-2 rounded-full bg-current" />
                  ) : null}
                </span>
                {area.name}
              </button>
            )
          })}
        </div>
      </Card>

      {/* Select Shift — shift-type dropdown for the selected area */}
      <Card className="gap-4 py-5">
        <h2 className="px-6 text-lg font-semibold tracking-tight">
          Select Shift
        </h2>
        <div className="px-6">
          <Select
            key={selectedArea?.id ?? "none"}
            value={selectedTemplateId}
            onValueChange={handleTemplateChange}
            disabled={templates.length === 0}
          >
            <SelectTrigger className="h-12 text-base">
              <SelectValue
                placeholder={
                  templates.length === 0
                    ? "No shifts available"
                    : "Choose shift type…"
                }
              />
            </SelectTrigger>
            <SelectContent>
              {templates.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </Card>

      {/* Checklist + note + submit — revealed once a shift is chosen */}
      {selectedTemplate ? (
        <>
          <Card
            className="gap-4 py-5"
            style={
              accent
                ? { borderLeftColor: accent, borderLeftWidth: 4 }
                : undefined
            }
          >
            <div className="flex flex-col gap-3 px-6">
              <div className="flex items-center justify-between gap-4">
                <h2 className="text-lg font-semibold tracking-tight">
                  Checklist
                </h2>
                {items.length > 0 ? (
                  <span className="text-sm font-medium tabular-nums text-muted-foreground">
                    {checkedCount} / {items.length} complete
                  </span>
                ) : null}
              </div>
              {items.length > 0 ? (
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: `${pct}%`,
                      backgroundColor: accent ?? "var(--primary)",
                    }}
                  />
                </div>
              ) : null}
            </div>
            <div className="px-6">
              {items.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No checklist items on this template. You can still submit.
                </p>
              ) : (
                <ul className="flex flex-col divide-y divide-border rounded-lg border bg-background">
                  {items.map((item) => {
                    const isChecked = !!checked[item.id]
                    return (
                      <li key={item.id}>
                        <label
                          className={cn(
                            "flex cursor-pointer items-start gap-4 px-4 py-4 transition-colors",
                            isChecked && !accent && "bg-accent/40"
                          )}
                          style={
                            isChecked && accent
                              ? { backgroundColor: `${accent}14` }
                              : undefined
                          }
                        >
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={(e) =>
                              setChecked((prev) => ({
                                ...prev,
                                [item.id]: e.target.checked,
                              }))
                            }
                            className={cn(
                              "mt-1 size-6 shrink-0 cursor-pointer rounded border-input",
                              !accent && "accent-primary"
                            )}
                            style={accent ? { accentColor: accent } : undefined}
                          />
                          <span className="flex flex-col gap-1">
                            <span className="text-base font-medium leading-tight">
                              {item.label}
                            </span>
                            {item.description ? (
                              <span className="text-sm text-muted-foreground">
                                {item.description}
                              </span>
                            ) : null}
                          </span>
                        </label>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          </Card>

          <Card className="gap-3 py-5">
            <div className="flex flex-col gap-2 px-6">
              <label htmlFor="note" className="text-sm font-medium">
                Note (optional)
              </label>
              <Textarea
                id="note"
                name="note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={4}
                inputMode="text"
                enterKeyHint="done"
                placeholder="Anything to flag for managers?"
              />
            </div>
          </Card>

          <SubmitBar />
        </>
      ) : (
        <Card className="py-8">
          <p className="px-6 text-sm text-muted-foreground">
            Choose a shift type to see its checklist.
          </p>
        </Card>
      )}
    </form>
  )
}

function MetaChip({
  icon,
  children,
}: {
  icon: ReactNode
  children: ReactNode
}) {
  return (
    <span className="flex items-center gap-2 text-muted-foreground">
      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-muted text-muted-foreground">
        {icon}
      </span>
      <span className="font-medium text-foreground">{children}</span>
    </span>
  )
}

function SubmitBar() {
  const { pending } = useFormStatus()
  return (
    <Button
      type="submit"
      size="lg"
      disabled={pending}
      className="h-12 w-full text-base"
    >
      {pending ? "Submitting…" : "Submit"}
    </Button>
  )
}
