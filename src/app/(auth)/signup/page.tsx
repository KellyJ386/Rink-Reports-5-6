import Link from "next/link"

import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

import { SignupForm } from "./signup-form"

export const metadata = {
  title: "Create account | MFO / Rink Reports",
}

export default function SignupPage() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Create account</CardTitle>
        <CardDescription>
          Sign up to request access. An administrator will assign your facility
          once you confirm your email.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <SignupForm />
      </CardContent>
      <CardFooter className="justify-center text-sm text-muted-foreground">
        <span>
          Already have an account?{" "}
          <Link
            href="/login"
            className="font-medium text-foreground underline-offset-4 hover:underline"
          >
            Sign in
          </Link>
        </span>
      </CardFooter>
    </Card>
  )
}
