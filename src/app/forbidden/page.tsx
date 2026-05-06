import Link from "next/link"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { getCurrentUser } from "@/lib/auth"

export const metadata = {
  title: "Access denied",
}

export default async function ForbiddenPage() {
  const current = await getCurrentUser()
  const email =
    current?.profile?.email ?? current?.authUser.email ?? null
  const fullName = current?.profile?.full_name ?? null

  return (
    <main className="bg-background flex min-h-screen items-center justify-center px-4 py-10">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-xl">Access denied</CardTitle>
          <CardDescription>
            This page requires admin permissions. Contact a super admin if
            you need access.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {email ? (
            <div className="text-muted-foreground rounded-md border px-3 py-2 text-sm">
              <div className="text-foreground font-medium">
                Signed in as
              </div>
              {fullName ? <div>{fullName}</div> : null}
              <div className="break-all">{email}</div>
            </div>
          ) : (
            <div className="text-muted-foreground text-sm">
              You are not signed in.
            </div>
          )}
        </CardContent>
        <CardFooter className="flex flex-col gap-2 sm:flex-row sm:justify-end">
          <Button asChild variant="outline" className="sm:w-auto">
            <Link href="/">Go to home</Link>
          </Button>
          <form action="/logout" method="post" className="sm:w-auto">
            <Button type="submit" variant="destructive" className="w-full">
              Sign out
            </Button>
          </form>
        </CardFooter>
      </Card>
    </main>
  )
}
