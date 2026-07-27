"use client"

// Checklist-item bottom sheet: open issues on the item + the report flow.
// Items open from the due-checklist list in the walk bar (not a diagram
// location), so they keep the bottom-sheet presentation.

import { Label } from "@/components/ui/label"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"

import type { ChecklistItemRow, IssueRow } from "../../_lib/queries"
import { OpenIssueRow, ReportIssueForm } from "./issue-form"
import type { Tables } from "@/types/database"

type CategoryRow = Tables<"dasher_boards_issue_categories">

export function ItemSheet({
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
