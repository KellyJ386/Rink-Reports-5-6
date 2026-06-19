import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

import { UpdatePasswordForm } from "./update-password-form"

export const metadata = {
  title: "Set your password | MFO / Rink Reports",
}

const LINK_EXPIRED_MESSAGE =
  "Your link has expired or has already been used. Ask your administrator to re-send it."

export default async function UpdatePasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
}) {
  const { error } = await searchParams
  const linkError = error === "link_expired" ? LINK_EXPIRED_MESSAGE : undefined

  return (
    <Card>
      <CardHeader>
        <CardTitle>Set your password</CardTitle>
        <CardDescription>
          Choose a new password to finish setting up your account.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <UpdatePasswordForm initialError={linkError} />
      </CardContent>
    </Card>
  )
}
