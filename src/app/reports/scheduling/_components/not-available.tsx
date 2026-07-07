import { SignOutButton } from "@/components/staff/sign-out-button"
import {
  Breadcrumb,
  type BreadcrumbSegment,
} from "@/components/ui/breadcrumb"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

// Shared "account not set up / no permission" fallback for the staff
// scheduling pages. Each page passes its own breadcrumb trail.
export function NotAvailable({
  title,
  description,
  segments,
  showSignOut = false,
}: {
  title: string
  description: string
  segments: BreadcrumbSegment[]
  showSignOut?: boolean
}) {
  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-6 px-4 py-10">
      <Breadcrumb segments={segments} />
      <Card>
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        {showSignOut ? (
          <CardContent>
            <SignOutButton />
          </CardContent>
        ) : null}
      </Card>
    </div>
  )
}
