import { MODULE_KEYS, MODULE_LABELS } from "./types"

export default function Loading() {
  const skeletonRows = Array.from({ length: 8 })

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          Module Access Control
        </h1>
        <p className="text-muted-foreground text-sm">
          Toggle per-employee access to each module. V = View, S = Submit, A =
          Admin.
        </p>
      </div>

      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-2">
          <div className="bg-muted h-9 w-full max-w-sm animate-pulse rounded-md" />
        </div>

        <div className="relative max-h-[70vh] overflow-auto rounded-md border">
          <table className="w-full border-collapse text-sm">
            <thead className="bg-muted/60 sticky top-0 z-20">
              <tr>
                <th
                  scope="col"
                  className="bg-muted/60 sticky left-0 z-30 min-w-[220px] border-b px-3 py-2 text-left font-medium"
                >
                  Employee
                </th>
                {MODULE_KEYS.map((mod) => (
                  <th
                    key={mod}
                    scope="col"
                    className="border-b border-l px-2 py-2 text-center font-medium"
                  >
                    <div className="flex flex-col items-center gap-0.5">
                      <span className="whitespace-nowrap">
                        {MODULE_LABELS[mod]}
                      </span>
                      <span className="text-muted-foreground flex gap-2 text-[10px] font-normal tracking-wider uppercase">
                        <span>V</span>
                        <span>S</span>
                        <span>A</span>
                      </span>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {skeletonRows.map((_, i) => (
                <tr key={i}>
                  <th
                    scope="row"
                    className="bg-background sticky left-0 z-10 border-b px-3 py-2 text-left align-top font-normal"
                  >
                    <div className="flex flex-col gap-1">
                      <div className="bg-muted h-4 w-32 animate-pulse rounded" />
                      <div className="bg-muted h-3 w-40 animate-pulse rounded" />
                      <div className="bg-muted mt-1 h-4 w-20 animate-pulse rounded" />
                    </div>
                  </th>
                  {MODULE_KEYS.map((mod) => (
                    <td
                      key={mod}
                      className="border-b border-l px-2 py-2 align-middle"
                    >
                      <div className="flex items-center justify-center gap-2">
                        <div className="bg-muted size-3.5 animate-pulse rounded" />
                        <div className="bg-muted size-3.5 animate-pulse rounded" />
                        <div className="bg-muted size-3.5 animate-pulse rounded" />
                      </div>
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
