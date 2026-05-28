import Link from "next/link"

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { PageHeader } from "@/components/ui/page-header"
import { TabNav } from "@/components/ui/tab-nav"
import { ExportButton } from "@/components/admin/export-button"
import { requireAdmin } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"

import { AuditTab } from "./_components/audit-tab"
import { GroupsTab } from "./_components/groups-tab"
import { InboxTab } from "./_components/inbox-tab"
import { RemindersTab } from "./_components/reminders-tab"
import { RoutingTab } from "./_components/routing-tab"
import { TemplatesTab } from "./_components/templates-tab"
import type {
  AcknowledgementRow,
  AlertDetailData,
  AlertRow,
  AlertWithCounts,
  AuditLogItem,
  AuditLogRow,
  EmployeeLite,
  GroupDetail,
  GroupMemberRow,
  GroupRow,
  GroupWithCount,
  MessageListItem,
  MessageRow,
  RecipientRow,
  ReminderRow,
  ReminderWithRefs,
  RoutingRuleRow,
  RoutingRuleWithRefs,
  Tab,
  TemplateRow,
} from "./types"
import { TABS, asInboxView, asTab } from "./types"

export const dynamic = "force-dynamic"

type SearchParams = Promise<{
  tab?: string
  inbox?: string
  alert?: string
  group?: string
  module?: string
  severity?: string
  resolved?: string
  q?: string
  from?: string
  to?: string
  // audit
  entity_type?: string
  action?: string
  actor?: string
}>

function tabHref(tab: Tab): string {
  const sp = new URLSearchParams()
  sp.set("tab", tab)
  return `/admin/communications?${sp.toString()}`
}

function defaultDateFrom(): string {
  const d = new Date()
  d.setDate(d.getDate() - 30)
  return d.toISOString().slice(0, 10)
}

export const metadata = { title: "Communications | MFO / Rink Reports" }

export default async function CommunicationsAdminPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const current = await requireAdmin()
  const params = await searchParams
  const tab = asTab(params.tab)
  const profile = current.profile
  const facilityId = profile?.facility_id ?? null

  if (!facilityId) {
    return (
      <div className="flex flex-col gap-6 p-4 md:p-6">
        <Header />
        <Card>
          <CardHeader>
            <CardTitle>No facility yet</CardTitle>
            <CardDescription>
              Create a facility before configuring communications.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link href="/admin/facility">Go to Facility Settings</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6 p-4 md:p-6">
      <Header />
      <TabBar active={tab} />

      {tab === "inbox" && (
        <InboxTabLoader facilityId={facilityId} params={params} />
      )}
      {tab === "templates" && <TemplatesTabLoader facilityId={facilityId} />}
      {tab === "groups" && (
        <GroupsTabLoader facilityId={facilityId} params={params} />
      )}
      {tab === "routing" && <RoutingTabLoader facilityId={facilityId} />}
      {tab === "reminders" && <RemindersTabLoader facilityId={facilityId} />}
      {tab === "audit" && (
        <AuditTabLoader facilityId={facilityId} params={params} />
      )}
    </div>
  )
}

function Header() {
  return (
    <PageHeader
      title="Communications"
      description="Review alerts and messages, manage templates, groups, routing rules, recurring reminders, and the audit log for this facility."
      actions={<ExportButton moduleKey="communications" />}
    />
  )
}

function TabBar({ active }: { active: Tab }) {
  return (
    <TabNav
      ariaLabel="Communications sections"
      activeHref={tabHref(active)}
      items={TABS.map((t) => ({ label: t.label, href: tabHref(t.key) }))}
    />
  )
}

// ---------------------------------------------------------------------------
// Inbox tab loader
// ---------------------------------------------------------------------------

