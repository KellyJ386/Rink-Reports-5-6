"use client"

import { useEffect, useState } from "react"
import type { FormEvent } from "react"
import { useActionState } from "react"
import { useFormStatus } from "react-dom"
import { toast } from "sonner"

import { FormError } from "@/components/auth/form-error"
import { enqueueSubmission, useSyncQueue } from "@/lib/offline/use-sync-queue"
import { genLocalId } from "@/lib/offline/local-id"
import { Button } from "@/components/ui/button"
import { FieldError } from "@/components/ui/field-error"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { RequiredMark } from "@/components/ui/required-mark"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"

import {
  sendCommunicationsMessage,
  type SendMessageFormState,
} from "../actions"

type GroupOption = {
  id: string
  name: string
  description: string | null
}

type TemplateOption = {
  id: string
  name: string
  subject: string | null
  body: string
  requires_acknowledgement: boolean
}

type Props = {
  groups: GroupOption[]
  templates: TemplateOption[]
}

const initialState: SendMessageFormState = {}

export function ComposeForm({ groups, templates }: Props) {
  const [state, formAction] = useActionState(
    sendCommunicationsMessage,
    initialState
  )

  const { isOnline } = useSyncQueue()
  const [localId] = useState<string>(genLocalId)
  const [queued, setQueued] = useState(false)

  const [templateId, setTemplateId] = useState("")
  const [subject, setSubject] = useState("")
  const [body, setBody] = useState("")
  const [requiresAck, setRequiresAck] = useState(false)
  const [groupIds, setGroupIds] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (state.error) {
      toast.error(state.error)
    }
  }, [state.error])

  useEffect(() => {
    // Move focus to the first invalid field on receipt. group_ids has no
    // single focusable element — focus the first checkbox in the fieldset.
    const firstErrorField = state.fieldErrors
      ? Object.keys(state.fieldErrors)[0]
      : undefined
    if (!firstErrorField) return
    const targetId =
      firstErrorField === "group_ids" ? "group_ids_first" : firstErrorField
    const el = document.getElementById(targetId) as HTMLElement | null
    el?.focus()
  }, [state.fieldErrors])

  function applyTemplate(id: string) {
    setTemplateId(id)
    if (!id) return
    const t = templates.find((t) => t.id === id)
    if (!t) return
    if (t.subject !== null) setSubject(t.subject)
    setBody(t.body)
    setRequiresAck(t.requires_acknowledgement)
  }

  function toggleGroup(id: string) {
    setGroupIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  // Shape the payload the same way the server action's FormData parses
  // (`buildMessageInputFromForm` → `buildMessageInputFromObject`): JSON keys
  // mirror the form field names so the offline replay rebuilds an identical
  // MessageInput.
  function buildPayload(): Record<string, unknown> {
    return {
      subject: subject.trim() || null,
      body: body.trim(),
      requires_acknowledgement: requiresAck,
      template_id: templateId || null,
      group_ids: Array.from(groupIds),
    }
  }

  // Offline submit: queue in the service worker; it replays to /api/offline-sync
  // (which re-runs the same group/permission checks via persistMessage, and
  // resolves admin status from the session) once back online. If the SW isn't
  // controlling the page yet, fall through to the normal action so the network
  // error surfaces instead of silently dropping the message.
  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      // Mirror the action's required-field guard so an empty offline compose
      // still shows inline errors instead of queueing a doomed submission.
      if (body.trim().length === 0 || groupIds.size === 0) return
      const ok = enqueueSubmission({
        localId,
        moduleKey: "communications",
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
      <div className="flex flex-col items-center gap-4 rounded-xl border bg-card px-6 py-8 text-center">
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
          You&apos;re offline, so this message is queued and will send
          automatically once you&apos;re back online. You can keep working.
        </p>
      </div>
    )
  }

  return (
    <form
      action={formAction}
      onSubmit={handleSubmit}
      className="flex flex-col gap-5"
    >
      <FormError message={state.error} />

      {templates.length > 0 ? (
        <div className="flex flex-col gap-2">
          <Label>Use a template (optional)</Label>
          <Select value={templateId || undefined} onValueChange={applyTemplate}>
            <SelectTrigger>
              <SelectValue placeholder="— No template —" />
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
      ) : null}

      <div className="flex flex-col gap-2">
        <Label htmlFor="subject">Subject (optional)</Label>
        <Input
          id="subject"
          name="subject"
          enterKeyHint="next"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          className="h-12 text-base"
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="body">Message<RequiredMark /></Label>
        <Textarea
          id="body"
          name="body"
          required
          aria-invalid={state.fieldErrors?.body ? "true" : undefined}
          aria-describedby={state.fieldErrors?.body ? "body-error" : undefined}
          rows={6}
          minLength={1}
          enterKeyHint="done"
          placeholder="Type your message…"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          className="min-h-32 text-base"
        />
        <FieldError id="body-error" message={state.fieldErrors?.body} />
      </div>

      <fieldset
        className="flex flex-col gap-2 rounded-xl border bg-card p-3"
        aria-invalid={state.fieldErrors?.group_ids ? "true" : undefined}
        aria-describedby={state.fieldErrors?.group_ids ? "group_ids-error" : undefined}
      >
        <legend className="px-1 text-sm font-medium">
          Recipient groups<RequiredMark />
        </legend>
        <p className="text-xs text-muted-foreground">
          Pick one or more groups. We&apos;ll deliver to each member.
        </p>
        <div className="flex flex-col gap-1">
          {groups.map((g, gIdx) => {
            const checked = groupIds.has(g.id)
            return (
              <label
                key={g.id}
                className="flex min-h-11 cursor-pointer items-start gap-3 rounded-md px-2 py-2 hover:bg-accent/40"
              >
                <input
                  id={gIdx === 0 ? "group_ids_first" : undefined}
                  type="checkbox"
                  name="group_ids"
                  value={g.id}
                  checked={checked}
                  onChange={() => toggleGroup(g.id)}
                  className="mt-1 h-4 w-4 rounded border-input"
                />
                <span className="flex flex-col gap-0.5">
                  <span className="text-sm font-medium">{g.name}</span>
                  {g.description ? (
                    <span className="text-xs text-muted-foreground">
                      {g.description}
                    </span>
                  ) : null}
                </span>
              </label>
            )
          })}
        </div>
        <FieldError id="group_ids-error" message={state.fieldErrors?.group_ids} />
      </fieldset>

      <label className="flex min-h-11 items-center gap-3 rounded-xl border bg-card px-3 py-2">
        <input
          type="checkbox"
          name="requires_acknowledgement"
          checked={requiresAck}
          onChange={(e) => setRequiresAck(e.target.checked)}
          className="h-4 w-4 rounded border-input"
        />
        <span className="flex flex-col gap-0.5">
          <span className="text-sm font-medium">Requires acknowledgement</span>
          <span className="text-xs text-muted-foreground">
            Recipients will be asked to acknowledge they read this.
          </span>
        </span>
      </label>

      <SubmitBar isOnline={isOnline} />
    </form>
  )
}

function SubmitBar({ isOnline }: { isOnline: boolean }) {
  const { pending } = useFormStatus()
  const submitLabel = isOnline ? "Send message" : "Save offline"
  return (
    <div className="flex flex-col gap-2">
      <Button
        type="submit"
        size="lg"
        disabled={pending}
        className="h-12 w-full text-base"
      >
        {pending ? "Sending…" : submitLabel}
      </Button>
      {!isOnline ? (
        <p className="text-muted-foreground text-center text-xs">
          You&apos;re offline. This message will be saved on your device and
          sent automatically when you reconnect.
        </p>
      ) : null}
    </div>
  )
}
