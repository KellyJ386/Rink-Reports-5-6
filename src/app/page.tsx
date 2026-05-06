import Link from "next/link"
import { redirect } from "next/navigation"

import { Button } from "@/components/ui/button"
import { getCurrentUser } from "@/lib/auth"

export default async function Home() {
  const current = await getCurrentUser()
  if (current) {
    redirect("/admin")
  }

  return (
    <main className="flex min-h-screen flex-1 flex-col items-center justify-center bg-zinc-50 px-6 py-16 dark:bg-zinc-950">
      <div className="flex w-full max-w-xl flex-col items-center text-center">
        <h1 className="text-4xl font-semibold tracking-tight text-zinc-900 sm:text-5xl dark:text-zinc-50">
          MFO / Rink Reports
        </h1>
        <p className="mt-4 max-w-md text-base text-zinc-600 dark:text-zinc-400">
          The operations console for Max Facility ice rinks. Schedules, staff,
          and reporting in one place.
        </p>
        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <Button asChild size="lg">
            <Link href="/login">Sign in</Link>
          </Button>
          <Button asChild size="lg" variant="outline">
            <Link href="/signup">Create account</Link>
          </Button>
        </div>
      </div>
    </main>
  )
}
