"use client"

import { useEffect, useState } from "react"
import { useActionState } from "react"
import { useFormStatus } from "react-dom"
import { toast } from "sonner"

import { FormError } from "@/components/auth/form-error"
import { Button } from "@/components/ui/button"
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

  return (
    <form action={formAction} className="flex flex-col gap-5">
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
          rows={6}
          minLength={1}
          enterKeyHint="done"
          placeholder="Type your message…"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          className="min-h-32 text-base"
        />
      </div>

      <fieldset className="flex flex-col gap-2 rounded-xl border bg-card p-3">
        <legend className="px-1 text-sm font-medium">Recipient groups</legend>
        <p className="text-xs text-muted-foreground">
          Pick one or more groups. We&apos;ll deliver to each member.
        </p>
        <div className="flex flex-col gap-1">
          {groups.map((g) => {
            const checked = groupIds.has(g.id)
            return (
              <label
                key={g.id}
                className="flex min-h-11 cursor-pointer items-start gap-3 rounded-md px-2 py-2 hover:bg-accent/40"
              >
                <input
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

      <SubmitBar />
    </form>
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
      {pending ? "Sending…" : "Send message"}
    </Button>
  )
}
