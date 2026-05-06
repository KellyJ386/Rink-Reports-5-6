import Link from "next/link"

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="flex min-h-screen flex-1 flex-col items-center justify-center bg-zinc-50 px-4 py-12 dark:bg-zinc-950">
      <div className="w-full max-w-md">
        <div className="mb-8 flex flex-col items-center text-center">
          <Link
            href="/"
            className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50"
          >
            MFO / Rink Reports
          </Link>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Facility operations console
          </p>
        </div>
        {children}
      </div>
    </div>
  )
}
