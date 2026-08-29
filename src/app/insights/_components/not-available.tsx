import Link from "next/link"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

/**
 * Staff who lack the 'reports' grant get a real explanation, not an empty
 * page or a login bounce — the same convention the rink-scheduling insights
 * page follows for its own permission gate.
 */
export function NotAvailable({ reason }: { reason?: "no-facility" }) {
  const body =
    reason === "no-facility"
      ? "Your account is not attached to a facility yet, so there are no reports to show. An administrator can set this up."
      : "You do not have access to Insights. If you need it, ask an administrator to grant you the Reports permission."

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8">
      <Card>
        <CardHeader>
          <CardTitle>Insights not available</CardTitle>
          <CardDescription>{body}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild variant="outline">
            <Link href="/dashboard">Back to dashboard</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
