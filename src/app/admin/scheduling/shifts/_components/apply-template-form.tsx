"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

import { applyTemplateToWeek } from "../../_lib/admin-core-actions"
import { DAY_NAMES } from "../../_lib/datetime"
import type { TemplateRow } from "../../_lib/types"

type Props = {
  templates: TemplateRow[]
  /** Facility week start, 0=Sunday..6=Saturday (schedule_settings). */
  weekStartDay: number
  /** Facility-local "YYYY-MM-DD" of the currently visible week's start. */
  defaultWeekStartKey: string
  onClose: () => void
}

export function ApplyTemplateForm({
  templates,
  weekStartDay,
  defaultWeekStartKey,
  onClose,
}: Props) {
  const [pending, start] = useTransition()
  const [templateId, setTemplateId] = useState("")
  const router = useRouter()

  function onSubmit(formData: FormData) {
    const templateId = String(formData.get("template_id") ?? "")
    const weekStart = String(formData.get("week_start") ?? "")
    if (!templateId) {
      toast.error("Pick a template.")
      return
    }
    if (!weekStart) {
      toast.error("Pick a week-start date.")
      return
    }
    start(async () => {
      const res = await applyTemplateToWeek(templateId, weekStart)
      if (res.ok === true) {
        toast.success(res.message ?? "Template applied.")
        onClose()
        router.refresh()
      } else if (res.ok === false) {
        toast.error(res.error)
      }
    })
  }

  return (
    <form
      action={onSubmit}
      className="bg-card flex flex-col gap-3 rounded-md border p-4 shadow-sm"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="template_id">Template</Label>
          <input type="hidden" name="template_id" value={templateId} />
          <Select
            value={templateId || undefined}
            onValueChange={(v) => setTemplateId(v)}
          >
            <SelectTrigger id="template_id">
              <SelectValue placeholder="Pick a template…" />
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
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="week_start">
            Week starting ({DAY_NAMES[((weekStartDay % 7) + 7) % 7]})
          </Label>
          <Input
            id="week_start"
            name="week_start"
            type="date"
            defaultValue={defaultWeekStartKey}
            required
          />
          <p className="text-muted-foreground text-xs">
            Any date snaps back to that week&apos;s {DAY_NAMES[((weekStartDay % 7) + 7) % 7]}.
          </p>
        </div>
      </div>
      <div className="flex items-center justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={onClose}
          disabled={pending}
        >
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? "Applying…" : "Apply template"}
        </Button>
      </div>
      {templates.length === 0 && (
        <p className="text-muted-foreground text-xs">
          No active templates. Create one from the Templates tab first.
        </p>
      )}
    </form>
  )
}
