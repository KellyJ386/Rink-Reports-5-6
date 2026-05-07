"use client"

import { useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

import { applyTemplateToWeek } from "../../_lib/admin-core-actions"
import type { TemplateRow } from "../../_lib/types"

type Props = {
  templates: TemplateRow[]
  onClose: () => void
}

export function ApplyTemplateForm({ templates, onClose }: Props) {
  const [pending, start] = useTransition()
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
          <select
            id="template_id"
            name="template_id"
            required
            defaultValue=""
            className="border-input bg-transparent h-9 rounded-md border px-3 text-sm shadow-xs"
          >
            <option value="" disabled>
              Pick a template…
            </option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="week_start">Week start (Sun-anchored)</Label>
          <Input
            id="week_start"
            name="week_start"
            type="date"
            required
          />
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
