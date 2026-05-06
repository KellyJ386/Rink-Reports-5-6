import Link from "next/link"

import { Card, CardHeader, CardTitle } from "@/components/ui/card"

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
        return (
          <Link
            key={area.id}
            href={`/reports/daily/${area.slug}`}
            className="group rounded-xl outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <Card
              className="relative min-h-[112px] overflow-hidden transition-colors group-hover:bg-accent/40"
              style={
                color
                  ? {
                      borderColor: color,
                      borderLeftWidth: 6,
                    }
                  : undefined
              }
            >
              <CardHeader>
                <CardTitle className="text-xl">{area.name}</CardTitle>
              </CardHeader>
            </Card>
          </Link>
        )
      })}
    </div>
  )
}
