import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * Shared chrome for both DataList (vertical row list, e.g. "recent
 * submissions") and DataTable (semantic table for admin pages). Kept in
 * one file so the chrome stays in sync.
 */
const listShellClasses =
  "bg-card border border-border rounded-xl overflow-hidden shadow-[var(--shadow-elev-1)]"

type DataListProps = React.HTMLAttributes<HTMLDivElement>

export function DataList({ className, children, ...props }: DataListProps) {
  return (
    <div className={cn(listShellClasses, className)} {...props}>
      {children}
    </div>
  )
}

interface DataListRowProps
  extends React.AnchorHTMLAttributes<HTMLAnchorElement> {
  as?: "a" | "div"
}

/**
 * Single row inside a DataList. Renders as an `<a>` by default (callers
 * pass `href`), or pass `as="div"` for non-interactive rows.
 */
export function DataListRow({
  as = "a",
  className,
  children,
  ...props
}: DataListRowProps) {
  const base =
    "flex items-center gap-3 px-3.5 py-3 border-b border-border last:border-0 text-sm text-foreground transition-colors"
  if (as === "div") {
    return (
      <div className={cn(base, className)} {...(props as React.HTMLAttributes<HTMLDivElement>)}>
        {children}
      </div>
    )
  }
  return (
    <a
      className={cn(base, "hover:bg-accent/40 no-underline", className)}
      {...props}
    >
      {children}
    </a>
  )
}

export type DataTableColumn<Row> = {
  key: string
  header: React.ReactNode
  className?: string
  render: (row: Row) => React.ReactNode
}

interface DataTableProps<Row> extends React.HTMLAttributes<HTMLDivElement> {
  rows: Row[]
  columns: DataTableColumn<Row>[]
  getRowKey: (row: Row, index: number) => React.Key
  empty?: React.ReactNode
}

export function DataTable<Row>({
  rows,
  columns,
  getRowKey,
  empty,
  className,
  ...props
}: DataTableProps<Row>) {
  return (
    <div className={cn(listShellClasses, className)} {...props}>
      <div className="w-full overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/40 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {columns.map((col) => (
                <th
                  key={col.key}
                  className={cn("px-3.5 py-2.5", col.className)}
                  scope="col"
                >
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length}
                  className="px-3.5 py-6 text-center text-sm text-muted-foreground"
                >
                  {empty ?? "No results."}
                </td>
              </tr>
            ) : (
              rows.map((row, i) => (
                <tr
                  key={getRowKey(row, i)}
                  className="border-b border-border last:border-0"
                >
                  {columns.map((col) => (
                    <td
                      key={col.key}
                      className={cn("px-3.5 py-3 align-top", col.className)}
                    >
                      {col.render(row)}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
