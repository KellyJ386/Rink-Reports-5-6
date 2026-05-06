import { Button } from "@/components/ui/button"

type SignOutButtonProps = {
  className?: string
  variant?: React.ComponentProps<typeof Button>["variant"]
  children?: React.ReactNode
}

export function SignOutButton({
  className,
  variant = "outline",
  children = "Sign out",
}: SignOutButtonProps) {
  return (
    <form action="/logout" method="post" className={className}>
      <Button type="submit" variant={variant} size="lg">
        {children}
      </Button>
    </form>
  )
}
