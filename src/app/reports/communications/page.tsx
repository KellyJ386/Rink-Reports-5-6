import Link from "next/link"

import { SignOutButton } from "@/components/staff/sign-out-button"
import { Breadcrumb } from "@/components/ui/breadcrumb"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { PageHeader } from "@/components/ui/page-header"
import { requireUser } from "@/lib/auth"
import { signPdfUrl } from "@/lib/notifications/pdf/upload"
import { createClient } from "@/lib/supabase/server"
import { currentUserCan } from "@/lib/permissions/check"

import { AcknowledgeAlertForm } from "./_components/acknowledge-alert-form"
import { AlertsList } from "./_components/alerts-list"
import { InboxTabs } from "./_components/inbox-tabs"
import { MessageDetail } from "./_components/message-detail"
import { MessagesList } from "./_components/messages-list"
import { ReceiptsList, type Receipt } from "./_components/receipts-list"
import { SentList, type SentListItem } from "./_components/sent-list"
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
  MessageInboxItem,
} from "./types"

export const dynamic = "force-dynamic"

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type SearchParams = {
  inbox?: string | string[]
  alert?: string | string[]
  message?: string | string[]
  sent?: string | string[]
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
      <Breadcrumb
        segments={[
          { label: "Reports", href: "/reports" },
          { label: "Communications" },
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

  if (!(await currentUserCan(supabase, "communications", "view"))) {
    return (
      <NotAvailable
        title="No permission"
        description="You don't have permission to view communications."
      />
    )
  }

  const canSubmit = await currentUserCan(supabase, "communications", "submit")

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
        <PageHeader
          variant="display"
          module="comms"
          band
          eyebrow="Communications"
          breadcrumb={
            <Breadcrumb
              segments={[
                { label: "Reports", href: "/reports" },
                {
                  label: "Communications",
                  href: "/reports/communications?inbox=alerts",
                },
                { label: "Alert" },
              ]}
            />
          }
          title="Alert"
        />

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
          <Button asChild variant="outline">
            <Link href="/reports/communications?inbox=alerts">
              Back to inbox
            </Link>
          </Button>
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

    // pdf_url is in the generated types (regenerated with migration 48+);
    // only the embedded-join shape still needs a cast, matching the
    // recipients query on the inbox branch below.
    const { data: messageRaw } = await supabase
      .from("communication_messages")
      .select(
        "id, facility_id, sender_employee_id, parent_message_id, subject, body, requires_acknowledgement, sent_at, created_at, updated_at, template_id, pdf_url, sender:employees!communication_messages_sender_employee_id_fkey(first_name, last_name)",
      )
      .eq("id", messageParam)
      .maybeSingle()

    const message = messageRaw as unknown as
      | (MessageJoined & { pdf_url: string | null })
      | null

    if (!message) {
      return (
        <NotAvailable
          title="Message not found"
          description="That message isn't available."
        />
      )
    }

    const pdfSignedUrl = message.pdf_url
      ? await signPdfUrl(supabase, message.pdf_url)
      : null

    return (
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8">
        <PageHeader
          variant="display"
          module="comms"
          band
          eyebrow="Communications"
          breadcrumb={
            <Breadcrumb
              segments={[
                { label: "Reports", href: "/reports" },
                {
                  label: "Communications",
                  href: "/reports/communications?inbox=messages",
                },
                { label: "Message" },
              ]}
            />
          }
          title="Message"
        />

        <MessageDetail
          canReply={message.sender_employee_id !== null}
          message={{
            id: message.id,
            subject: message.subject,
            body: message.body,
            sent_at: message.sent_at,
            requires_acknowledgement: message.requires_acknowledgement,
            sender_name: fullName(message.sender),
            pdf_signed_url: pdfSignedUrl,
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

  // ---- DRILLDOWN: SENT MESSAGE (sender receipts) ----
  const sentParam = pickParam(sp.sent)
  if (sentParam && UUID_RE.test(sentParam)) {
    const { data: sentMessage } = await supabase
      .from("communication_messages")
      .select(
        "id, subject, body, sent_at, requires_acknowledgement, sender_employee_id",
      )
      .eq("id", sentParam)
      .eq("facility_id", employeeRow.facility_id)
      .eq("sender_employee_id", employeeRow.id)
      .maybeSingle()

    if (!sentMessage) {
      return (
        <NotAvailable
          title="Message not found"
          description="That message isn't in your sent messages."
        />
      )
    }

    type ReceiptRow = {
      id: string
      read_at: string | null
      acknowledged_at: string | null
      employee: { first_name: string | null; last_name: string | null } | null
    }
    const { data: receiptRowsRaw } = await supabase
      .from("communication_recipients")
      .select(
        "id, read_at, acknowledged_at, employee:employees!communication_recipients_employee_id_fkey(first_name, last_name)",
      )
      .eq("message_id", sentMessage.id)
      .order("created_at", { ascending: true })

    const receipts: Receipt[] = (
      (receiptRowsRaw ?? []) as unknown as ReceiptRow[]
    ).map((r) => ({
      recipientId: r.id,
      name: fullName(r.employee) ?? "Unknown employee",
      read_at: r.read_at,
      acknowledged_at: r.acknowledged_at,
    }))

    return (
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8">
        <PageHeader
          variant="display"
          module="comms"
          band
          eyebrow="Communications"
          breadcrumb={
            <Breadcrumb
              segments={[
                { label: "Reports", href: "/reports" },
                {
                  label: "Communications",
                  href: "/reports/communications?inbox=sent",
                },
                { label: "Sent message" },
              ]}
            />
          }
          title="Sent message"
        />

        <Card>
          <CardHeader>
            <p className="text-sm text-muted-foreground">
              Sent {formatTimestamp(sentMessage.sent_at, tz)}
            </p>
            <CardTitle className="mt-1 text-xl">
              {sentMessage.subject && sentMessage.subject.trim().length > 0
                ? sentMessage.subject
                : "(No subject)"}
            </CardTitle>
            {sentMessage.requires_acknowledgement ? (
              <CardDescription className="mt-1">
                Acknowledgement required.
              </CardDescription>
            ) : null}
          </CardHeader>
          <CardContent>
            <p className="whitespace-pre-wrap text-sm leading-relaxed">
              {sentMessage.body}
            </p>
          </CardContent>
        </Card>

        <ReceiptsList
          receipts={receipts}
          requiresAck={sentMessage.requires_acknowledgement}
          timezone={tz}
        />

        <div>
          <Button asChild variant="outline">
            <Link href="/reports/communications?inbox=sent">
              Back to sent messages
            </Link>
          </Button>
        </div>
      </div>
    )
  }

  // ---- INBOX LIST ----
  const inboxParam = pickParam(sp.inbox)
  const tab: "alerts" | "messages" | "sent" =
    inboxParam === "messages"
      ? "messages"
      : inboxParam === "sent" && canSubmit
        ? "sent"
        : "alerts"

  // NOTE on routing: the staff inbox intentionally shows EVERY facility alert
  // to every viewer with communications access — alerts are operational safety
  // signals, not personal mail. `communication_routing_rules` control who gets
  // NOTIFIED (email / outbox fan-out via dispatch_rules_for_submission), not
  // who can see the alert here. Deliberate scope decision; revisit only if a
  // real per-audience-visibility requirement appears.
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
  type RecipientJoined = MessageInboxItem["recipient"] & {
    message: MessageJoined | null
  }

  const { data: recipientsRaw } = await supabase
    .from("communication_recipients")
    .select(
      "id, message_id, employee_id, facility_id, delivered_at, read_at, acknowledged_at, created_at, email_status, email_sent_at, email_error, email_attempts, email_next_attempt_at, message:communication_messages!communication_recipients_message_id_fkey(id, facility_id, sender_employee_id, parent_message_id, subject, body, requires_acknowledgement, sent_at, created_at, updated_at, template_id, pdf_url, sender:employees!communication_messages_sender_employee_id_fkey(first_name, last_name))"
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
        email_status: r.email_status,
        email_sent_at: r.email_sent_at,
        email_error: r.email_error,
        email_attempts: r.email_attempts,
        email_next_attempt_at: r.email_next_attempt_at,
      },
      message: {
        id: r.message.id,
        facility_id: r.message.facility_id,
        sender_employee_id: r.message.sender_employee_id,
        parent_message_id: r.message.parent_message_id ?? null,
        subject: r.message.subject,
        body: r.message.body,
        requires_acknowledgement: r.message.requires_acknowledgement,
        sent_at: r.message.sent_at,
        created_at: r.message.created_at,
        updated_at: r.message.updated_at,
        template_id: r.message.template_id,
        pdf_url: r.message.pdf_url ?? null,
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

  // Sent tab: my authored messages with read/ack rollups (sender receipt
  // visibility comes from the mig-170 recipients SELECT extension).
  let sentItems: SentListItem[] = []
  if (tab === "sent") {
    const { data: sentRaw } = await supabase
      .from("communication_messages")
      .select("id, subject, body, sent_at, requires_acknowledgement")
      .eq("facility_id", employeeRow.facility_id)
      .eq("sender_employee_id", employeeRow.id)
      .order("sent_at", { ascending: false })
      .limit(100)

    const sentMessages = sentRaw ?? []
    const sentIds = sentMessages.map((m) => m.id)
    const rollups = new Map<
      string,
      { recipients: number; read: number; acked: number }
    >()
    if (sentIds.length > 0) {
      const { data: recipRows } = await supabase
        .from("communication_recipients")
        .select("message_id, read_at, acknowledged_at")
        .in("message_id", sentIds)
      for (const r of recipRows ?? []) {
        const c = rollups.get(r.message_id) ?? {
          recipients: 0,
          read: 0,
          acked: 0,
        }
        c.recipients += 1
        if (r.read_at) c.read += 1
        if (r.acknowledged_at) c.acked += 1
        rollups.set(r.message_id, c)
      }
    }
    sentItems = sentMessages.map((m) => {
      const c = rollups.get(m.id)
      return {
        messageId: m.id,
        subject: m.subject,
        body: m.body,
        sent_at: m.sent_at,
        requires_acknowledgement: m.requires_acknowledgement,
        recipientCount: c?.recipients ?? 0,
        readCount: c?.read ?? 0,
        ackCount: c?.acked ?? 0,
      }
    })
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8">
      <PageHeader
        variant="display"
        module="comms"
        band
        breadcrumb={
          <Breadcrumb
            segments={[
              { label: "Reports", href: "/reports" },
              { label: "Communications" },
            ]}
          />
        }
        title="Communications"
        actions={
          canSubmit ? (
            <Button asChild>
              <Link href="/reports/communications/compose">New message</Link>
            </Button>
          ) : null
        }
      />

      <InboxTabs
        active={tab}
        unreadAlerts={unreadAlerts}
        unreadMessages={unreadMessages}
        showSent={canSubmit}
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
      ) : tab === "sent" ? (
        sentItems.length === 0 ? (
          <Card>
            <CardHeader>
              <CardTitle>No sent messages</CardTitle>
              <CardDescription>
                Messages you send will show up here with read and
                acknowledgement receipts.
              </CardDescription>
            </CardHeader>
          </Card>
        ) : (
          <SentList items={sentItems} timezone={tz} />
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
