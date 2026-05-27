import Link from "next/link"

import { SignOutButton } from "@/components/staff/sign-out-button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { getIsAdmin, requireUser } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"
import { currentUserCan } from "@/lib/permissions/check"

import { ComposeForm } from "../_components/compose-form"

export const dynamic = "force-dynamic"

function NotAvailable({
  title,
  description,
  showSignOut = false,
}: {
  title: string
  description: string
  showSignOut?: boolean
}) {
  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-6 px-4 py-10">
      <div>
        <p className="text-sm text-muted-foreground">
          <Link href="/reports" className="hover:underline">
            Reports
          </Link>{" "}
          /{" "}
          <Link href="/reports/communications" className="hover:underline">
            Communications
          </Link>{" "}
          / Compose
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        {showSignOut ? (
          <CardContent>
            <SignOutButton />
          </CardContent>
        ) : null}
      </Card>
    </div>
  )
}

export default async function CommunicationsComposePage() {
  const current = await requireUser()
  const supabase = await createClient()

  const { data: employeeRow } = await supabase
    .from("employees")
    .select("id, facility_id")
    .eq("user_id", current.authUser.id)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle()

  if (!employeeRow) {
    return (
      <NotAvailable
        title="Account not set up"
        description="Your account isn't fully set up yet. Contact your administrator."
        showSignOut
      />
    )
  }

  if (!(await currentUserCan(supabase, "communications", "submit"))) {
    return (
      <NotAvailable
        title="No permission"
        description="You don't have permission to send messages."
      />
    )
  }

  // Spec: staff may only message groups flagged staff_can_message=true
  // (migration 59). Admins still see all active groups so they can broadcast.
  const isAdmin = await getIsAdmin(current)
  const groupsQuery = supabase
    .from("communication_groups")
    .select("id, name, description, is_active")
    .eq("facility_id", employeeRow.facility_id)
    .eq("is_active", true)
    .order("name", { ascending: true })

  const [{ data: groupsRaw }, { data: templatesRaw }] = await Promise.all([
    isAdmin ? groupsQuery : groupsQuery.eq("staff_can_message", true),
    supabase
      .from("communication_templates")
      .select("id, name, subject, body, requires_acknowledgement, is_active")
      .eq("facility_id", employeeRow.facility_id)
      .eq("is_active", true)
      .order("name", { ascending: true }),
  ])

  const groups = groupsRaw ?? []
  const templates = templatesRaw ?? []

  if (groups.length === 0) {
    return (
      <NotAvailable
        title="No recipient groups"
        description="There aren't any active groups to send to in this facility. Ask your administrator to set one up."
      />
    )
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8">
      <div>
        <p className="text-sm text-muted-foreground">
          <Link href="/reports" className="hover:underline">
            Reports
          </Link>{" "}
          /{" "}
          <Link href="/reports/communications" className="hover:underline">
            Communications
          </Link>{" "}
          / Compose
        </p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">
          New message
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Send a message to one or more groups in your facility.
        </p>
      </div>

      <ComposeForm
        groups={groups.map((g) => ({
          id: g.id,
          name: g.name,
          description: g.description,
        }))}
        templates={templates.map((t) => ({
          id: t.id,
          name: t.name,
          subject: t.subject,
          body: t.body,
          requires_acknowledgement: t.requires_acknowledgement,
        }))}
      />
    </div>
  )
}
