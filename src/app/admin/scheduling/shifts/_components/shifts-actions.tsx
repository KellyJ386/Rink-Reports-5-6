"use client"

import { useState } from "react"

import { Button } from "@/components/ui/button"

import type { TemplateRow } from "../../_lib/types"
import { ApplyTemplateForm } from "./apply-template-form"
import { PublishButton } from "./publish-button"

type Props = {
  templates: TemplateRow[]
  /** Half-open UTC window [start, end) of the week shown in the grid. */
  weekStartsAtIso: string
  weekEndsAtIso: string
  weekLabel: string
}

/**
 * Action bar above the schedule grid: apply a weekly template (creates draft
 * shifts) and file the two-person publish request for the visible week. This
 * is the live entry point to the publish flow — the grid itself only creates
 * drafts, and drafts are invisible to staff until a second admin approves the
 * publish request.
 */
export function ShiftsActions({
  templates,
  weekStartsAtIso,
  weekEndsAtIso,
  weekLabel,
}: Props) {
  const [showTemplate, setShowTemplate] = useState(false)

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => setShowTemplate((v) => !v)}
        >
          {showTemplate ? "Hide template form" : "Apply template…"}
        </Button>
        <PublishButton
          startsAtIso={weekStartsAtIso}
          endsAtIso={weekEndsAtIso}
          label={`Request publish · ${weekLabel}`}
        />
      </div>
      {showTemplate ? (
        <ApplyTemplateForm
          templates={templates}
          onClose={() => setShowTemplate(false)}
        />
      ) : null}
    </div>
  )
}
