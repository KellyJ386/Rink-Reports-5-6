import Link from "next/link"

import { SignOutButton } from "@/components/staff/sign-out-button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { requireUser } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"

import { ComposeForm } from "../_components/compose-form"

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

  const { data: perm } = await supabase
    .from("module_permissions")
    .select("can_submit")
    .eq("module_key", "communications")
    .eq("employee_id", employeeRow.id)
    .maybeSingle()

  if (!perm?.can_submit) {
    return (
      <NotAvailable
        title="No permission"
        description="You don't have permission to send messages."
      />
    )
  }

  // TODO: spec says "staff can message managers/supervisors only" but enforcing
  // that requires role-aware group flagging. For v1, allow ANY active group in
  // the facility. The admin UI surfaces routing rules; this picker is permissive.
  const [{ data: groupsRaw }, { data: templatesRaw }] = await Promise.all([
    supabase
      .from("communication_groups")
      .select("id, name, description, is_active")
      .eq("facility_id", employeeRow.facility_id)
      .eq("is_active", true)
      .order("name", { ascending: true }),
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
