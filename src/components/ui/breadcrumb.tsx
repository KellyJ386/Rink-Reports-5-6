import * as React from "react"
import Link from "next/link"

import { cn } from "@/lib/utils"

export type BreadcrumbSegment = {
  label: React.ReactNode
  href?: string
}

interface BreadcrumbProps extends React.HTMLAttributes<HTMLElement> {
  segments: BreadcrumbSegment[]
  separator?: React.ReactNode
}

export function Breadcrumb({
  segments,
  separator = " / ",
  className,
  ...props
}: BreadcrumbProps) {
  if (segments.length === 0) return null
  return (
    <nav
      aria-label="Breadcrumb"
      className={cn("text-xs text-muted-foreground", className)}
      {...props}
    >
      <ol className="flex flex-wrap items-center">
        {segments.map((seg, i) => {
          const isLast = i === segments.length - 1
          return (
            <li key={i} className="flex items-center">
              {seg.href && !isLast ? (
                <Link href={seg.href} className="hover:underline">
                  {seg.label}
                </Link>
              ) : (
                <span aria-current={isLast ? "page" : undefined}>
                  {seg.label}
                </span>
              )}
              {!isLast ? (
                <span aria-hidden="true" className="px-1">
                  {separator}
                </span>
              ) : null}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
