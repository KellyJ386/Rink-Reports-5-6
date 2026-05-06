"use client"

import * as React from "react"

import { cn } from "@/lib/utils"

interface DropdownContextValue {
  open: boolean
  setOpen: (open: boolean) => void
  triggerRef: React.RefObject<HTMLButtonElement | null>
  contentRef: React.RefObject<HTMLDivElement | null>
}

const DropdownContext = React.createContext<DropdownContextValue | null>(null)

function useDropdown() {
  const ctx = React.useContext(DropdownContext)
  if (!ctx)
    throw new Error(
      "DropdownMenu components must be used inside <DropdownMenu>"
    )
  return ctx
}

function DropdownMenu({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = React.useState(false)
  const triggerRef = React.useRef<HTMLButtonElement | null>(null)
  const contentRef = React.useRef<HTMLDivElement | null>(null)

  React.useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => {
      const target = e.target as Node
      if (
        contentRef.current?.contains(target) ||
        triggerRef.current?.contains(target)
      )
        return
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false)
    }
    document.addEventListener("mousedown", onClick)
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("mousedown", onClick)
      document.removeEventListener("keydown", onKey)
    }
  }, [open])

  return (
    <DropdownContext.Provider value={{ open, setOpen, triggerRef, contentRef }}>
      <div className="relative inline-block text-left">{children}</div>
    </DropdownContext.Provider>
  )
}

interface DropdownMenuTriggerProps extends React.ComponentProps<"button"> {
  asChild?: boolean
}

function DropdownMenuTrigger({
  className,
  onClick,
  children,
  ...props
}: DropdownMenuTriggerProps) {
  const { open, setOpen, triggerRef } = useDropdown()
  return (
    <button
      ref={triggerRef}
      type="button"
      data-slot="dropdown-menu-trigger"
      aria-haspopup="menu"
      aria-expanded={open}
      className={className}
      onClick={(e) => {
        onClick?.(e)
        if (!e.defaultPrevented) setOpen(!open)
      }}
      {...props}
    >
      {children}
    </button>
  )
}

interface DropdownMenuContentProps extends React.ComponentProps<"div"> {
  align?: "start" | "center" | "end"
  sideOffset?: number
}

function DropdownMenuContent({
  className,
  align = "end",
  sideOffset = 4,
  children,
  style,
  ...props
}: DropdownMenuContentProps) {
  const { open, contentRef } = useDropdown()
  if (!open) return null

  const alignClass =
    align === "end"
      ? "right-0"
      : align === "center"
        ? "left-1/2 -translate-x-1/2"
        : "left-0"

  return (
    <div
      ref={contentRef}
      role="menu"
      data-slot="dropdown-menu-content"
      style={{ marginTop: sideOffset, ...style }}
      className={cn(
        "absolute z-50 min-w-[10rem] overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md",
        alignClass,
        "top-full",
        className
      )}
      {...props}
    >
      {children}
    </div>
  )
}

interface DropdownMenuItemProps extends React.ComponentProps<"button"> {
  inset?: boolean
}

function DropdownMenuItem({
  className,
  inset,
  onClick,
  ...props
}: DropdownMenuItemProps) {
  const { setOpen } = useDropdown()
  return (
    <button
      type="button"
      role="menuitem"
      data-slot="dropdown-menu-item"
      className={cn(
        "relative flex w-full cursor-pointer select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground disabled:pointer-events-none disabled:opacity-50",
        inset && "pl-8",
        className
      )}
      onClick={(e) => {
        onClick?.(e)
        if (!e.defaultPrevented) setOpen(false)
      }}
      {...props}
    />
  )
}

function DropdownMenuLabel({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dropdown-menu-label"
      className={cn(
        "px-2 py-1.5 text-sm font-semibold text-foreground",
        className
      )}
      {...props}
    />
  )
}

function DropdownMenuSeparator({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      role="separator"
      data-slot="dropdown-menu-separator"
      className={cn("-mx-1 my-1 h-px bg-border", className)}
      {...props}
    />
  )
}

export {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
}
