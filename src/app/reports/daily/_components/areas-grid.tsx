import Link from "next/link"

import { Card, CardHeader, CardTitle } from "@/components/ui/card"
import { readableForeground } from "@/lib/color-contrast"
import { cn } from "@/lib/utils"

export type AreaCard = {
  id: string
  slug: string
  name: string
  color: string | null
}

export function AreasGrid({ areas }: { areas: AreaCard[] }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {areas.map((area) => {
        const color = area.color?.trim() || null
        const fg = color ? readableForeground(color) : null
        return (
          <Link
            key={area.id}
            href={`/reports/daily/${area.slug}`}
            className="group rounded-xl outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <Card
              className={cn(
                "relative min-h-[112px] overflow-hidden transition-all",
                color
                  ? "border-transparent group-hover:-translate-y-0.5"
                  : "group-hover:bg-accent/40"
              )}
              style={
                color && fg
                  ? { backgroundColor: color, color: fg }
                  : undefined
              }
            >
              {color ? (
                <span
                  aria-hidden
                  className="pointer-events-none absolute inset-0 bg-black/0 transition-colors group-hover:bg-black/10"
                />
              ) : null}
              <CardHeader>
                <CardTitle
                  className="text-xl"
                  style={fg ? { color: fg } : undefined}
                >
                  {area.name}
                </CardTitle>
              </CardHeader>
            </Card>
          </Link>
        )
      })}
    </div>
  )
}
