import { Breadcrumb } from "@/components/ui/breadcrumb"
import { PageHeader } from "@/components/ui/page-header"
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

import { ComposeForm, type ReplyTarget } from "../_components/compose-form"

export const dynamic = "force-dynamic"

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type SearchParams = {
  replyTo?: string | string[]
}

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
      <Breadcrumb
        segments={[
          { label: "Reports", href: "/reports" },
          { label: "Communications", href: "/reports/communications" },
          { label: "Compose" },
        ]}
      />
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

export default async function CommunicationsComposePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const current = await requireUser()
  const sp = await searchParams
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

  // Reply mode: ?replyTo=<message id>. Only valid for a message the current
  // employee actually received whose sender is still a known employee — the
  // reply's recipient is locked to that sender (enforced again server-side in
  // persistMessage).
  let replyTo: ReplyTarget | null = null
  const replyParam = Array.isArray(sp.replyTo) ? sp.replyTo[0] : sp.replyTo
  if (replyParam && UUID_RE.test(replyParam)) {
    const { data: receipt } = await supabase
      .from("communication_recipients")
      .select("id")
      .eq("message_id", replyParam)
      .eq("employee_id", employeeRow.id)
      .maybeSingle()
    if (receipt) {
      const { data: parentRaw } = await supabase
        .from("communication_messages")
        .select(
          "id, subject, sender_employee_id, sender:employees!communication_messages_sender_employee_id_fkey(first_name, last_name)",
        )
        .eq("id", replyParam)
        .eq("facility_id", employeeRow.facility_id)
        .maybeSingle()
      const parent = parentRaw as unknown as {
        id: string
        subject: string | null
        sender_employee_id: string | null
        sender: { first_name: string | null; last_name: string | null } | null
      } | null
      if (parent?.sender_employee_id) {
        const name = parent.sender
          ? `${parent.sender.first_name ?? ""} ${parent.sender.last_name ?? ""}`.trim()
          : ""
        replyTo = {
          messageId: parent.id,
          senderEmployeeId: parent.sender_employee_id,
          senderName: name.length > 0 ? name : "Original sender",
          subject: parent.subject,
        }
      }
    }
    if (!replyTo) {
      return (
        <NotAvailable
          title="Can't reply to that message"
          description="The message isn't in your inbox, or it was sent by the system rather than a person."
        />
      )
    }
  }

  if (groups.length === 0 && !replyTo) {
    return (
      <NotAvailable
        title="No recipient groups"
        description="There aren't any active groups to send to in this facility. Ask your administrator to set one up."
      />
    )
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8">
      <PageHeader
        variant="display"
        module="comms"
        band
        breadcrumb={
          <Breadcrumb
            segments={[
              { label: "Reports", href: "/reports" },
              { label: "Communications", href: "/reports/communications" },
              { label: "Compose" },
            ]}
          />
        }
        eyebrow={replyTo ? "Reply" : "New message"}
        title={replyTo ? "Reply" : "Compose"}
        description={
          replyTo
            ? `Replying to ${replyTo.senderName}.`
            : "Send a message to one or more groups in your facility."
        }
      />

      <ComposeForm
        replyTo={replyTo}
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
