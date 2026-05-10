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

import { AcknowledgeAlertForm } from "./_components/acknowledge-alert-form"
import { AlertsList } from "./_components/alerts-list"
import { InboxTabs } from "./_components/inbox-tabs"
import { MessageDetail } from "./_components/message-detail"
import { MessagesList } from "./_components/messages-list"
import {
  excerpt,
  formatTimestamp,
  severityBadgeVariant,
  severityLabel,
  sourceModuleLabel,
} from "./_components/format"
import { Badge } from "@/components/ui/badge"
import type {

  AlertWithAck,
  CommunicationAlert,
  CommunicationMessage,
  CommunicationRecipient,
  MessageInboxItem,
} from "./types"

export const dynamic = "force-dynamic"

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type SearchParams = {
  inbox?: string | string[]
  alert?: string | string[]
  message?: string | string[]
}

function pickParam(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null
  return value ?? null
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
      <div>
        <p className="text-sm text-muted-foreground">
          <Link href="/reports" className="hover:underline">
            Reports
          </Link>{" "}
          / Communications
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

type AlertJoined = CommunicationAlert & {
  created_by: { first_name: string | null; last_name: string | null } | null
  resolved_by: { first_name: string | null; last_name: string | null } | null
}

function fullName(
  row: { first_name: string | null; last_name: string | null } | null
): string | null {
  if (!row) return null
  const name = `${row.first_name ?? ""} ${row.last_name ?? ""}`.trim()
  return name.length > 0 ? name : null
}

export default async function CommunicationsInboxPage({
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

  const { data: perm } = await supabase
    .from("module_permissions")
    .select("can_view, can_submit")
    .eq("module_key", "communications")
    .eq("employee_id", employeeRow.id)
    .maybeSingle()

  if (!perm?.can_view) {
    return (
      <NotAvailable
        title="No permission"
        description="You don't have permission to view communications."
      />
    )
  }

  const canSubmit = perm?.can_submit === true

  const { data: facility } = await supabase
    .from("facilities")
    .select("timezone")
    .eq("id", employeeRow.facility_id)
    .maybeSingle()
  const tz = facility?.timezone ?? null

  // ---- DRILLDOWN: ALERT ----
  const alertParam = pickParam(sp.alert)
  if (alertParam && UUID_RE.test(alertParam)) {
    const { data: alertRaw } = await supabase
      .from("communication_alerts")
      .select(
        "id, facility_id, source_module, severity, title, body, area_id, requires_acknowledgement, resolved_at, resolved_by_employee_id, created_at, created_by_employee_id, updated_at, source_record_id, created_by:employees!communication_alerts_created_by_employee_id_fkey(first_name, last_name), resolved_by:employees!communication_alerts_resolved_by_employee_id_fkey(first_name, last_name)"
      )
      .eq("id", alertParam)
      .eq("facility_id", employeeRow.facility_id)
      .maybeSingle()

    const alert = alertRaw as unknown as AlertJoined | null

    if (!alert) {
      return (
        <NotAvailable
          title="Alert not found"
          description="That alert isn't available."
        />
      )
    }

    const { data: ackRow } = await supabase
      .from("communication_acknowledgements")
      .select("id, acknowledged_at, notes")
      .eq("alert_id", alert.id)
      .eq("employee_id", employeeRow.id)
      .limit(1)
      .maybeSingle()

    return (
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8">
        <div>
          <p className="text-sm text-muted-foreground">
            <Link href="/reports" className="hover:underline">
              Reports
            </Link>{" "}
            /{" "}
            <Link
              href="/reports/communications?inbox=alerts"
              className="hover:underline"
            >
              Communications
            </Link>{" "}
            / Alert
          </p>
        </div>

        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary">
                {sourceModuleLabel(alert.source_module)}
              </Badge>
              <Badge variant={severityBadgeVariant(alert.severity)}>
                {severityLabel(alert.severity)}
              </Badge>
              {alert.resolved_at ? (
                <Badge variant="success">Resolved</Badge>
              ) : null}
              {alert.requires_acknowledgement ? (
                <Badge variant="outline">Acknowledgement required</Badge>
              ) : null}
            </div>
            <CardTitle className="mt-2 text-xl">{alert.title}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {alert.body ? (
              <p className="whitespace-pre-wrap text-sm leading-relaxed">
                {alert.body}
              </p>
            ) : null}

            <div className="flex flex-col gap-1 border-t border-border pt-4 text-xs text-muted-foreground">
              <div>Created: {formatTimestamp(alert.created_at, tz)}</div>
              {fullName(alert.created_by) ? (
                <div>By: {fullName(alert.created_by)}</div>
              ) : null}
              {alert.area_id ? <div>Area: {alert.area_id}</div> : null}
              {alert.resolved_at ? (
                <div>
                  Resolved: {formatTimestamp(alert.resolved_at, tz)}
                  {fullName(alert.resolved_by)
                    ? ` by ${fullName(alert.resolved_by)}`
                    : ""}
                </div>
              ) : null}
            </div>
          </CardContent>
        </Card>

        {alert.requires_acknowledgement ? (
          ackRow ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Acknowledged</CardTitle>
                <CardDescription>
                  You acknowledged this alert on{" "}
                  {formatTimestamp(ackRow.acknowledged_at, tz)}.
                </CardDescription>
              </CardHeader>
              {ackRow.notes ? (
                <CardContent>
                  <p className="whitespace-pre-wrap text-sm">
                    <span className="font-medium">Your notes: </span>
                    {ackRow.notes}
                  </p>
                </CardContent>
              ) : null}
            </Card>
          ) : (
            <AcknowledgeAlertForm alertId={alert.id} />
          )
        ) : null}

        <div>
          <Link
            href="/reports/communications?inbox=alerts"
            className="inline-flex h-11 items-center rounded-md border border-input bg-background px-4 text-sm font-medium hover:bg-accent"
          >
            Back to inbox
          </Link>
        </div>
      </div>
    )
  }

  // ---- DRILLDOWN: MESSAGE ----
  const messageParam = pickParam(sp.message)
  if (messageParam && UUID_RE.test(messageParam)) {
    const { data: recipientRow } = await supabase
      .from("communication_recipients")
      .select("id, message_id, employee_id, delivered_at, read_at, acknowledged_at")
      .eq("message_id", messageParam)
      .eq("employee_id", employeeRow.id)
      .maybeSingle()

    if (!recipientRow) {
      return (
        <NotAvailable
          title="Message not found"
          description="That message isn't available in your inbox."
        />
      )
    }

    type MessageJoined = CommunicationMessage & {
      sender:
        | { first_name: string | null; last_name: string | null }
        | null
    }

    const { data: messageRaw } = await supabase
      .from("communication_messages")
      .select(
        "id, facility_id, sender_employee_id, subject, body, requires_acknowledgement, sent_at, created_at, updated_at, template_id, sender:employees!communication_messages_sender_employee_id_fkey(first_name, last_name)"
      )
      .eq("id", messageParam)
      .maybeSingle()

    const message = messageRaw as unknown as MessageJoined | null

    if (!message) {
      return (
        <NotAvailable
          title="Message not found"
          description="That message isn't available."
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
            <Link
              href="/reports/communications?inbox=messages"
              className="hover:underline"
            >
              Communications
            </Link>{" "}
            / Message
          </p>
        </div>

        <MessageDetail
          message={{
            id: message.id,
            subject: message.subject,
            body: message.body,
            sent_at: message.sent_at,
            requires_acknowledgement: message.requires_acknowledgement,
            sender_name: fullName(message.sender),
          }}
          recipient={{
            read_at: recipientRow.read_at,
            acknowledged_at: recipientRow.acknowledged_at,
          }}
          timezone={tz}
        />
      </div>
    )
  }

  // ---- INBOX LIST ----
  const inboxParam = pickParam(sp.inbox)
  const tab: "alerts" | "messages" =
    inboxParam === "messages" ? "messages" : "alerts"

  // NOTE on routing: `communication_routing_rules` is admin-configurable but for v1
  // we intentionally do NOT filter the staff inbox by routing rules. Every active
  // staff member with `can_view` on the communications module sees ALL alerts in
  // their facility. Routing rules are aspirational and surfaced in the admin UI.
  const { data: alertsRaw } = await supabase
    .from("communication_alerts")
    .select(
      "id, facility_id, source_module, severity, title, body, area_id, requires_acknowledgement, resolved_at, resolved_by_employee_id, created_at, created_by_employee_id, updated_at, source_record_id"
    )
    .eq("facility_id", employeeRow.facility_id)
    .order("created_at", { ascending: false })
    .limit(100)

  const alerts = (alertsRaw ?? []) as CommunicationAlert[]
  const alertIds = alerts.map((a) => a.id)

  const { data: ackRowsRaw } =
    alertIds.length > 0
      ? await supabase
          .from("communication_acknowledgements")
          .select("id, alert_id, acknowledged_at, notes")
          .eq("employee_id", employeeRow.id)
          .in("alert_id", alertIds)
      : { data: [] as Array<{ id: string; alert_id: string | null; acknowledged_at: string; notes: string | null }> }

  const ackByAlert = new Map<
    string,
    { id: string; acknowledged_at: string; notes: string | null }
  >()
  for (const a of ackRowsRaw ?? []) {
    if (a.alert_id) {
      ackByAlert.set(a.alert_id, {
        id: a.id,
        acknowledged_at: a.acknowledged_at,
        notes: a.notes,
      })
    }
  }

  const alertsWithAck: AlertWithAck[] = alerts.map((alert) => ({
    ...alert,
    ack: ackByAlert.get(alert.id) ?? null,
  }))

  // Messages: recipient rows for the current employee, joined with messages.
  type MessageJoined = CommunicationMessage & {
    sender:
      | { first_name: string | null; last_name: string | null }
      | null
  }
  type RecipientJoined = CommunicationRecipient & {
    message: MessageJoined | null
  }

  const { data: recipientsRaw } = await supabase
    .from("communication_recipients")
    .select(
      "id, message_id, employee_id, facility_id, delivered_at, read_at, acknowledged_at, created_at, message:communication_messages!communication_recipients_message_id_fkey(id, facility_id, sender_employee_id, subject, body, requires_acknowledgement, sent_at, created_at, updated_at, template_id, sender:employees!communication_messages_sender_employee_id_fkey(first_name, last_name))"
    )
    .eq("employee_id", employeeRow.id)
    .order("created_at", { ascending: false })
    .limit(100)

  const recipients = (recipientsRaw ?? []) as unknown as RecipientJoined[]
  const messageItems: MessageInboxItem[] = recipients
    .filter((r): r is RecipientJoined & { message: MessageJoined } =>
      r.message !== null && r.message !== undefined
    )
    .map((r) => ({
      recipient: {
        id: r.id,
        message_id: r.message_id,
        employee_id: r.employee_id,
        facility_id: r.facility_id,
        delivered_at: r.delivered_at,
        read_at: r.read_at,
        acknowledged_at: r.acknowledged_at,
        created_at: r.created_at,
      },
      message: {
        id: r.message.id,
        facility_id: r.message.facility_id,
        sender_employee_id: r.message.sender_employee_id,
        subject: r.message.subject,
        body: r.message.body,
        requires_acknowledgement: r.message.requires_acknowledgement,
        sent_at: r.message.sent_at,
        created_at: r.message.created_at,
        updated_at: r.message.updated_at,
        template_id: r.message.template_id,
      },
      senderName: fullName(r.message.sender),
    }))
    .sort((a, b) => {
      const ta = new Date(a.message.sent_at).getTime()
      const tb = new Date(b.message.sent_at).getTime()
      return tb - ta
    })

  const unreadAlerts = alertsWithAck.filter((a) => a.ack === null).length
  const unreadMessages = messageItems.filter(
    (m) => m.recipient.read_at === null
  ).length

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm text-muted-foreground">
            <Link href="/reports" className="hover:underline">
              Reports
            </Link>{" "}
            / Communications
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Inbox</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Alerts and messages for your facility.
          </p>
        </div>
        {canSubmit ? (
          <Link
            href="/reports/communications/compose"
            className="inline-flex h-11 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow-xs hover:bg-primary/90"
          >
            New message
          </Link>
        ) : null}
      </div>

      <InboxTabs
        active={tab}
        unreadAlerts={unreadAlerts}
        unreadMessages={unreadMessages}
      />

      {tab === "alerts" ? (
        alertsWithAck.length === 0 ? (
          <Card>
            <CardHeader>
              <CardTitle>No alerts</CardTitle>
              <CardDescription>
                Your facility has no alerts right now.
              </CardDescription>
            </CardHeader>
          </Card>
        ) : (
          <AlertsList
            alerts={alertsWithAck.map((a) => ({
              id: a.id,
              source_module: a.source_module,
              severity: a.severity,
              title: a.title,
              body: a.body,
              created_at: a.created_at,
              requires_acknowledgement: a.requires_acknowledgement,
              resolved_at: a.resolved_at,
              acked: a.ack !== null,
              excerpt: excerpt(a.body, 160),
            }))}
            timezone={tz}
          />
        )
      ) : messageItems.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>No messages</CardTitle>
            <CardDescription>
              You haven&apos;t received any direct messages.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <MessagesList
          items={messageItems.map((item) => ({
            messageId: item.message.id,
            subject: item.message.subject,
            body: item.message.body,
            sent_at: item.message.sent_at,
            requires_acknowledgement: item.message.requires_acknowledgement,
            read_at: item.recipient.read_at,
            acknowledged_at: item.recipient.acknowledged_at,
            senderName: item.senderName,
          }))}
          timezone={tz}
        />
      )}
    </div>
  )
}
