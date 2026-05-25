"use client"

import { useActionState, useEffect, useState, useTransition } from "react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

import {
  createRink,
  deleteRink,
  setRinkActive,
  setRinkDefault,
  updateRink,
} from "../actions"
import type { ActionState, RinkWithLayoutCount } from "../types"

const NULL_STATE: ActionState = { ok: null }

export function RinksTab({ rinks }: { rinks: RinkWithLayoutCount[] }) {
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_20rem]">
      <Card>
        <CardHeader>
          <CardTitle>Rinks</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {rinks.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              No rinks yet. Create one on the right, then add diagrams to it on
              the Diagrams tab.
            </p>
          ) : (
            rinks.map((r) => <RinkRowCard key={r.id} rink={r} />)
          )}
        </CardContent>
      </Card>
      <div className="flex flex-col gap-3">
        <CreateRinkCard />
      </div>
    </div>
  )
}

function RinkRowCard({ rink }: { rink: RinkWithLayoutCount }) {
  const [editing, setEditing] = useState(false)
  const [state, action, pending] = useActionState(updateRink, NULL_STATE)
  const [activePending, startActive] = useTransition()
  const [defaultPending, startDefault] = useTransition()
  const [delPending, startDel] = useTransition()

  useEffect(() => {
    if (state.ok === true) toast.success(state.message ?? "Rink updated.")
    if (state.ok === false) toast.error(state.error)
  }, [state])

  function onToggleActive() {
    startActive(async () => {
      const r = await setRinkActive(rink.id, !rink.is_active)
      if (!r.ok) toast.error(r.error)
    })
  }

  function onMakeDefault() {
    startDefault(async () => {
      const r = await setRinkDefault(rink.id)
      if (!r.ok) toast.error(r.error)
      else toast.success(`${rink.name} is now the default rink.`)
    })
  }

  function onDelete() {
    if (rink.layout_count > 0) {
      toast.error("Move or delete this rink's diagrams first.")
      return
    }
    if (!confirm(`Delete rink "${rink.name}"?`)) return
    startDel(async () => {
      const r = await deleteRink(rink.id)
      if (!r.ok) toast.error(r.error)
      else toast.success("Rink deleted.")
    })
  }

  return (
    <div className="rounded-md border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <div className="flex items-center gap-2">
            <span className="font-medium">{rink.name}</span>
            {rink.is_default && (
              <Badge variant="default" className="uppercase">
                default
              </Badge>
            )}
            {!rink.is_active && (
              <Badge variant="secondary" className="uppercase">
                inactive
              </Badge>
            )}
          </div>
          <span className="text-muted-foreground font-mono text-xs">
            {rink.slug} · {rink.active_layout_count}/{rink.layout_count} diagrams
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setEditing((v) => !v)}
          >
            {editing ? "Cancel" : "Rename"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={onMakeDefault}
            disabled={defaultPending || rink.is_default || !rink.is_active}
          >
            {rink.is_default ? "Default" : "Make default"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={onToggleActive}
            disabled={activePending}
          >
            {rink.is_active ? "Deactivate" : "Activate"}
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
      {editing && (
        <form
          action={action}
          className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3"
        >
          <input type="hidden" name="id" value={rink.id} />
          <div className="flex flex-col gap-1">
            <Label htmlFor={`rn-${rink.id}`}>Name</Label>
            <Input
              id={`rn-${rink.id}`}
              name="name"
              defaultValue={rink.name}
              required
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor={`rs-${rink.id}`}>Slug</Label>
            <Input id={`rs-${rink.id}`} name="slug" defaultValue={rink.slug} />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor={`ro-${rink.id}`}>Sort order</Label>
            <Input
              id={`ro-${rink.id}`}
              name="sort_order"
              type="number"
              defaultValue={rink.sort_order}
            />
          </div>
          <div className="sm:col-span-3">
            <Button type="submit" size="sm" disabled={pending}>
              {pending ? "Saving…" : "Save rink"}
            </Button>
          </div>
        </form>
      )}
    </div>
  )
}

function CreateRinkCard() {
  const [state, action, pending] = useActionState(createRink, NULL_STATE)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (state.ok === true) toast.success(state.message ?? "Rink created.")
    if (state.ok === false) toast.error(state.error)
  }, [state])

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle>New rink</CardTitle>
          <Button
            size="sm"
            variant={open ? "outline" : "default"}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? "Cancel" : "New"}
          </Button>
        </div>
      </CardHeader>
      {open && (
        <CardContent>
          <form action={action} className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <Label htmlFor="nr-name">Name</Label>
              <Input
                id="nr-name"
                name="name"
                required
                placeholder="e.g. Main Rink"
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="nr-slug">
                Slug{" "}
                <span className="text-muted-foreground font-normal">
                  (optional)
                </span>
              </Label>
              <Input id="nr-slug" name="slug" placeholder="auto from name" />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="nr-sort">Sort order</Label>
              <Input
                id="nr-sort"
                name="sort_order"
                type="number"
                defaultValue={0}
                className="w-32"
              />
            </div>
            <p className="text-muted-foreground text-xs">
              The first rink you create becomes the facility default. Staff land
              on the default rink&apos;s default diagram.
            </p>
            <div>
              <Button type="submit" size="sm" disabled={pending}>
                {pending ? "Creating…" : "Create rink"}
              </Button>
            </div>
          </form>
        </CardContent>
      )}
    </Card>
  )
}