async function InboxTabLoader({
  facilityId,
  params,
}: {
  facilityId: string
  params: {
    inbox?: string
    alert?: string
    module?: string
    severity?: string
    resolved?: string
    q?: string
    from?: string
    to?: string
  }
}) {
  const supabase = await createClient()
  const view = asInboxView(params.inbox)
  const from = params.from ?? defaultDateFrom()
  const to = params.to ?? null

  const empById = new Map<string, EmployeeLite>()
  async function loadEmployees(ids: ReadonlyArray<string>): Promise<void> {
    const missing = ids.filter((id) => id && !empById.has(id))
    if (missing.length === 0) return
    const { data } = await supabase
      .from("employees")
      .select("id, first_name, last_name")
      .in("id", missing)
    for (const e of (data ?? []) as EmployeeLite[]) empById.set(e.id, e)
  }

  if (view === "alerts") {
    let q = supabase
      .from("communication_alerts")
      .select("*")
      .eq("facility_id", facilityId)
      .order("created_at", { ascending: false })
      .limit(300)
    if (params.module) q = q.eq("source_module", params.module)
    if (params.severity) q = q.eq("severity", params.severity)
    if (params.resolved === "yes") q = q.not("resolved_at", "is", null)
    if (params.resolved === "no") q = q.is("resolved_at", null)
    if (from) q = q.gte("created_at", `${from}T00:00:00.000Z`)
    if (to) q = q.lte("created_at", `${to}T23:59:59.999Z`)
    if (params.q) {
      const pat = `%${params.q}%`
      q = q.or(`title.ilike.${pat},body.ilike.${pat}`)
    }

    const { data: alertsRaw } = await q
    const alerts = (alertsRaw ?? []) as AlertRow[]

    let acks: AcknowledgementRow[] = []
    if (alerts.length > 0) {
      const ids = alerts.map((a) => a.id)
      const { data } = await supabase
        .from("communication_acknowledgements")
        .select("*")
        .in("alert_id", ids)
      acks = (data ?? []) as AcknowledgementRow[]
    }
    const ackCount = new Map<string, number>()
    for (const a of acks) {
      if (!a.alert_id) continue
      ackCount.set(a.alert_id, (ackCount.get(a.alert_id) ?? 0) + 1)
    }

    await loadEmployees(
      alerts.flatMap((a) =>
        [a.created_by_employee_id, a.resolved_by_employee_id].filter(
          (x): x is string => !!x,
        ),
      ),
    )

    const list: AlertWithCounts[] = alerts.map((a) => ({
      ...a,
      ack_count: ackCount.get(a.id) ?? 0,
      created_by: a.created_by_employee_id
        ? (empById.get(a.created_by_employee_id) ?? null)
        : null,
      resolved_by: a.resolved_by_employee_id
        ? (empById.get(a.resolved_by_employee_id) ?? null)
        : null,
    }))

    let detail: AlertDetailData | null = null
    if (params.alert) {
      let baseAlert = alerts.find((a) => a.id === params.alert) ?? null
      if (!baseAlert) {
        const { data } = await supabase
          .from("communication_alerts")
          .select("*")
          .eq("facility_id", facilityId)
          .eq("id", params.alert)
          .maybeSingle()
        baseAlert = (data ?? null) as AlertRow | null
      }
      if (baseAlert) {
        const { data: ackRows } = await supabase
          .from("communication_acknowledgements")
          .select("*")
          .eq("alert_id", baseAlert.id)
          .order("acknowledged_at", { ascending: true })
        const ackData = (ackRows ?? []) as AcknowledgementRow[]
        await loadEmployees(ackData.map((a) => a.employee_id))
        await loadEmployees(
          [
            baseAlert.created_by_employee_id,
            baseAlert.resolved_by_employee_id,
          ].filter((x): x is string => !!x),
        )
        detail = {
          alert: baseAlert,
          acknowledgements: ackData.map((a) => ({
            ...a,
            employee: empById.get(a.employee_id) ?? null,
          })),
          created_by: baseAlert.created_by_employee_id
            ? (empById.get(baseAlert.created_by_employee_id) ?? null)
            : null,
          resolved_by: baseAlert.resolved_by_employee_id
            ? (empById.get(baseAlert.resolved_by_employee_id) ?? null)
            : null,
        }
      }
    }

    return (
      <InboxTab
        view="alerts"
        alerts={list}
        alertDetail={detail}
        messages={[]}
        params={{ ...params, from }}
      />
    )
  }

  // Messages view.
  let mq = supabase
    .from("communication_messages")
    .select("*")
    .eq("facility_id", facilityId)
    .order("sent_at", { ascending: false })
    .limit(200)
  if (from) mq = mq.gte("sent_at", `${from}T00:00:00.000Z`)
  if (to) mq = mq.lte("sent_at", `${to}T23:59:59.999Z`)
  if (params.q) {
    const pat = `%${params.q}%`
    mq = mq.or(`subject.ilike.${pat},body.ilike.${pat}`)
  }
  const { data: msgsRaw } = await mq
  const messages = (msgsRaw ?? []) as MessageRow[]

  let recipients: RecipientRow[] = []
  if (messages.length > 0) {
    const ids = messages.map((m) => m.id)
    const { data } = await supabase
      .from("communication_recipients")
      .select("*")
      .in("message_id", ids)
    recipients = (data ?? []) as RecipientRow[]
  }
  const recAgg = new Map<
    string,
    { total: number; read: number; ack: number }
  >()
  for (const r of recipients) {
    const cur = recAgg.get(r.message_id) ?? { total: 0, read: 0, ack: 0 }
    cur.total += 1
    if (r.read_at) cur.read += 1
    if (r.acknowledged_at) cur.ack += 1
    recAgg.set(r.message_id, cur)
  }

  await loadEmployees(
    messages.map((m) => m.sender_employee_id).filter((x): x is string => !!x),
  )

  const messageList: MessageListItem[] = messages.map((m) => {
    const agg = recAgg.get(m.id) ?? { total: 0, read: 0, ack: 0 }
    return {
      ...m,
      sender: m.sender_employee_id
        ? (empById.get(m.sender_employee_id) ?? null)
        : null,
      recipient_count: agg.total,
      read_count: agg.read,
      ack_count: agg.ack,
    }
  })

  return (
    <InboxTab
      view="messages"
      alerts={[]}
      alertDetail={null}
      messages={messageList}
      params={{ ...params, from }}
    />
  )
}

