"use client"

import {
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
import { PageHeader } from "@/components/ui/page-header"
import { SectionCard } from "@/components/ui/section-card"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"

import {
  submitDailyReportAction,
  type SubmissionFormState,
} from "../../../actions"

type ChecklistItem = {
  id: string
  label: string
  description: string | null
}

type Props = {
  areaSlug: string
  areaName: string
  areaColor: string | null
  templateId: string
  templateName: string
  areaId: string
  userName: string
  facilityName: string
  items: ChecklistItem[]
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

function subscribeClock(cb: () => void) {
  const id = setInterval(cb, 1000)
  return () => clearInterval(id)
}

export function SubmissionForm({
  areaSlug,
  areaName,
  areaColor,
  templateId,
  templateName,
  areaId,
  userName,
  facilityName,
  items,
}: Props) {
  const [state, formAction] = useActionState(
    submitDailyReportAction,
    initialState
  )

  const [checked, setChecked] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(items.map((i) => [i.id, false]))
  )
  const [note, setNote] = useState("")

  // Area color (e.g. "#6366f1") accents this page so each area reads distinct.
  // Null/blank => fall back to the neutral token styles.
  const accent = areaColor?.trim() || null

  const nowMs = useSyncExternalStore(
    subscribeClock,
    () => Date.now(),
    () => null
  )
  const now = nowMs == null ? null : new Date(nowMs)

  useEffect(() => {
    if (state.error) {
      toast.error(state.error)
    }
  }, [state.error])

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

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <input type="hidden" name="template_id" value={templateId} />
      <input type="hidden" name="area_id" value={areaId} />
      <input type="hidden" name="area_slug" value={areaSlug} />
      <input type="hidden" name="items_json" value={itemsJson} />

      <PageHeader
        variant="display"
        module="daily"
        eyebrow="Staff report"
        title={templateName}
        description={areaName}
      />

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

      <Card
        className="gap-4 py-5"
        style={
          accent ? { borderLeftColor: accent, borderLeftWidth: 4 } : undefined
        }
      >
        <div className="flex flex-col gap-3 px-6">
          <div className="flex items-center justify-between gap-4">
            <h2 className="text-lg font-semibold tracking-tight">Checklist</h2>
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
