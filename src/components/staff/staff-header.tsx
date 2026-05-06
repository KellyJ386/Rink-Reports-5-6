import Link from "next/link"

type StaffHeaderProps = {
  email: string | null
  fullName: string | null
}

export function StaffHeader({ email, fullName }: StaffHeaderProps) {
  const displayName = fullName?.trim() || email || "Signed in"

  return (
    <header className="sticky top-0 z-30 flex min-h-14 items-center gap-3 border-b bg-background/95 px-4 py-2 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <Link
        href="/reports"
        className="text-base font-semibold tracking-tight text-foreground"
      >
        Rink Reports
      </Link>
      <div className="ml-auto flex items-center gap-3">
        <span
          className="hidden truncate text-sm text-muted-foreground sm:inline-block sm:max-w-[14rem]"
          title={email ?? undefined}
        >
          {displayName}
        </span>
        <form action="/logout" method="post">
          <button
            type="submit"
            className="inline-flex h-10 min-w-[44px] items-center justify-center rounded-md border bg-background px-3 text-sm font-medium shadow-xs transition-colors hover:bg-accent hover:text-accent-foreground"
          >
            Sign out
          </button>
        </form>
      </div>
    </header>
  )
}
