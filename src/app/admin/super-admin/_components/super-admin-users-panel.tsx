"use client"

import { useActionState } from "react"

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"

import { sendPasswordReset, setSuperAdminFlag } from "../actions"
import type { ActionState, SuperAdminUserRow } from "../types"

const INITIAL: ActionState = { ok: null }

interface Props {
  users: SuperAdminUserRow[]
  currentUserId: string
}

export function SuperAdminUsersPanel({ users, currentUserId }: Props) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Super admins &amp; users</CardTitle>
        <CardDescription>
          All platform users. Promote users to super admin for cross-facility
          access. You cannot revoke your own super admin status.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {users.length === 0 && (
          <p className="text-sm text-muted-foreground">No users found.</p>
        )}
        {users.map((u) => (
          <UserRow key={u.id} user={u} isSelf={u.id === currentUserId} />
        ))}
      </CardContent>
    </Card>
  )
}

function UserRow({
  user,
  isSelf,
}: {
  user: SuperAdminUserRow
  isSelf: boolean
}) {
  const [toggleState, toggleAction, togglePending] = useActionState(setSuperAdminFlag, INITIAL)
  const [resetState, resetAction, resetPending] = useActionState(sendPasswordReset, INITIAL)

  const displayName = user.full_name || user.email
  const canToggle = !isSelf

  return (
    <div className="flex items-center justify-between gap-4 rounded-md border px-4 py-3">
      <div className="flex flex-col gap-0.5 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium text-sm truncate">{displayName}</span>
          {user.is_super_admin && (
            <Badge variant="default">Super admin</Badge>
          )}
          {!user.is_active && (
            <Badge variant="secondary">Inactive</Badge>
          )}
          {isSelf && (
            <span className="text-xs text-muted-foreground">(you)</span>
          )}
        </div>
        <span className="text-xs text-muted-foreground truncate">{user.email}</span>
        {user.facility_name && (
          <span className="text-xs text-muted-foreground">
            {user.facility_name}
          </span>
        )}
        {user.last_seen_at && (
          <span className="text-xs text-muted-foreground">
            Last seen {new Date(user.last_seen_at).toLocaleString()}
          </span>
        )}
        {toggleState.ok === false && (
          <p className="text-xs text-destructive">{toggleState.error}</p>
        )}
        {toggleState.ok === true && (
          <p className="text-xs text-green-600 dark:text-green-400">
            {toggleState.message}
          </p>
        )}
        {resetState.ok === false && (
          <p className="text-xs text-destructive">{resetState.error}</p>
        )}
        {resetState.ok === true && (
          <p className="text-xs text-green-600 dark:text-green-400">
            {resetState.message}
          </p>
        )}
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <form action={resetAction}>
          <input type="hidden" name="email" value={user.email} />
          <Button
            type="submit"
            variant="outline"
            size="sm"
            disabled={resetPending}
          >
            Reset password
          </Button>
        </form>

        {canToggle && (
          <form action={toggleAction}>
            <input type="hidden" name="user_id" value={user.id} />
            <input
              type="hidden"
              name="value"
              value={user.is_super_admin ? "false" : "true"}
            />
            <Button
              type="submit"
              variant={user.is_super_admin ? "outline" : "default"}
              size="sm"
              disabled={togglePending}
            >
              {user.is_super_admin ? "Revoke" : "Promote"}
            </Button>
          </form>
        )}
      </div>
    </div>
  )
}
