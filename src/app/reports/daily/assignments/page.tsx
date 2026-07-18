import Link from "next/link"
import { ArrowLeft } from "lucide-react"

import { Breadcrumb } from "@/components/ui/breadcrumb"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { PageHeader } from "@/components/ui/page-header"
import { requireUser } from "@/lib/auth"

import { AssignmentBoardView } from "../_components/assignment-board"
import { getAssignmentBoard } from "../_lib/assignments"

export const dynamic = "force-dynamic"
export const metadata = { title: "Area Assignments | Rink Reports" }

// Supervisor/admin view (D5): today's areas with assignees + completion, the
// pre-lock warning for incomplete assigned areas, and one-tap reassignment
// (D10 sick-day path). Gated on the daily_reports edit/admin tier — both here
// (getAssignmentBoard checks) and by RLS on every write.
export default async function DailyAssignmentsPage() {
  await requireUser()
  const board = await getAssignmentBoard()

  const shell = (children: React.ReactNode) => (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8">
      <PageHeader
        variant="display"
        module="daily"
        band
        breadcrumb={
          <Breadcrumb
            segments={[
              { label: "Reports", href: "/reports" },
              { label: "Daily Reports", href: "/reports/daily" },
              { label: "Assignments" },
            ]}
          />
        }
        title="Area Assignments"
        actions={
          <Button asChild variant="outline" size="sm">
            <Link href="/reports/daily">
              <ArrowLeft className="h-4 w-4" aria-hidden />
              Back to reports
            </Link>
          </Button>
        }
      />
      {children}
    </div>
  )

  if (!board.ok) {
    return shell(
      <Card>
        <CardHeader>
          <CardTitle>Not available</CardTitle>
          <CardDescription>{board.error}</CardDescription>
        </CardHeader>
      </Card>,
    )
  }

  return shell(<AssignmentBoardView board={board.data} />)
}
