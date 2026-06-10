"use client"

import { SegmentError } from "@/components/app/segment-error"

export default function ReportsError(props: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <SegmentError
      {...props}
      title="This report page hit an error"
      homeHref="/dashboard"
      homeLabel="Back to Dashboard"
    />
  )
}
