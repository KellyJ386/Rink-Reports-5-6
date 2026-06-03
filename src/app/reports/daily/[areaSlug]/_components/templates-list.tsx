import Link from "next/link"

import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { readableForeground } from "@/lib/color-contrast"
import { cn } from "@/lib/utils"

export type TemplateCard = {
  id: string
  name: string
  description: string | null
}

export function TemplatesList({
  areaSlug,
  areaColor,
  templates,
}: {
  areaSlug: string
  areaColor: string | null
  templates: TemplateCard[]
}) {
  const color = areaColor?.trim() || null
  const fg = color ? readableForeground(color) : null
  return (
    <ul className="flex flex-col gap-3">
      {templates.map((t) => (
        <li key={t.id}>
          <Link
            href={`/reports/daily/${areaSlug}/${t.id}`}
            className="group block rounded-xl outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <Card
              className={cn(
                "relative overflow-hidden transition-all",
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
                  className="text-lg"
                  style={fg ? { color: fg } : undefined}
                >
                  {t.name}
                </CardTitle>
                {t.description ? (
                  <CardDescription
                    style={fg ? { color: fg, opacity: 0.85 } : undefined}
                  >
                    {t.description}
                  </CardDescription>
                ) : null}
              </CardHeader>
            </Card>
          </Link>
        </li>
      ))}
    </ul>
  )
}
