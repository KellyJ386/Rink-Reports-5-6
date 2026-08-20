import Link from "next/link"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

/** Staff who lack the grant get an explanation, not a redirect — the same
 *  convention the refrigeration and scheduling staff routes follow. */
export function NotAvailable({ reason }: { reason?: "no-facility" }) {
  const body =
    reason === "no-facility"
      ? "Your account is not attached to a facility yet, so there is no schedule to show. An administrator can set this up."
      : "You do not have access to the rink schedule. If you need it, ask an administrator to grant you the Rink Scheduling permission."

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8">
      <Card>
        <CardHeader>
          <CardTitle>Rink schedule not available</CardTitle>
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
