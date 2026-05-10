"use client"

import { useActionState, useEffect, useState, useTransition } from "react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
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
import { Textarea } from "@/components/ui/textarea"

import {
  createTemplate,
  deleteTemplate,
  setTemplateActive,
  updateTemplate,
} from "../actions"
import type { ActionState, TemplateRow } from "../types"

const NULL_STATE: ActionState = { ok: null }

export function TemplatesTab({ templates }: { templates: TemplateRow[] }) {
  return (
    <div className="flex flex-col gap-4">
      {templates.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>No templates yet</CardTitle>
            <CardDescription>
              Templates standardise message subject + body so reminders and
              ad-hoc messages stay consistent. Add your first below.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <ul className="flex flex-col gap-2">
          {templates.map((t) => (
            <TemplateRowItem key={t.id} template={t} />
          ))}
        </ul>
      )}
      <TemplateCreateCard />
    </div>
  )
}

function TemplateRowItem({ template }: { template: TemplateRow }) {
  const [editing, setEditing] = useState(false)
  const [state, action, pending] = useActionState(updateTemplate, NULL_STATE)
  const [activePending, startActive] = useTransition()
  const [delPending, startDel] = useTransition()

  useEffect(() => {
    if (state.ok === true) toast.success(state.message ?? "Template updated.")
    if (state.ok === false) toast.error(state.error)
  }, [state])

  function onToggleActive() {
    startActive(async () => {
      const r = await setTemplateActive(template.id, !template.is_active)
      if (!r.ok) toast.error(r.error)
    })
  }
  function onDelete() {
    if (!confirm(`Delete template "${template.name}"?`)) return
    startDel(async () => {
      const r = await deleteTemplate(template.id)
      if (!r.ok) toast.error(r.error)
      else toast.success("Template deleted.")
    })
  }

  return (
    <li className="bg-muted/30 flex flex-col gap-2 rounded-md border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold">{template.name}</span>
          <span className="text-muted-foreground text-xs">
            ({template.slug})
          </span>
          {template.category && (
            <Badge variant="secondary" className="uppercase">
              {template.category}
            </Badge>
          )}
          {template.requires_acknowledgement && (
            <Badge variant="warning" className="uppercase">
              ack required
            </Badge>
          )}
          {!template.is_active && (
            <Badge variant="secondary" className="uppercase">
              off
            </Badge>
          )}
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setEditing((v) => !v)}
          >
            {editing ? "Cancel" : "Edit"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={onToggleActive}
            disabled={activePending}
          >
            {template.is_active ? "Deactivate" : "Activate"}
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={onDelete}
            disabled={delPending}
          >
            Delete
          </Button>
        </div>
      </div>
      {!editing && template.subject && (
        <div className="text-muted-foreground text-xs">
          Subject: {template.subject}
        </div>
      )}
      {!editing && (
        <p className="text-muted-foreground text-sm whitespace-pre-wrap line-clamp-2">
          {template.body}
        </p>
      )}
      {editing && (
        <form action={action} className="flex flex-col gap-3 border-t pt-3">
          <input type="hidden" name="id" value={template.id} />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1">
              <Label htmlFor={`tpl-name-${template.id}`}>Name</Label>
              <Input
                id={`tpl-name-${template.id}`}
                name="name"
                defaultValue={template.name}
                required
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor={`tpl-slug-${template.id}`}>Slug</Label>
              <Input
                id={`tpl-slug-${template.id}`}
                name="slug"
                defaultValue={template.slug}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor={`tpl-cat-${template.id}`}>Category</Label>
              <Input
                id={`tpl-cat-${template.id}`}
                name="category"
                defaultValue={template.category ?? ""}
                placeholder="e.g. safety, ops"
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor={`tpl-subj-${template.id}`}>Subject</Label>
              <Input
                id={`tpl-subj-${template.id}`}
                name="subject"
                defaultValue={template.subject ?? ""}
              />
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor={`tpl-body-${template.id}`}>Body</Label>
            <Textarea
              id={`tpl-body-${template.id}`}
              name="body"
              rows={5}
              defaultValue={template.body}
              required
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="requires_acknowledgement"
              defaultChecked={template.requires_acknowledgement}
            />
            Requires acknowledgement
          </label>
          <div className="flex justify-end">
            <Button type="submit" size="sm" disabled={pending}>
              {pending ? "Saving…" : "Save"}
            </Button>
          </div>
        </form>
      )}
    </li>
  )
}

function TemplateCreateCard() {
  const [state, action, pending] = useActionState(createTemplate, NULL_STATE)
  useEffect(() => {
    if (state.ok === true) toast.success(state.message ?? "Template created.")
    if (state.ok === false) toast.error(state.error)
  }, [state])
  return (
    <Card>
      <CardHeader>
        <CardTitle>Add template</CardTitle>
      </CardHeader>
      <CardContent>
        <form action={action} className="flex flex-col gap-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1">
              <Label htmlFor="new-tpl-name">Name</Label>
              <Input id="new-tpl-name" name="name" required />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="new-tpl-slug">Slug (optional)</Label>
              <Input
                id="new-tpl-slug"
                name="slug"
                placeholder="auto from name"
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="new-tpl-cat">Category</Label>
              <Input
                id="new-tpl-cat"
                name="category"
                placeholder="optional"
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="new-tpl-subj">Subject</Label>
              <Input id="new-tpl-subj" name="subject" placeholder="optional" />
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="new-tpl-body">Body</Label>
            <Textarea id="new-tpl-body" name="body" rows={4} required />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="requires_acknowledgement" />
            Requires acknowledgement
          </label>
          <div className="flex justify-end">
            <Button type="submit" size="sm" disabled={pending}>
              {pending ? "Adding…" : "Add template"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
