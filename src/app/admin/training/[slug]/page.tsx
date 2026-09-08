import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { ArrowLeft, ArrowRight, Download } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { EmptyState } from "@/components/ui/empty-state"
import { PageHeader } from "@/components/ui/page-header"
import { requireAdmin } from "@/lib/auth"
import {
  TRAINING_AUDIENCE_LABELS,
  TRAINING_GROUPS,
  TRAINING_INDEX_PATH,
  findTrainingDoc,
  trainingDocHref,
  trainingDocNeighbors,
  trainingFileHref,
} from "@/lib/training-docs"

import { TrainingMarkdown } from "../_components/training-markdown"
import { readTrainingMarkdown } from "../_lib/read-doc"

type Params = Promise<{ slug: string }>

export async function generateMetadata({
  params,
}: {
  params: Params
}): Promise<Metadata> {
  const { slug } = await params
  const doc = findTrainingDoc(slug)
  return {
    title: `${doc?.title ?? "Training"} | MFO / Rink Reports`,
  }
}

export default async function TrainingDocPage({
  params,
}: {
  params: Params
}) {
  await requireAdmin()
  const { slug } = await params
  const doc = findTrainingDoc(slug)
  if (!doc || !doc.markdown) notFound()

  const markdown = await readTrainingMarkdown(doc)
  const group = TRAINING_GROUPS.find((g) => g.key === doc.group)
  const { prev, next } = trainingDocNeighbors(doc)

  return (
    <div className="flex flex-col gap-6 p-4 md:p-6">
      <PageHeader
        breadcrumb={
          <Link
            href={TRAINING_INDEX_PATH}
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:underline"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
            Training &amp; Documentation
            {group ? <span aria-hidden> · {group.title}</span> : null}
          </Link>
        }
        title={doc.title}
        description={doc.description}
        actions={
          doc.pdf ? (
            <Button asChild variant="outline">
              <a href={trainingFileHref(doc)}>
                <Download className="h-4 w-4" aria-hidden />
                Download PDF
              </a>
            </Button>
          ) : undefined
        }
      />

      <div className="flex flex-wrap gap-1.5">
        {doc.audiences.map((a) => (
          <Badge key={a} variant="neutral">
            {TRAINING_AUDIENCE_LABELS[a]}
          </Badge>
        ))}
      </div>

      {markdown === null ? (
        <EmptyState
          title="This document isn't available"
          description="The markdown source couldn't be read from this deployment. It ships with the app, so a redeploy should restore it."
        />
      ) : (
        <Card className="max-w-4xl px-6 py-6">
          <TrainingMarkdown doc={doc} markdown={markdown} />
        </Card>
      )}

      {prev || next ? (
        <nav
          aria-label="Neighboring documents"
          className="flex max-w-4xl flex-col gap-2 sm:flex-row sm:justify-between"
        >
          {prev ? (
            <Button asChild variant="ghost" className="justify-start">
              <Link href={trainingDocHref(prev)!}>
                <ArrowLeft className="h-4 w-4" aria-hidden />
                {prev.title}
              </Link>
            </Button>
          ) : (
            <span />
          )}
          {next ? (
            <Button asChild variant="ghost" className="justify-end">
              <Link href={trainingDocHref(next)!}>
                {next.title}
                <ArrowRight className="h-4 w-4" aria-hidden />
              </Link>
            </Button>
          ) : null}
        </nav>
      ) : null}
    </div>
  )
}
