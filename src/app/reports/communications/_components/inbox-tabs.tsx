import Link from "next/link"

type Props = {
  active: "alerts" | "messages"
  unreadAlerts: number
  unreadMessages: number
}

export function InboxTabs({ active, unreadAlerts, unreadMessages }: Props) {
  // These are links that trigger full navigations, not an ARIA tabs widget —
  // faking role="tablist"/"tab" without the tabs keyboard contract reads
  // worse to assistive tech than honest navigation semantics.
  return (
    <nav aria-label="Inbox" className="flex gap-2 border-b border-border">
      <TabLink
        href="/reports/communications?inbox=alerts"
        active={active === "alerts"}
        label="Alerts"
        count={unreadAlerts}
      />
      <TabLink
        href="/reports/communications?inbox=messages"
        active={active === "messages"}
        label="Messages"
        count={unreadMessages}
      />
    </nav>
  )
}

function TabLink({
  href,
  active,
  label,
  count,
}: {
  href: string
  active: boolean
  label: string
  count: number
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`relative inline-flex h-11 items-center gap-2 px-4 text-sm font-medium transition-colors ${
        active
          ? "border-b-2 border-primary text-foreground"
          : "border-b-2 border-transparent text-muted-foreground hover:text-foreground"
      }`}
    >
      {label}
      {count > 0 ? (
        <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-primary px-1.5 py-0.5 text-xs font-semibold text-primary-foreground">
          {count}
        </span>
      ) : null}
    </Link>
  )
}
