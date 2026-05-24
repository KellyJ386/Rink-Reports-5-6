import Link from "next/link"

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="relative flex min-h-screen flex-1 flex-col items-center justify-center bg-background px-4 py-12">
      {/* Subtle sky-accent halo so login feels like a destination, not a flat page. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_60%_50%_at_50%_0%,var(--surface-tinted),transparent_70%)] dark:bg-[radial-gradient(ellipse_60%_50%_at_50%_0%,rgba(94,190,240,0.10),transparent_70%)]"
      />
      <div className="w-full max-w-md">
        <div className="mb-8 flex flex-col items-center text-center">
          <Link
            href="/"
            className="text-xl font-semibold tracking-tight text-foreground"
          >
            MFO / Rink Reports
          </Link>
          <p className="mt-1 text-sm text-muted-foreground">
            Facility operations console
          </p>
        </div>
        {children}
      </div>
    </div>
  )
}
