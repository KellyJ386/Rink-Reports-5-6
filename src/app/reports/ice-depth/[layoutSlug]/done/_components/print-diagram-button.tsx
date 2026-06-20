"use client"

import { Printer } from "lucide-react"

import { Button } from "@/components/ui/button"

// Triggers the browser print dialog. The done page's `@media print` rules hide
// everything except the rink diagram so this yields a clean full-page printout.
export function PrintDiagramButton() {
  return (
    <Button
      type="button"
      variant="outline"
      size="lg"
      onClick={() => window.print()}
      className="min-h-11 w-full text-sm font-semibold text-muted-foreground print:hidden"
    >
      <Printer className="h-4 w-4" aria-hidden />
      Print Diagram
    </Button>
  )
}
