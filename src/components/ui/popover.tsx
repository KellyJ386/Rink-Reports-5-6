"use client"

import * as React from "react"
import * as PopoverPrimitive from "@radix-ui/react-popover"

import { cn } from "@/lib/utils"

/**
 * Anchored floating panel built on `@radix-ui/react-popover`. Unlike `Sheet`
 * (a viewport-pinned dialog), the content positions itself relative to a
 * trigger or an explicit `PopoverAnchor`, flips/shifts to stay inside the
 * viewport, and re-anchors on scroll and resize. Radix handles dismissal
 * (outside pointer-down, Escape), focus (moved into the content on open,
 * restored on close), and `aria-haspopup`/`aria-expanded` on the trigger.
 *
 * `modal` defaults to false: the page keeps scrolling and there is no
 * dimming overlay — pass `modal` on `Popover` to change that per use.
 */

const Popover = PopoverPrimitive.Root
const PopoverTrigger = PopoverPrimitive.Trigger
const PopoverAnchor = PopoverPrimitive.Anchor
const PopoverClose = PopoverPrimitive.Close

function PopoverContent({
  className,
  align = "center",
  sideOffset = 4,
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Content>) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        align={align}
        sideOffset={sideOffset}
        className={cn(
          "bg-popover text-popover-foreground z-50 w-72 rounded-md border p-4 shadow-md outline-none",
          "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95",
          "data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95",
          "data-[side=top]:slide-in-from-bottom-2 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2",
          className
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  )
}

export { Popover, PopoverTrigger, PopoverAnchor, PopoverClose, PopoverContent }
