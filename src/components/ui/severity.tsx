"use client"

import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * Severity primitives. These are the ONLY components in the codebase
 * sanctioned to use an inline `style` for color — the value comes from
 * DB-driven dropdowns (`severity_dropdown.color`) and can't be expressed
 * as a Tailwind class. Layout and typography stay in utility classes.
 *
 * Pass `color = null` to fall back to `--muted-foreground`.
 */

function fallbackColor(color: string | null | undefined): string {
  return color ?? "var(--muted-foreground)"
}

interface SeverityDotProps
  extends Omit<React.HTMLAttributes<HTMLSpanElement>, "color"> {
  color?: string | null
  size?: number
}

export function SeverityDot({
  color,
  size = 10,
  className,
  style,
  ...props
}: SeverityDotProps) {
  return (
    <span
      className={cn("inline-block shrink-0 rounded-full", className)}
      style={{
        width: size,
        height: size,
        background: fallbackColor(color),
        ...style,
      }}
      aria-hidden="true"
      {...props}
    />
  )
}

interface SeverityPillProps
  extends Omit<React.HTMLAttributes<HTMLSpanElement>, "color"> {
  color?: string | null
  children: React.ReactNode
}

/**
 * Read-only colored pill (e.g. severity label on a recent-submissions
 * list row). Background is a 12.5% alpha wash of the DB color; text is
 * the saturated DB color.
 */
export function SeverityPill({
  color,
  className,
  children,
  style,
  ...props
}: SeverityPillProps) {
  const c = fallbackColor(color)
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.06em]",
        className,
      )}
      style={{
        background: color ? `${color}20` : "var(--muted)",
        color: c,
        ...style,
      }}
      {...props}
    >
      {children}
    </span>
  )
}

interface SeverityRadioPillProps {
  color?: string | null
  selected: boolean
  onClick: () => void
  children: React.ReactNode
  ariaLabel?: string
  className?: string
}

/**
 * Interactive radio pill (used by the accident-report severity picker).
 * Renders a button styled like a chunky toggle. When `selected`, the
 * border + background use the DB color.
 */
export function SeverityRadioPill({
  color,
  selected,
  onClick,
  children,
  ariaLabel,
  className,
}: SeverityRadioPillProps) {
  const accent = color ?? "var(--foreground-strong)"
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      aria-label={ariaLabel}
      onClick={onClick}
      className={cn(
        "flex min-w-[120px] flex-1 items-center justify-start rounded-[10px] border-2 px-3.5 py-2.5 text-left transition-colors",
        selected ? "" : "border-border bg-card hover:bg-accent/40",
        className,
      )}
      style={
        selected
          ? {
              borderColor: accent,
              background: color ? `${color}1A` : "var(--accent)",
            }
          : undefined
      }
    >
      <span
        className="text-[11px] font-extrabold uppercase tracking-[0.1em]"
        style={{ color: accent }}
      >
        {children}
      </span>
    </button>
  )
}

interface SeverityPillGroupProps {
  ariaLabel?: string
  /**
   * Marks the radiogroup required for assistive tech. The pills aren't native
   * inputs, so the caller still enforces selection (e.g. the accidents form's
   * submit guard) — this only exposes the requirement up front.
   */
  required?: boolean
  className?: string
  children: React.ReactNode
}

export function SeverityPillGroup({
  ariaLabel,
  required,
  className,
  children,
}: SeverityPillGroupProps) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      aria-required={required ? "true" : undefined}
      className={cn("flex flex-wrap gap-2", className)}
    >
      {children}
    </div>
  )
}
