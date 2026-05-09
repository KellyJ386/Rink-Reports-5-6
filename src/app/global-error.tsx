"use client"

export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <html>
      <body className="flex min-h-screen flex-col items-center justify-center gap-4">
        <h2 className="text-xl font-semibold">Something went wrong</h2>
        <button
          onClick={reset}
          className="rounded bg-primary px-4 py-2 text-sm"
        >
          Try again
        </button>
      </body>
    </html>
  )
}
