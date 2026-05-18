/**
 * Visible "*" marker for required form fields. The asterisk itself is
 * aria-hidden because the input's `required` / `aria-required="true"`
 * attribute already announces required state to AT — without aria-hidden,
 * screen readers would say "asterisk" on every required label.
 */
export function RequiredMark() {
  return (
    <span aria-hidden="true" className="ml-1 text-destructive">
      *
    </span>
  )
}
