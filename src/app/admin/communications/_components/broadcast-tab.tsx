"use client"

import { useActionState, useEffect, useState } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"

import { sendAdminBroadcast } from "../actions"
import type { ActionState, GroupRow, TemplateRow } from "../types"

type RoleOption = { id: string; key: string; display_name: string }

type Props = {
  groups: GroupRow[]
  templates: TemplateRow[]
  roles: RoleOption[]
}

type Scope = "groups" | "role" | "everyone"

const NULL_STATE: ActionState = { ok: null }

export function BroadcastTab({ groups, templates, roles }: Props) {
  const [state, action, pending] = useActionState(sendAdminBroadcast, NULL_STATE)

  const [scope, setScope] = useState<Scope>("groups")
  const [templateId, setTemplateId] = useState("")
  const [subject, setSubject] = useState("")
  const [body, setBody] = useState("")
  const [requiresAck, setRequiresAck] = useState(false)
  const [roleId, setRoleId] = useState("")
  const [groupIds, setGroupIds] = useState<Set<string>>(new Set())

  // Clear the composer after a successful send. Render-phase derived-state
  // reset (not an effect): compare against the last handled action state.
  const [handledState, setHandledState] = useState<ActionState>(NULL_STATE)
  if (state !== handledState) {
    setHandledState(state)
    if (state.ok === true) {
      setTemplateId("")
      setSubject("")
      setBody("")
      setRequiresAck(false)
      setGroupIds(new Set())
    }
  }

  useEffect(() => {
    if (state.ok === true) toast.success(state.message ?? "Broadcast sent.")
    if (state.ok === false) toast.error(state.error)
  }, [state])

  function applyTemplate(id: string) {
    setTemplateId(id)
    const t = templates.find((t) => t.id === id)
    if (!t) return
    if (t.subject !== null) setSubject(t.subject)
    setBody(t.body)
    setRequiresAck(t.requires_acknowledgement)
  }

  function toggleGroup(id: string) {
    setGroupIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Broadcast a message</CardTitle>
        <CardDescription>
          Delivered to each recipient&apos;s in-app inbox and by email (the
          same pipeline staff sends use). Recipients can be groups, everyone
          holding a role, or the whole facility.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={action} className="flex flex-col gap-4">
          {templates.length > 0 ? (
            <div className="flex flex-col gap-1">
              <Label>Use a template (optional)</Label>
              <input type="hidden" name="template_id" value={templateId} />
              <Select
                value={templateId || undefined}
                onValueChange={applyTemplate}
              >
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

          <div className="flex flex-col gap-1">
            <Label htmlFor="bc-subject">Subject (optional)</Label>
            <Input
              id="bc-subject"
              name="subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
            />
          </div>

          <div className="flex flex-col gap-1">
            <Label htmlFor="bc-body">Message</Label>
            <Textarea
              id="bc-body"
              name="body"
              required
              rows={6}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Type your announcement…"
              className="min-h-32"
            />
          </div>

          <fieldset className="flex flex-col gap-2 rounded-md border p-3">
            <legend className="px-1 text-sm font-medium">Send to</legend>
            <input type="hidden" name="scope" value={scope} />
            <div className="flex flex-wrap gap-4">
              {(
                [
                  ["groups", "Groups"],
                  ["role", "Everyone with a role"],
                  ["everyone", "Whole facility"],
                ] as const
              ).map(([value, label]) => (
                <label
                  key={value}
                  className="inline-flex items-center gap-2 text-sm"
                >
                  <input
                    type="radio"
                    name="scope_choice"
                    checked={scope === value}
                    onChange={() => setScope(value)}
                  />
                  {label}
                </label>
              ))}
            </div>

            {scope === "groups" ? (
              groups.length === 0 ? (
                <p className="text-muted-foreground text-sm">
                  No active groups — create one in the Groups tab, or pick
                  another scope.
                </p>
              ) : (
                <div className="flex flex-col gap-1">
                  {groups.map((g) => (
                    <label
                      key={g.id}
                      className="hover:bg-accent/40 flex min-h-9 cursor-pointer items-center gap-3 rounded-md px-2 py-1.5"
                    >
                      <input
                        type="checkbox"
                        name="group_ids"
                        value={g.id}
                        checked={groupIds.has(g.id)}
                        onChange={() => toggleGroup(g.id)}
                        className="border-input h-4 w-4 rounded"
                      />
                      <span className="text-sm">{g.name}</span>
                    </label>
                  ))}
                </div>
              )
            ) : null}

            {scope === "role" ? (
              <div className="flex flex-col gap-1">
                <Label>Role</Label>
                <input type="hidden" name="role_id" value={roleId} />
                <Select
                  value={roleId || undefined}
                  onValueChange={(v) => setRoleId(v)}
                >
                  <SelectTrigger className="max-w-xs">
                    <SelectValue placeholder="Pick a role" />
                  </SelectTrigger>
                  <SelectContent>
                    {roles.map((r) => (
                      <SelectItem key={r.id} value={r.id}>
                        {r.display_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}

            {scope === "everyone" ? (
              <p className="text-muted-foreground text-sm">
                Every active employee in this facility receives the message.
              </p>
            ) : null}
          </fieldset>

          <label className="flex min-h-9 items-center gap-3 rounded-md border px-3 py-2">
            <input
              type="checkbox"
              name="requires_acknowledgement"
              checked={requiresAck}
              onChange={(e) => setRequiresAck(e.target.checked)}
              className="border-input h-4 w-4 rounded"
            />
            <span className="flex flex-col gap-0.5">
              <span className="text-sm font-medium">
                Requires acknowledgement
              </span>
              <span className="text-muted-foreground text-xs">
                Recipients are asked to acknowledge they read it; you can track
                acks from the Inbox → Messages view.
              </span>
            </span>
          </label>

          <div>
            <Button type="submit" disabled={pending}>
              {pending ? "Sending…" : "Send broadcast"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
