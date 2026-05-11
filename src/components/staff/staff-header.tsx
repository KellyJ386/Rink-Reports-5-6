import Link from "next/link"

const DISPLAY_FONT = "var(--font-anton), Anton, Impact, 'Arial Narrow', sans-serif"
const GREEN = "#4DFF00"
const BORDER = "var(--border)"
const SURFACE = "var(--card)"
const SECONDARY = "var(--muted-foreground)"

type StaffHeaderProps = {
  email: string | null
  fullName: string | null
  isAdmin?: boolean
}

export function StaffHeader({ email, fullName, isAdmin }: StaffHeaderProps) {
  const displayName = fullName?.trim() || email || "Signed in"

  return (
    <header
      style={{
        position: "sticky",
        top: 0,
        zIndex: 30,
        display: "flex",
        minHeight: 52,
        alignItems: "center",
        gap: 12,
        borderBottom: `1px solid ${BORDER}`,
        background: `${SURFACE}f5`,
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
        padding: "0 16px",
      }}
    >
      <Link
        href="/reports"
        style={{
          fontFamily: DISPLAY_FONT,
          fontSize: 18,
          letterSpacing: "0.04em",
          textTransform: "uppercase",
          color: "#ffffff",
          textDecoration: "none",
          lineHeight: 1,
        }}
      >
        Rink{" "}
        <span style={{ color: GREEN }}>Reports</span>
      </Link>
      <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 12 }}>
        <span
          style={{
            fontSize: 12,
            color: SECONDARY,
            maxWidth: 200,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
          title={email ?? undefined}
        >
          {displayName}
        </span>
        {isAdmin && (
          <Link
            href="/admin"
            style={{
              height: 34,
              padding: "0 14px",
              borderRadius: 8,
              border: `1px solid ${BORDER}`,
              background: "var(--secondary)",
              color: "#ffffff",
              fontSize: 12,
              fontWeight: 600,
              display: "flex",
              alignItems: "center",
              textDecoration: "none",
            }}
          >
            Admin
          </Link>
        )}
        <form action="/logout" method="post">
          <button
            type="submit"
            style={{
              height: 34,
              padding: "0 14px",
              borderRadius: 8,
              border: `1px solid ${BORDER}`,
              background: "var(--secondary)",
              color: "#ffffff",
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Sign out
          </button>
        </form>
      </div>
    </header>
  )
}
