"use client"

import Link from "next/link"
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"

import {
  addGroupMember,
  createGroup,
  deleteGroup,
  removeGroupMember,
  setGroupActive,
  updateGroup,
} from "../actions"
import type {
  ActionState,
  GroupDetail,
  GroupRow,
  GroupWithCount,
} from "../types"

const NULL_STATE: ActionState = { ok: null }

type Props = {
  groups: GroupWithCount[]
  detail: GroupDetail | null
  activeGroupId: string | null
}

export function GroupsTab({ groups, detail, activeGroupId }: Props) {
  if (groups.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        <Card>
          <CardHeader>
            <CardTitle>No groups yet</CardTitle>
            <CardDescription>
              Groups bundle employees so routing rules and reminders can target
              many people at once. Add your first below.
            </CardDescription>
          </CardHeader>
        </Card>
        <GroupCreateCard />
      </div>
    )
  }
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[18rem_1fr]">
      <div className="flex flex-col gap-3">
        <GroupsList groups={groups} activeGroupId={activeGroupId} />
        <GroupCreateCard />
      </div>
      <div>
        {detail ? (
          <GroupDetailPane detail={detail} />
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>Pick a group</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground text-sm">
                Select a group from the list to manage members.
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}

function GroupsList({
  groups,
  activeGroupId,
}: {
  groups: GroupWithCount[]
  activeGroupId: string | null
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Groups</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-1 p-2">
        {groups.map((g) => (
          <Link
            key={g.id}
            href={`/admin/communications?tab=groups&group=${g.id}`}
            className={cn(
              "flex flex-col gap-0.5 rounded-md px-3 py-2 text-sm transition-colors",
              activeGroupId === g.id
                ? "bg-primary text-primary-foreground"
                : "hover:bg-accent hover:text-accent-foreground",
            )}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium">{g.name}</span>
              {!g.is_active && (
                <span
                  className={cn(
                    "rounded-full px-1.5 py-0.5 text-[10px] font-medium uppercase",
                    activeGroupId === g.id
                      ? "bg-primary-foreground/20"
                      : "bg-muted",
                  )}
                >
                  off
                </span>
              )}
            </div>
            <span
              className={cn(
                "text-xs",
                activeGroupId === g.id
                  ? "text-primary-foreground/80"
                  : "text-muted-foreground",
              )}
            >
              {g.member_count} member{g.member_count === 1 ? "" : "s"}
            </span>
          </Link>
        ))}
      </CardContent>
    </Card>
  )
}

function GroupCreateCard() {
  const [state, action, pending] = useActionState(createGroup, NULL_STATE)
  useEffect(() => {
    if (state.ok === true) toast.success(state.message ?? "Group created.")
    if (state.ok === false) toast.error(state.error)
  }, [state])
  return (
    <Card>
      <CardHeader>
        <CardTitle>Add group</CardTitle>
      </CardHeader>
      <CardContent>
        <form action={action} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor="new-grp-name">Name</Label>
            <Input id="new-grp-name" name="name" required />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="new-grp-slug">Slug (optional)</Label>
            <Input
              id="new-grp-slug"
              name="slug"
              placeholder="auto from name"
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="new-grp-desc">Description</Label>
            <Textarea
              id="new-grp-desc"
              name="description"
              rows={2}
              placeholder="optional"
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="staff_can_message"
              className="h-4 w-4"
            />
            <span>Staff can message this group</span>
          </label>
          <Button type="submit" size="sm" disabled={pending}>
            {pending ? "Adding…" : "Add group"}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}

function GroupDetailPane({ detail }: { detail: GroupDetail }) {
  return (
    <div className="flex flex-col gap-6">
      <GroupHeader group={detail.group} />
      <GroupMembers detail={detail} />
    </div>
  )
}

function GroupHeader({ group }: { group: GroupRow }) {
  const [editing, setEditing] = useState(false)
  const [state, action, pending] = useActionState(updateGroup, NULL_STATE)
  const [activePending, startActive] = useTransition()
  const [delPending, startDel] = useTransition()

  useEffect(() => {
    if (state.ok === true) toast.success(state.message ?? "Group updated.")
    if (state.ok === false) toast.error(state.error)
  }, [state])

  function onToggleActive() {
    startActive(async () => {
      const r = await setGroupActive(group.id, !group.is_active)
      if (!r.ok) toast.error(r.error)
    })
  }
  function onDelete() {
    if (
      !confirm(
        "Delete this group? This will fail if routing rules or reminders reference it.",
      )
    ) {
      return
    }
    startDel(async () => {
      const r = await deleteGroup(group.id)
      if (!r.ok) toast.error(r.error)
      else {
        toast.success("Group deleted.")
        window.location.href = "/admin/communications?tab=groups"
      }
    })
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2">
            {group.name}
            {!group.is_active && (
              <Badge variant="secondary" className="uppercase">
                inactive
              </Badge>
            )}
          </CardTitle>
          <div className="flex flex-wrap gap-2">
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
              {group.is_active ? "Deactivate" : "Activate"}
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
        {!editing && group.description && (
          <CardDescription>{group.description}</CardDescription>
        )}
      </CardHeader>
      {editing && (
        <CardContent>
          <form action={action} className="flex flex-col gap-3">
            <input type="hidden" name="id" value={group.id} />
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1">
                <Label htmlFor={`g-name-${group.id}`}>Name</Label>
                <Input
                  id={`g-name-${group.id}`}
                  name="name"
                  defaultValue={group.name}
                  required
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor={`g-slug-${group.id}`}>Slug</Label>
                <Input
                  id={`g-slug-${group.id}`}
                  name="slug"
                  defaultValue={group.slug}
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor={`g-sort-${group.id}`}>Sort</Label>
                <Input
                  id={`g-sort-${group.id}`}
                  name="sort_order"
                  type="number"
                  defaultValue={group.sort_order}
                  className="w-24"
                />
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor={`g-desc-${group.id}`}>Description</Label>
              <Textarea
                id={`g-desc-${group.id}`}
                name="description"
                rows={2}
                defaultValue={group.description ?? ""}
              />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="staff_can_message"
                defaultChecked={group.staff_can_message}
                className="h-4 w-4"
              />
              <span>Staff can message this group</span>
            </label>
            <div className="flex justify-end">
              <Button type="submit" size="sm" disabled={pending}>
                {pending ? "Saving…" : "Save group"}
              </Button>
            </div>
          </form>
        </CardContent>
      )}
    </Card>
  )
}

function GroupMembers({ detail }: { detail: GroupDetail }) {
  const memberEmpIds = new Set(detail.members.map((m) => m.employee_id))
  const available = detail.facility_employees.filter(
    (e) => !memberEmpIds.has(e.id),
  )
  return (
    <Card>
      <CardHeader>
        <CardTitle>Members ({detail.members.length})</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {detail.members.length === 0 ? (
          <p className="text-muted-foreground text-sm">No members yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {detail.members.map((m) => (
              <MemberRowItem
                key={m.id}
                memberId={m.id}
                name={
                  m.employee
                    ? `${m.employee.first_name} ${m.employee.last_name}`
                    : "Unknown"
                }
              />
            ))}
          </ul>
        )}
        <AddMemberForm groupId={detail.group.id} available={available} />
      </CardContent>
    </Card>
  )
}

function MemberRowItem({
  memberId,
  name,
}: {
  memberId: string
  name: string
}) {
  const [pending, startTransition] = useTransition()
  function onRemove() {
    if (!confirm(`Remove ${name} from this group?`)) return
    startTransition(async () => {
      const r = await removeGroupMember(memberId)
      if (!r.ok) toast.error(r.error)
      else toast.success("Member removed.")
    })
  }
  return (
    <li className="bg-background flex items-center justify-between gap-3 rounded-md border p-3 text-sm">
      <span>{name}</span>
      <Button
        variant="outline"
        size="sm"
        onClick={onRemove}
        disabled={pending}
      >
        Remove
      </Button>
    </li>
  )
}

function AddMemberForm({
  groupId,
  available,
}: {
  groupId: string
  available: Array<{ id: string; first_name: string; last_name: string }>
}) {
  const [state, action, pending] = useActionState(addGroupMember, NULL_STATE)
  const [employeeId, setEmployeeId] = useState("")

  useEffect(() => {
    if (state.ok === true) toast.success(state.message ?? "Member added.")
    if (state.ok === false) toast.error(state.error)
  }, [state])
  if (available.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        All active employees are already members.
      </p>
    )
  }
  return (
    <form
      action={action}
      className="flex flex-wrap items-end gap-3 rounded-md border p-3"
    >
      <input type="hidden" name="group_id" value={groupId} />
      <input type="hidden" name="employee_id" value={employeeId} />
      <div className="flex flex-col gap-1">
        <Label htmlFor={`add-mem-${groupId}`}>Add employee</Label>
        <Select
          value={employeeId || undefined}
          onValueChange={(v) => setEmployeeId(v)}
        >
          <SelectTrigger id={`add-mem-${groupId}`} className="min-w-56">
            <SelectValue placeholder="Pick employee…" />
          </SelectTrigger>
          <SelectContent>
            {available.map((e) => (
              <SelectItem key={e.id} value={e.id}>
                {e.last_name}, {e.first_name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Adding…" : "Add member"}
      </Button>
    </form>
  )
}
