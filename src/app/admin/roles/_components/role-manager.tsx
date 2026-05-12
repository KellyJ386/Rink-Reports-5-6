"use client"

import { useState, useTransition } from "react"
import { toast } from "sonner"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
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
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Textarea } from "@/components/ui/textarea"

import {
  copyRolePermissionDefaults,
  createRole,
  deactivateRole,
  reactivateRole,
  renameRole,
  setRoleHierarchy,
} from "../actions"

export type ManagedRole = {
  id: string
  key: string
  display_name: string
  hierarchy_level: number
  is_system: boolean
  is_active: boolean
  description: string | null
}

type Props = {
  facilityId: string
  roles: ManagedRole[]
}

export function RoleManager({ facilityId, roles }: Props) {
  const [pending, startTransition] = useTransition()
  const [editing, setEditing] = useState<ManagedRole | null>(null)
  const [creating, setCreating] = useState(false)
  const [deactivateTarget, setDeactivateTarget] = useState<{
    role: ManagedRole
    employeeCount: number
  } | null>(null)
  const [copySource, setCopySource] = useState<string>("")
  const [copyTarget, setCopyTarget] = useState<string>("")

  const activeRoles = roles.filter((r) => r.is_active)
  const inactiveRoles = roles.filter((r) => !r.is_active)

  function handleDeactivate(role: ManagedRole, force: boolean) {
    startTransition(async () => {
      const res = await deactivateRole(role.id, force)
      if (!res.ok) {
        toast.error(res.error)
        return
      }
      if (res.value.employeeCount > 0 && !force) {
        setDeactivateTarget({ role, employeeCount: res.value.employeeCount })
      } else {
        toast.success(res.value.message)
        setDeactivateTarget(null)
      }
    })
  }

  function handleReactivate(role: ManagedRole) {
    startTransition(async () => {
      const res = await reactivateRole(role.id)
      if (!res.ok) {
        toast.error(res.error)
        return
      }
      toast.success(`Reactivated ${role.display_name}`)
    })
  }

  function handleCopy() {
    if (!copySource || !copyTarget) return
    startTransition(async () => {
      const res = await copyRolePermissionDefaults(copySource, copyTarget)
      if (!res.ok) {
        toast.error(res.error)
        return
      }
      toast.success(`Copied ${res.value.copied} module defaults`)
      setCopySource("")
      setCopyTarget("")
    })
  }

  return (
    <>
      <Card>
        <CardHeader className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle>Roles</CardTitle>
            <CardDescription>
              Rename, add, deactivate, and reorder facility roles. System roles
              are pre-seeded and can&apos;t be removed.
            </CardDescription>
          </div>
          <Button onClick={() => setCreating(true)} disabled={pending}>
            New role
          </Button>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <RoleList
            roles={activeRoles}
            onEdit={setEditing}
            onDeactivate={(r) => handleDeactivate(r, false)}
            pending={pending}
          />

          {inactiveRoles.length > 0 ? (
            <div className="flex flex-col gap-2">
              <h3 className="text-muted-foreground text-xs font-semibold uppercase">
                Inactive
              </h3>
              <ul className="flex flex-col gap-1">
                {inactiveRoles.map((r) => (
                  <li
                    key={r.id}
                    className="bg-muted/30 flex items-center justify-between rounded-md border px-3 py-2 text-sm"
                  >
                    <div className="flex flex-col">
                      <span className="font-medium">{r.display_name}</span>
                      <span className="text-muted-foreground text-xs">
                        {r.key} · level {r.hierarchy_level}
                      </span>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleReactivate(r)}
                      disabled={pending}
                    >
                      Reactivate
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="border-t pt-4">
            <h3 className="text-sm font-semibold">Copy permission defaults</h3>
            <p className="text-muted-foreground mb-3 text-xs">
              Bulk-copy all module defaults from one role to another in this
              facility.
            </p>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
              <div className="flex flex-1 flex-col gap-1">
                <Label htmlFor="copy-src" className="text-xs">
                  From
                </Label>
                <select
                  id="copy-src"
                  value={copySource}
                  onChange={(e) => setCopySource(e.target.value)}
                  className="border-input h-9 rounded-md border px-2 text-sm"
                >
                  <option value="">— pick a role —</option>
                  {activeRoles.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.display_name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-1 flex-col gap-1">
                <Label htmlFor="copy-tgt" className="text-xs">
                  To
                </Label>
                <select
                  id="copy-tgt"
                  value={copyTarget}
                  onChange={(e) => setCopyTarget(e.target.value)}
                  className="border-input h-9 rounded-md border px-2 text-sm"
                >
                  <option value="">— pick a role —</option>
                  {activeRoles
                    .filter((r) => r.id !== copySource)
                    .map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.display_name}
                      </option>
                    ))}
                </select>
              </div>
              <Button
                onClick={handleCopy}
                disabled={pending || !copySource || !copyTarget}
              >
                Copy
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {creating ? (
        <CreateRoleSheet
          facilityId={facilityId}
          onClose={() => setCreating(false)}
        />
      ) : null}

      {editing ? (
        <EditRoleSheet role={editing} onClose={() => setEditing(null)} />
      ) : null}

      <AlertDialog
        open={!!deactivateTarget}
        onOpenChange={(open) => {
          if (!open) setDeactivateTarget(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Deactivate role?</AlertDialogTitle>
            <AlertDialogDescription>
              {deactivateTarget?.employeeCount ?? 0} active employee(s) are
              still assigned to{" "}
              <strong>{deactivateTarget?.role.display_name}</strong>. Deactivating
              the role removes its permission defaults from those employees;
              they keep only their explicit overrides until reassigned.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                deactivateTarget &&
                handleDeactivate(deactivateTarget.role, true)
              }
              disabled={pending}
            >
              Yes, deactivate anyway
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

function RoleList({
  roles,
  onEdit,
  onDeactivate,
  pending,
}: {
  roles: ManagedRole[]
  onEdit: (r: ManagedRole) => void
  onDeactivate: (r: ManagedRole) => void
  pending: boolean
}) {
  if (roles.length === 0) {
    return (
      <p className="text-muted-foreground py-6 text-center text-sm">
        No active roles. Seed the standard roles on the Employees page first.
      </p>
    )
  }
  return (
    <ul className="flex flex-col gap-1">
      {roles.map((r) => (
        <li
          key={r.id}
          className="flex items-center justify-between rounded-md border px-3 py-2 text-sm"
        >
          <div className="flex flex-col gap-0.5">
            <div className="flex items-center gap-2">
              <span className="font-medium">{r.display_name}</span>
              {r.is_system ? (
                <Badge variant="secondary" className="text-[10px]">
                  system
                </Badge>
              ) : null}
            </div>
            <span className="text-muted-foreground text-xs">
              key: <code>{r.key}</code> · hierarchy level {r.hierarchy_level}
              {r.description ? ` · ${r.description}` : ""}
            </span>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => onEdit(r)}
              disabled={pending}
            >
              Edit
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => onDeactivate(r)}
              disabled={pending || r.is_system}
              title={
                r.is_system
                  ? "System roles can't be deactivated by facility admins"
                  : undefined
              }
            >
              Deactivate
            </Button>
          </div>
        </li>
      ))}
    </ul>
  )
}

function CreateRoleSheet({
  facilityId,
  onClose,
}: {
  facilityId: string
  onClose: () => void
}) {
  const [pending, startTransition] = useTransition()
  const [key, setKey] = useState("")
  const [displayName, setDisplayName] = useState("")
  const [hierarchyLevel, setHierarchyLevel] = useState("10")
  const [description, setDescription] = useState("")

  function submit(e: React.FormEvent) {
    e.preventDefault()
    startTransition(async () => {
      const res = await createRole({
        facilityId,
        key,
        displayName,
        hierarchyLevel: Number(hierarchyLevel),
        description: description || undefined,
      })
      if (!res.ok) {
        toast.error(res.error)
        return
      }
      toast.success(`Created ${displayName}`)
      onClose()
    })
  }

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>New role</SheetTitle>
          <SheetDescription>
            Custom roles live in this facility only. The key is a stable
            identifier used by APIs and migrations; pick something short.
          </SheetDescription>
        </SheetHeader>
        <form onSubmit={submit} className="flex flex-col gap-4 px-4 py-2">
          <div className="flex flex-col gap-1">
            <Label htmlFor="role-name">Display name</Label>
            <Input
              id="role-name"
              required
              minLength={2}
              maxLength={80}
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="role-key">Key</Label>
            <Input
              id="role-key"
              required
              placeholder="rink_lead"
              value={key}
              onChange={(e) => setKey(e.target.value.toLowerCase())}
            />
            <span className="text-muted-foreground text-xs">
              lowercase letters, digits, underscores
            </span>
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="role-hierarchy">Hierarchy level (0 = highest)</Label>
            <Input
              id="role-hierarchy"
              type="number"
              min={0}
              max={1000}
              required
              value={hierarchyLevel}
              onChange={(e) => setHierarchyLevel(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="role-description">Description (optional)</Label>
            <Textarea
              id="role-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div className="mt-2 flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              Create
            </Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  )
}

function EditRoleSheet({
  role,
  onClose,
}: {
  role: ManagedRole
  onClose: () => void
}) {
  const [pending, startTransition] = useTransition()
  const [displayName, setDisplayName] = useState(role.display_name)
  const [description, setDescription] = useState(role.description ?? "")
  const [hierarchyLevel, setHierarchyLevel] = useState(String(role.hierarchy_level))

  function submit(e: React.FormEvent) {
    e.preventDefault()
    startTransition(async () => {
      const renameRes = await renameRole(role.id, displayName, description)
      if (!renameRes.ok) {
        toast.error(renameRes.error)
        return
      }
      const levelNum = Number(hierarchyLevel)
      if (levelNum !== role.hierarchy_level) {
        const hRes = await setRoleHierarchy(role.id, levelNum)
        if (!hRes.ok) {
          toast.error(hRes.error)
          return
        }
      }
      toast.success("Role updated")
      onClose()
    })
  }

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Edit role</SheetTitle>
          <SheetDescription>
            Renaming is safe and does not affect permission assignments. The
            internal key (<code>{role.key}</code>) is immutable.
          </SheetDescription>
        </SheetHeader>
        <form onSubmit={submit} className="flex flex-col gap-4 px-4 py-2">
          <div className="flex flex-col gap-1">
            <Label htmlFor="edit-role-name">Display name</Label>
            <Input
              id="edit-role-name"
              required
              minLength={2}
              maxLength={80}
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="edit-role-hierarchy">Hierarchy level</Label>
            <Input
              id="edit-role-hierarchy"
              type="number"
              min={0}
              max={1000}
              required
              value={hierarchyLevel}
              onChange={(e) => setHierarchyLevel(e.target.value)}
            />
            <span className="text-muted-foreground text-xs">
              Lower number = higher rank. 0 = super admin.
            </span>
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="edit-role-description">Description</Label>
            <Textarea
              id="edit-role-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div className="mt-2 flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              Save
            </Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  )
}
