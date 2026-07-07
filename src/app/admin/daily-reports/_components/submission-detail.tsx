"use client"

import Link from "next/link"
import { useActionState, useEffect, useState, useTransition } from "react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Textarea } from "@/components/ui/textarea"

import {
  addAdminNote,
  deleteNote,
  deleteSubmission,
  toggleSubmissionItem,
  updateNote,
} from "../actions"
import { formatInTz } from "@/lib/timezone"

import type { ActionState, SubmissionDetail } from "../types"

type Props = {
  detail: SubmissionDetail
  /** Search params string to keep on the back link, minus `submission`. */
  backHref: string
  /** Facility IANA timezone; timestamps render as facility wall-clock. */
  timezone: string | null
}

const NOTE_INITIAL: ActionState = { ok: null }

export function SubmissionDetailPanel({ detail, backHref, timezone }: Props) {
  const fmt = (ts: string) => formatInTz(ts, timezone)
  const { submission, area, template, employee, items, notes } = detail
  const [noteState, noteAction, notePending] = useActionState(
    addAdminNote,
    NOTE_INITIAL,
  )
  const [pendingItem, setPendingItem] = useState<string | null>(null)
  const [pendingNote, setPendingNote] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null)
  const [editingNoteBody, setEditingNoteBody] = useState("")
  const [, startTransition] = useTransition()

  useEffect(() => {
    if (noteState && "ok" in noteState && noteState.ok === false) {
      toast.error(noteState.error)
    }
  }, [noteState])

  function onToggleItem(itemId: string, next: boolean) {
    setPendingItem(itemId)
    startTransition(async () => {
      const r = await toggleSubmissionItem(itemId, next)
      if (!r.ok) toast.error(r.error)
      setPendingItem(null)
    })
  }

  function onDeleteSubmission() {
    if (
      !window.confirm(
        "Delete this submission? Items and notes will be removed. Cannot be undone.",
      )
    ) {
      return
    }
    setDeleting(true)
    startTransition(async () => {
      const r = await deleteSubmission(submission.id)
      if (!r.ok) toast.error(r.error)
      setDeleting(false)
    })
  }

  function onSaveNote(noteId: string) {
    setPendingNote(noteId)
    startTransition(async () => {
      const r = await updateNote(noteId, editingNoteBody)
      if (!r.ok) toast.error(r.error)
      else setEditingNoteId(null)
      setPendingNote(null)
    })
  }

  function onDeleteNote(noteId: string) {
    if (!window.confirm("Delete this note?")) return
    setPendingNote(noteId)
    startTransition(async () => {
      const r = await deleteNote(noteId)
      if (!r.ok) toast.error(r.error)
      setPendingNote(null)
    })
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              {area?.color && (
                <span
                  aria-hidden
                  className="inline-block size-3 rounded-full"
                  style={{ backgroundColor: area.color }}
                />
              )}
              <CardTitle>
                {area?.name ?? "Area?"} · {template?.name ?? "Template?"}
              </CardTitle>
            </div>
            <p className="text-muted-foreground text-sm">
              Submitted {fmt(submission.submitted_at)} by{" "}
              {employee
                ? `${employee.first_name} ${employee.last_name}`
                : "Unknown"}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button asChild variant="outline" size="sm">
              <Link href={backHref}>Back to list</Link>
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={onDeleteSubmission}
              disabled={deleting}
            >
              {deleting ? "Deleting…" : "Delete submission"}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold">Checklist</h3>
          {items.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              No items recorded on this submission.
            </p>
          ) : (
            <ul className="divide-y rounded-md border">
              {items.map((it) => {
                const isPending = pendingItem === it.id
                return (
                  <li
                    key={it.id}
                    className="flex items-center gap-3 px-3 py-2"
                  >
                    <input
                      type="checkbox"
                      checked={it.is_checked}
                      disabled={isPending}
                      onChange={(e) => onToggleItem(it.id, e.target.checked)}
                      className="border-input size-4 rounded border"
                    />
                    <span
                      className={
                        it.is_checked
                          ? "text-foreground"
                          : "text-muted-foreground line-through"
                      }
                    >
                      {it.label_snapshot}
                    </span>
                  </li>
                )
              })}
            </ul>
          )}
        </section>

        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold">
            Notes ({notes.length})
          </h3>
          {notes.length === 0 ? (
            <p className="text-muted-foreground text-sm">No notes yet.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {notes.map((n) => {
                const editing = editingNoteId === n.id
                const isPending = pendingNote === n.id
                return (
                  <li
                    key={n.id}
                    className="bg-muted/30 flex flex-col gap-1 rounded-md border p-3"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 text-xs">
                        <span className="font-medium">
                          {n.author
                            ? `${n.author.first_name} ${n.author.last_name}`
                            : "Unknown"}
                        </span>
                        {n.is_admin_note && (
                          <Badge variant="info">Admin</Badge>
                        )}
                        <span className="text-muted-foreground">
                          {fmt(n.created_at)}
                        </span>
                      </div>
                      <div className="flex items-center gap-1">
                        {!editing && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setEditingNoteId(n.id)
                              setEditingNoteBody(n.body)
                            }}
                            disabled={isPending}
                          >
                            Edit
                          </Button>
                        )}
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => onDeleteNote(n.id)}
                          disabled={isPending}
                        >
                          Delete
                        </Button>
                      </div>
                    </div>
                    {editing ? (
                      <div className="flex flex-col gap-2">
                        <Textarea
                          value={editingNoteBody}
                          onChange={(e) =>
                            setEditingNoteBody(e.target.value)
                          }
                          rows={3}
                        />
                        <div className="flex justify-end gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => setEditingNoteId(null)}
                            disabled={isPending}
                          >
                            Cancel
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            onClick={() => onSaveNote(n.id)}
                            disabled={isPending}
                          >
                            {isPending ? "Saving…" : "Save"}
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <p className="text-sm whitespace-pre-wrap">{n.body}</p>
                    )}
                  </li>
                )
              })}
            </ul>
          )}

          <form
            action={noteAction}
            className="bg-background mt-2 flex flex-col gap-2 rounded-md border p-3"
            // Reset textarea after a successful submit by remounting with key.
            key={
              noteState && "ok" in noteState && noteState.ok === true
                ? `note-${notes.length}`
                : "note-pending"
            }
          >
            <input
              type="hidden"
              name="submission_id"
              value={submission.id}
            />
            <label
              htmlFor="note-body"
              className="text-sm font-medium"
            >
              Add admin note
            </label>
            <Textarea
              id="note-body"
              name="body"
              required
              rows={3}
              placeholder="Visible to admins; staff can see it on the report."
            />
            <div className="flex justify-end">
              <Button type="submit" size="sm" disabled={notePending}>
                {notePending ? "Adding…" : "Add note"}
              </Button>
            </div>
          </form>
        </section>
      </CardContent>
    </Card>
  )
}
