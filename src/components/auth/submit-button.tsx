"use client"

import { useFormStatus } from "react-dom"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

type SubmitButtonProps = React.ComponentProps<typeof Button> & {
  pendingLabel?: string
}

export function SubmitButton({
  children,
  pendingLabel,
  disabled,
  className,
  ...props
}: SubmitButtonProps) {
  const { pending } = useFormStatus()
  return (
    <Button
      type="submit"
      disabled={pending || disabled}
      className={cn(className)}
      {...props}
    >
      {pending && pendingLabel ? pendingLabel : children}
    </Button>
  )
}
