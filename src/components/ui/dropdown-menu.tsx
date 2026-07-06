"use client"

import * as React from "react"
import { Slot } from "@radix-ui/react-slot"

import { cn } from "@/lib/utils"

type PendingFocus = "first" | "last" | null

interface DropdownContextValue {
  open: boolean
  setOpen: (open: boolean) => void
  closeMenu: (options?: { focusTrigger?: boolean }) => void
  openMenu: (focus?: PendingFocus) => void
  triggerRef: React.RefObject<HTMLElement | null>
  contentRef: React.RefObject<HTMLDivElement | null>
  contentId: string
  pendingFocusRef: React.MutableRefObject<PendingFocus>
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

function getMenuItems(content: HTMLDivElement | null) {
  if (!content) return []

  return Array.from(
    content.querySelectorAll<HTMLElement>(
      '[role="menuitem"]:not([disabled]):not([aria-disabled="true"])'
    )
  )
}

function focusMenuItem(content: HTMLDivElement | null, position: "first" | "last") {
  const items = getMenuItems(content)
  const item = position === "first" ? items[0] : items[items.length - 1]
  item?.focus()
}

function focusNextMenuItem(
  content: HTMLDivElement | null,
  direction: 1 | -1,
  eventTarget: EventTarget | null
) {
  const items = getMenuItems(content)
  if (items.length === 0) return

  const currentIndex =
    eventTarget instanceof HTMLElement ? items.indexOf(eventTarget) : -1
  const nextIndex =
    currentIndex === -1
      ? direction === 1
        ? 0
        : items.length - 1
      : (currentIndex + direction + items.length) % items.length

  items[nextIndex]?.focus()
}

function DropdownMenu({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  const [open, setOpen] = React.useState(false)
  const triggerRef = React.useRef<HTMLElement | null>(null)
  const contentRef = React.useRef<HTMLDivElement | null>(null)
  const pendingFocusRef = React.useRef<PendingFocus>(null)
  const contentId = React.useId()

  const closeMenu = React.useCallback(
    ({ focusTrigger = true }: { focusTrigger?: boolean } = {}) => {
      setOpen(false)
      pendingFocusRef.current = null
      if (focusTrigger) {
        window.requestAnimationFrame(() => triggerRef.current?.focus())
      }
    },
    []
  )

  const openMenu = React.useCallback((focus: PendingFocus = null) => {
    pendingFocusRef.current = focus
    setOpen(true)
  }, [])

  React.useEffect(() => {
    if (!open) return

    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node
      if (
        contentRef.current?.contains(target) ||
        triggerRef.current?.contains(target)
      )
        return
      closeMenu({ focusTrigger: false })
    }

    document.addEventListener("pointerdown", onPointerDown)
    return () => {
      document.removeEventListener("pointerdown", onPointerDown)
    }
  }, [closeMenu, open])

  return (
    <DropdownContext.Provider
      value={{
        open,
        setOpen,
        closeMenu,
        openMenu,
        triggerRef,
        contentRef,
        contentId,
        pendingFocusRef,
      }}
    >
      <div className={cn("relative inline-block text-left", className)}>
        {children}
      </div>
    </DropdownContext.Provider>
  )
}

interface DropdownMenuTriggerProps
  extends Omit<React.ComponentProps<"button">, "onClick" | "onKeyDown"> {
  asChild?: boolean
  onClick?: React.MouseEventHandler<HTMLElement>
  onKeyDown?: React.KeyboardEventHandler<HTMLElement>
}

function DropdownMenuTrigger({
  asChild = false,
  className,
  onClick,
  onKeyDown,
  children,
  ...props
}: DropdownMenuTriggerProps) {
  const { open, closeMenu, openMenu, triggerRef, contentRef, contentId } =
    useDropdown()
  const Comp = (asChild ? Slot : "button") as React.ElementType

  return (
    <Comp
      ref={triggerRef}
      type={asChild ? undefined : "button"}
      data-slot="dropdown-menu-trigger"
      aria-haspopup="menu"
      aria-expanded={open}
      aria-controls={open ? contentId : undefined}
      className={className}
      onClick={(e: React.MouseEvent<HTMLElement>) => {
        onClick?.(e)
        if (e.defaultPrevented) return
        if (open) closeMenu({ focusTrigger: false })
        else openMenu()
      }}
      onKeyDown={(e: React.KeyboardEvent<HTMLElement>) => {
        onKeyDown?.(e)
        if (e.defaultPrevented) return

        if (e.key === "Escape" && open) {
          e.preventDefault()
          closeMenu()
          return
        }

        if (e.key === "Tab" && open) {
          closeMenu({ focusTrigger: false })
          return
        }

        if ((e.key === "Enter" || e.key === " ") && !open) {
          e.preventDefault()
          openMenu("first")
          return
        }

        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          e.preventDefault()
          const focusTarget = e.key === "ArrowDown" ? "first" : "last"
          if (open) {
            focusMenuItem(contentRef.current, focusTarget)
          } else {
            openMenu(focusTarget)
          }
        }
      }}
      {...props}
    >
      {children}
    </Comp>
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
  onKeyDown,
  ...props
}: DropdownMenuContentProps) {
  const { open, closeMenu, contentRef, contentId, pendingFocusRef } =
    useDropdown()

  React.useEffect(() => {
    if (!open || !pendingFocusRef.current) return

    const focusTarget = pendingFocusRef.current
    pendingFocusRef.current = null
    window.requestAnimationFrame(() =>
      focusMenuItem(contentRef.current, focusTarget)
    )
  }, [contentRef, open, pendingFocusRef])

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
      id={contentId}
      role="menu"
      data-slot="dropdown-menu-content"
      style={{ marginTop: sideOffset, ...style }}
      className={cn(
        "absolute top-full z-50 min-w-[10rem] overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md outline-none",
        alignClass,
        className
      )}
      onKeyDown={(e) => {
        onKeyDown?.(e)
        if (e.defaultPrevented) return

        switch (e.key) {
          case "Escape":
            e.preventDefault()
            closeMenu()
            break
          case "ArrowDown":
            e.preventDefault()
            focusNextMenuItem(contentRef.current, 1, e.target)
            break
          case "ArrowUp":
            e.preventDefault()
            focusNextMenuItem(contentRef.current, -1, e.target)
            break
          case "Home":
            e.preventDefault()
            focusMenuItem(contentRef.current, "first")
            break
          case "End":
            e.preventDefault()
            focusMenuItem(contentRef.current, "last")
            break
          case "Tab":
            closeMenu({ focusTrigger: false })
            break
        }
      }}
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
  const { closeMenu } = useDropdown()
  return (
    <button
      type="button"
      role="menuitem"
      tabIndex={-1}
      data-slot="dropdown-menu-item"
      className={cn(
        "relative flex w-full cursor-pointer select-none items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground disabled:pointer-events-none disabled:opacity-50",
        inset && "pl-8",
        className
      )}
      onClick={(e) => {
        onClick?.(e)
        if (!e.defaultPrevented) closeMenu()
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
