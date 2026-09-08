import Link from "next/link"
import { BookOpen, Download, FileText } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { PageHeader } from "@/components/ui/page-header"
import { requireAdmin } from "@/lib/auth"
import {
  TRAINING_AUDIENCE_LABELS,
  TRAINING_DOCS,
  TRAINING_GROUPS,
  trainingDocHref,
  trainingDocsInGroup,
  trainingFileHref,
  type TrainingDoc,
} from "@/lib/training-docs"

export const metadata = {
  title: "Training & Documentation | MFO / Rink Reports",
}

const DESCRIPTION =
  "Every Rink Reports training guide, manual, and module chapter in one place. Read them here or download the PDF to print or hand out."

function DocRow({ doc }: { doc: TrainingDoc }) {
  const href = trainingDocHref(doc)
  const Icon = doc.pdf && !doc.markdown ? FileText : BookOpen
  return (
    <li className="flex flex-col gap-3 px-6 py-4 sm:flex-row sm:items-start sm:gap-4">
      <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
        <Icon className="h-4 w-4" aria-hidden />
      </div>
      <div className="min-w-0 flex-1">
        <h3 className="text-base font-semibold leading-tight tracking-tight">
          {href ? (
            <Link href={href} className="hover:underline">
              {doc.title}
            </Link>
          ) : (
            <a href={trainingFileHref(doc)} className="hover:underline">
              {doc.title}
            </a>
          )}
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">{doc.description}</p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {doc.audiences.map((a) => (
            <Badge key={a} variant="neutral">
              {TRAINING_AUDIENCE_LABELS[a]}
            </Badge>
          ))}
        </div>
      </div>
      <div className="flex shrink-0 flex-wrap gap-2 sm:flex-col sm:items-end">
        {href ? (
          <Button asChild size="sm" variant="outline">
            <Link href={href}>Read</Link>
          </Button>
        ) : null}
        {doc.pdf ? (
          <Button asChild size="sm" variant="outline">
            <a href={trainingFileHref(doc)}>
              <Download className="h-3.5 w-3.5" aria-hidden />
              PDF
            </a>
          </Button>
        ) : null}
      </div>
    </li>
  )
}

export default async function TrainingIndexPage() {
  await requireAdmin()

  const pdfCount = TRAINING_DOCS.filter((d) => d.pdf).length

  return (
    <div className="flex flex-col gap-6 p-4 md:p-6">
      <PageHeader title="Training & Documentation" description={DESCRIPTION} />

      <nav
        aria-label="Documentation sections"
        className="flex flex-wrap items-center gap-2 text-sm"
      >
        <span className="text-muted-foreground">Jump to:</span>
        {TRAINING_GROUPS.map((g) => (
          <a
            key={g.key}
            href={`#${g.key}`}
            className="rounded-full border border-border bg-card px-3 py-1 font-medium hover:bg-muted"
          >
            {g.title}
          </a>
        ))}
        <span className="ml-auto text-xs text-muted-foreground">
          {TRAINING_DOCS.length} documents · {pdfCount} printable PDFs
        </span>
      </nav>

      {TRAINING_GROUPS.map((group) => {
        const docs = trainingDocsInGroup(group.key)
        return (
          <section
            key={group.key}
            id={group.key}
            aria-labelledby={`${group.key}-title`}
            className="scroll-mt-24 flex flex-col gap-3"
          >
            <div>
              <h2
                id={`${group.key}-title`}
                className="text-lg font-semibold tracking-tight"
              >
                {group.title}
              </h2>
              <p className="text-sm text-muted-foreground">
                {group.description}
              </p>
            </div>
            <Card className="gap-0 py-0">
              <ul className="divide-y divide-border">
                {docs.map((doc) => (
                  <DocRow key={doc.slug} doc={doc} />
                ))}
              </ul>
            </Card>
          </section>
        )
      })}

      <p className="text-xs text-muted-foreground">
        These documents ship with the app and update with each release. To
        share facility-specific paperwork (handbooks, policies, emergency
        plans) with staff, use{" "}
        <Link href="/admin/facility-documents" className="underline">
          Facility Paperwork
        </Link>
        .
      </p>
    </div>
  )
}
