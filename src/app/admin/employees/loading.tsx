export default function Loading() {
  const rows = Array.from({ length: 6 })
  return (
    <div className="flex flex-col gap-6 p-4 md:p-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          Employee / User Setup
        </h1>
        <p className="text-muted-foreground text-sm">
          Add staff, assign roles and departments, manage activation.
        </p>
      </div>

      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-2">
          <div className="bg-muted h-9 w-full max-w-sm animate-pulse rounded-md" />
          <div className="bg-muted h-9 w-32 animate-pulse rounded-md" />
        </div>

        <div className="overflow-auto rounded-md border">
          <table className="w-full border-collapse text-sm">
            <thead className="bg-muted/60 sticky top-0 z-10">
              <tr>
                {[
                  "Name",
                  "Role",
                  "Department",
                  "Email",
                  "Phone",
                  "Status",
                  "",
                ].map((h, i) => (
                  <th
                    key={i}
                    className="border-b px-3 py-2 text-left font-medium"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((_, i) => (
                <tr key={i}>
                  {Array.from({ length: 7 }).map((__, j) => (
                    <td key={j} className="border-b px-3 py-3">
                      <div className="bg-muted h-4 w-full animate-pulse rounded" />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
