"use client"

import { SegmentError } from "@/components/app/segment-error"

export default function AdminError(props: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <SegmentError
      {...props}
      title="This admin page hit an error"
      homeHref="/admin"
      homeLabel="Back to Admin home"
    />
  )
}
