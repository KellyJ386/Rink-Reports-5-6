import "server-only"

import { redirect } from "next/navigation"

import { getCurrentUser } from "./get-current-user"
import type { AuthedUser } from "./types"

/**
 * Server-side guard: returns the current authed user, or redirects to /login.
 */
export async function requireUser(): Promise<AuthedUser> {
  const current = await getCurrentUser()
  if (!current) {
    redirect("/login")
  }
  return current
}