// ---------------------------------------------------------------------------
// Templates tab loader
// ---------------------------------------------------------------------------

async function TemplatesTabLoader({ facilityId }: { facilityId: string }) {
  const supabase = await createClient()
  const { data } = await supabase
    .from("communication_templates")
    .select("*")
    .eq("facility_id", facilityId)
    .order("name", { ascending: true })
  const templates = (data ?? []) as TemplateRow[]
  return <TemplatesTab templates={templates} />
}

// ---------------------------------------------------------------------------
// Groups tab loader
// ---------------------------------------------------------------------------

async function GroupsTabLoader({
  facilityId,
  params,
}: {
  facilityId: string
  params: { group?: string }
}) {
  const supabase = await createClient()
  const [groupsRes, memberCountsRes] = await Promise.all([
    supabase
      .from("communication_groups")
      .select("*")
      .eq("facility_id", facilityId)
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true }),
    supabase
      .from("communication_group_members")
      .select("group_id")
      .eq("facility_id", facilityId),
  ])
  const groups = (groupsRes.data ?? []) as GroupRow[]
  const counts = new Map<string, number>()
  for (const r of (memberCountsRes.data ?? []) as Array<{ group_id: string }>) {
    counts.set(r.group_id, (counts.get(r.group_id) ?? 0) + 1)
  }
  const list: GroupWithCount[] = groups.map((g) => ({
    ...g,
    member_count: counts.get(g.id) ?? 0,
  }))

  let detail: GroupDetail | null = null
  if (params.group) {
    const group = groups.find((g) => g.id === params.group) ?? null
    if (group) {
      const [membersRes, employeesRes] = await Promise.all([
        supabase
          .from("communication_group_members")
          .select("*")
          .eq("group_id", group.id)
          .eq("facility_id", facilityId),
        supabase
          .from("employees")
          .select("id, first_name, last_name, is_active")
          .eq("facility_id", facilityId)
          .eq("is_active", true)
          .order("last_name", { ascending: true }),
      ])
      const memberRows = (membersRes.data ?? []) as GroupMemberRow[]
      const allEmps = ((employeesRes.data ?? []) as Array<
        EmployeeLite & { is_active: boolean }
      >).map(({ id, first_name, last_name }) => ({
        id,
        first_name,
        last_name,
      }))
      const empById = new Map(allEmps.map((e) => [e.id, e]))
      detail = {
        group,
        members: memberRows.map((m) => ({
          ...m,
          employee: empById.get(m.employee_id) ?? null,
        })),
        facility_employees: allEmps,
      }
    }
  }

  return (
    <GroupsTab
      groups={list}
      detail={detail}
      activeGroupId={params.group ?? null}
    />
  )
}

// ---------------------------------------------------------------------------
// Routing tab loader
// ---------------------------------------------------------------------------

async function RoutingTabLoader({ facilityId }: { facilityId: string }) {
  const supabase = await createClient()
  const [rulesRes, groupsRes, employeesRes, deptsRes] = await Promise.all([
    supabase
      .from("communication_routing_rules")
      .select("*")
      .eq("facility_id", facilityId)
      .order("priority", { ascending: false })
      .order("source_module", { ascending: true }),
    supabase
      .from("communication_groups")
      .select("*")
      .eq("facility_id", facilityId)
      .eq("is_active", true)
      .order("name", { ascending: true }),
    supabase
      .from("employees")
      .select("id, first_name, last_name")
      .eq("facility_id", facilityId)
      .eq("is_active", true)
      .order("last_name", { ascending: true }),
    supabase
      .from("departments")
      .select("id, name")
      .eq("facility_id", facilityId)
      .order("name", { ascending: true }),
  ])
  // rulesRes.data carries columns added in migrations 45 + 63
  // (target_department_id, timing, attach_pdf, requires_acknowledgement) at
  // runtime, but the generated RoutingRuleRow type doesn't yet know about
  // them. Cast through unknown to widen.
  const rules = (rulesRes.data ?? []) as unknown as Array<
    RoutingRuleRow & {
      target_department_id: string | null
      timing: "immediate" | "end_of_day" | "weekly" | "manual" | null
      attach_pdf: boolean | null
      requires_acknowledgement: boolean | null
    }
  >
  const groups = (groupsRes.data ?? []) as GroupRow[]
  const employees = (employeesRes.data ?? []) as EmployeeLite[]
  const departments = (deptsRes.data ?? []) as Array<{ id: string; name: string }>
  const groupById = new Map(groups.map((g) => [g.id, g]))
  const empById = new Map(employees.map((e) => [e.id, e]))
  const list: RoutingRuleWithRefs[] = rules.map((r) => ({
    ...r,
    target_group: r.target_group_id
      ? (groupById.get(r.target_group_id) ?? null)
      : null,
    target_employee: r.target_employee_id
      ? (empById.get(r.target_employee_id) ?? null)
      : null,
  }))

  return (
    <RoutingTab
      rules={list}
      groups={groups}
      employees={employees}
      departments={departments}
    />
  )
}

