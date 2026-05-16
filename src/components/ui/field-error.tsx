/**
 * Per-field inline validation error message. Pair with an input that
 * sets `aria-invalid="true"` and `aria-describedby` to this element's
 * id — that way screen readers announce the message when the field
 * receives focus, and visually-sighted users see it directly under
 * the input.
 *
 * `role="alert"` causes assistive tech to announce the error
 * immediately when it appears, which is the right behavior for
 * post-submit server-side validation errors. (For client-side
 * onChange validation, use `aria-live="polite"` instead so AT
 * doesn't interrupt typing.)
 */
export function FieldError({ id, message }: { id: string; message: string | undefined }) {
  if (!message) return null
  return (
    <p id={id} role="alert" className="text-sm text-destructive">
      {message}
    </p>
  )
}
