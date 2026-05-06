import Link from "next/link"

import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

export type TemplateCard = {
  id: string
  name: string
  description: string | null
}

export function TemplatesList({
  areaSlug,
  templates,
}: {
  areaSlug: string
  templates: TemplateCard[]
}) {
  return (
    <ul className="flex flex-col gap-3">
      {templates.map((t) => (
        <li key={t.id}>
          <Link
            href={`/reports/daily/${areaSlug}/${t.id}`}
            className="block rounded-xl outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <Card className="transition-colors hover:bg-accent/40">
              <CardHeader>
                <CardTitle className="text-lg">{t.name}</CardTitle>
                {t.description ? (
                  <CardDescription>{t.description}</CardDescription>
                ) : null}
              </CardHeader>
            </Card>
          </Link>
        </li>
      ))}
    </ul>
  )
}
