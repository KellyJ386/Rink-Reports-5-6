import * as React from "react"

import { FieldError } from "@/components/ui/field-error"
import { Label } from "@/components/ui/label"
import { RequiredMark } from "@/components/ui/required-mark"
import { cn } from "@/lib/utils"

interface FormFieldProps {
  label: React.ReactNode
  /** Set when the slotted control has a matching `id`. Also used to derive the error element id. */
  htmlFor?: string
  required?: boolean
  hint?: React.ReactNode
  error?: string
  className?: string
  /**
   * The slotted control (Input / Select / Textarea / etc.). The control
   * keeps its own explicit `aria-invalid` / `aria-describedby` /
   * `autoComplete` props — this wrapper does NOT inject them. That
   * preserves the existing focus-on-first-error behavior wired through
   * `useActionState` field errors.
   */
  children: React.ReactNode
}

export function FormField({
  label,
  htmlFor,
  required,
  hint,
  error,
  className,
  children,
}: FormFieldProps) {
  const errorId = htmlFor ? `${htmlFor}-error` : undefined
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <Label htmlFor={htmlFor}>
        {label}
        {required ? <RequiredMark /> : null}
      </Label>
      {children}
      {hint && !error ? (
        <p className="text-xs text-muted-foreground">{hint}</p>
      ) : null}
      {errorId ? <FieldError id={errorId} message={error} /> : null}
    </div>
  )
}
