"use client"

import { SegmentError } from "@/components/app/segment-error"

export default function SchedulingError(props: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <SegmentError
      {...props}
      title="Scheduling hit an error"
      homeHref="/admin/scheduling"
      homeLabel="Back to Scheduling overview"
    />
  )
}