// ---------------------------------------------------------------------------
// Reminders tab loader
// ---------------------------------------------------------------------------

async function RemindersTabLoader({ facilityId }: { facilityId: string }) {
  const supabase = await createClient()
  const [remindersRes, templatesRes, groupsRes] = await Promise.all([
    supabase
      .from("communication_recurring_reminders")
      .select("*")
      .eq("facility_id", facilityId)
      .order("name", { ascending: true }),
    supabase
      .from("communication_templates")
      .select("*")
      .eq("facility_id", facilityId)
      .order("name", { ascending: true }),
    supabase
      .from("communication_groups")
      .select("*")
      .eq("facility_id", facilityId)
      .eq("is_active", true)
      .order("name", { ascending: true }),
  ])
  const reminders = (remindersRes.data ?? []) as ReminderRow[]
  const templates = (templatesRes.data ?? []) as TemplateRow[]
  const groups = (groupsRes.data ?? []) as GroupRow[]
  const tplById = new Map(templates.map((t) => [t.id, t]))
  const groupById = new Map(groups.map((g) => [g.id, g]))
  const list: ReminderWithRefs[] = reminders.map((r) => ({
    ...r,
    template: tplById.get(r.template_id) ?? null,
    target_group: r.target_group_id
      ? (groupById.get(r.target_group_id) ?? null)
      : null,
  }))
  return <RemindersTab reminders={list} templates={templates} groups={groups} />
}

// ---------------------------------------------------------------------------
// Audit tab loader
// ---------------------------------------------------------------------------

async function AuditTabLoader({
  facilityId,
  params,
}: {
  facilityId: string
  params: {
    entity_type?: string
    action?: string
    actor?: string
    from?: string
    to?: string
  }
}) {
  const supabase = await createClient()
  const from = params.from ?? defaultDateFrom()
  const to = params.to ?? null

  let q = supabase
    .from("communication_audit_log")
    .select("*")
    .eq("facility_id", facilityId)
    .order("created_at", { ascending: false })
    .limit(500)
  if (params.entity_type) q = q.eq("entity_type", params.entity_type)
  if (params.action) q = q.eq("action", params.action)
  if (params.actor) q = q.eq("actor_employee_id", params.actor)
  if (from) q = q.gte("created_at", `${from}T00:00:00.000Z`)
  if (to) q = q.lte("created_at", `${to}T23:59:59.999Z`)
  const { data: rowsRaw } = await q
  const rows = (rowsRaw ?? []) as AuditLogRow[]

  const empIds = Array.from(
    new Set(
      rows
        .map((r) => r.actor_employee_id)
        .filter((x): x is string => !!x),
    ),
  )
  let employees: EmployeeLite[] = []
  if (empIds.length > 0) {
    const { data } = await supabase
      .from("employees")
      .select("id, first_name, last_name")
      .in("id", empIds)
    employees = (data ?? []) as EmployeeLite[]
  }
  const empById = new Map(employees.map((e) => [e.id, e]))

  const items: AuditLogItem[] = rows.map((r) => ({
    ...r,
    actor: r.actor_employee_id
      ? (empById.get(r.actor_employee_id) ?? null)
      : null,
  }))

  // Distinct values for the filter dropdowns.
  const entityTypes = Array.from(new Set(rows.map((r) => r.entity_type))).sort()
  const actions = Array.from(new Set(rows.map((r) => r.action))).sort()

  // Roster of facility employees for the actor filter.
  const { data: rosterRaw } = await supabase
    .from("employees")
    .select("id, first_name, last_name")
    .eq("facility_id", facilityId)
    .order("last_name", { ascending: true })
  const roster = (rosterRaw ?? []) as EmployeeLite[]

  return (
    <AuditTab
      items={items}
      employees={roster}
      entityTypes={entityTypes}
      actions={actions}
      params={{ ...params, from }}
    />
  )
}
