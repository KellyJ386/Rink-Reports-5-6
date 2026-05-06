"use client"

import * as React from "react"
import { X } from "lucide-react"

import { cn } from "@/lib/utils"

interface SheetContextValue {
  open: boolean
  setOpen: (open: boolean) => void
}

const SheetContext = React.createContext<SheetContextValue | null>(null)

function useSheet() {
  const ctx = React.useContext(SheetContext)
  if (!ctx) throw new Error("Sheet components must be used inside <Sheet>")
  return ctx
}

interface SheetProps {
  open?: boolean
  onOpenChange?: (open: boolean) => void
  children: React.ReactNode
}

function Sheet({ open: openProp, onOpenChange, children }: SheetProps) {
  const [openState, setOpenState] = React.useState(false)
  const isControlled = openProp !== undefined
  const open = isControlled ? openProp : openState

  const setOpen = React.useCallback(
    (next: boolean) => {
      if (!isControlled) setOpenState(next)
      onOpenChange?.(next)
    },
    [isControlled, onOpenChange]
  )

  return (
    <SheetContext.Provider value={{ open, setOpen }}>
      {children}
    </SheetContext.Provider>
  )
}

interface SheetTriggerProps extends React.ComponentProps<"button"> {
  asChild?: boolean
}

function SheetTrigger({
  className,
  onClick,
  children,
  ...props
}: SheetTriggerProps) {
  const { setOpen } = useSheet()
  return (
    <button
      data-slot="sheet-trigger"
      type="button"
      className={className}
      onClick={(e) => {
        onClick?.(e)
        if (!e.defaultPrevented) setOpen(true)
      }}
      {...props}
    >
      {children}
    </button>
  )
}

type SheetSide = "left" | "right" | "top" | "bottom"

interface SheetContentProps extends React.ComponentProps<"div"> {
  side?: SheetSide
}

function SheetContent({
  className,
  children,
  side = "right",
  ...props
}: SheetContentProps) {
  const { open, setOpen } = useSheet()

  React.useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false)
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [open, setOpen])

  if (!open) return null

  const sideClasses: Record<SheetSide, string> = {
    left: "inset-y-0 left-0 h-full w-3/4 max-w-sm border-r",
    right: "inset-y-0 right-0 h-full w-3/4 max-w-sm border-l",
    top: "inset-x-0 top-0 w-full border-b",
    bottom: "inset-x-0 bottom-0 w-full border-t",
  }

  return (
    <div className="fixed inset-0 z-50">
      <div
        aria-hidden
        className="fixed inset-0 bg-black/50"
        onClick={() => setOpen(false)}
      />
      <div
        data-slot="sheet-content"
        role="dialog"
        aria-modal="true"
        className={cn(
          "fixed bg-background shadow-lg p-6 flex flex-col gap-4",
          sideClasses[side],
          className
        )}
        {...props}
      >
        {children}
        <button
          type="button"
          aria-label="Close"
          onClick={() => setOpen(false)}
          className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}

function SheetHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-header"
      className={cn("flex flex-col gap-1.5 text-left", className)}
      {...props}
    />
  )
}

function SheetTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-title"
      className={cn("text-lg font-semibold text-foreground", className)}
      {...props}
    />
  )
}

function SheetDescription({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Sheet,
  SheetTrigger,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
}
