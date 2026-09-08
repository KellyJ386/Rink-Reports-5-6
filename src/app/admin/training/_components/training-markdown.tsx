import Link from "next/link"
import type { ComponentProps } from "react"
import Markdown from "react-markdown"
import rehypeSlug from "rehype-slug"
import remarkGfm from "remark-gfm"

import {
  resolveTrainingLink,
  stripLeadingH1,
  type TrainingDoc,
} from "@/lib/training-docs"

// Renders one training doc's markdown with the app's semantic tokens (both
// themes) instead of a typography plugin. Raw HTML inside the markdown is NOT
// rendered (react-markdown's default), so the docs can't inject markup.
// Relative links between docs are rewritten to in-app routes via the manifest;
// anything the manifest doesn't know becomes plain text, never a dead link.

const HEADING = "scroll-mt-24 font-semibold tracking-tight text-foreground"

export function TrainingMarkdown({
  doc,
  markdown,
}: {
  doc: TrainingDoc
  markdown: string
}) {
  const Anchor = ({
    href,
    children,
    ...rest
  }: ComponentProps<"a">) => {
    const resolved = resolveTrainingLink(href ?? "", doc)
    if (!resolved) {
      return <span className="font-medium text-foreground">{children}</span>
    }
    const cls = "font-medium text-primary underline underline-offset-4"
    if (resolved.startsWith("/")) {
      return (
        <Link href={resolved} className={cls}>
          {children}
        </Link>
      )
    }
    if (resolved.startsWith("#")) {
      return (
        <a href={resolved} className={cls} {...rest}>
          {children}
        </a>
      )
    }
    return (
      <a
        href={resolved}
        className={cls}
        target="_blank"
        rel="noopener noreferrer"
        {...rest}
      >
        {children}
      </a>
    )
  }

  return (
    <div className="flex flex-col gap-4 text-[15px] leading-7 text-foreground">
      <Markdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeSlug]}
        components={{
          a: Anchor,
          h1: (p) => <h2 className={`${HEADING} mt-6 text-2xl`} {...p} />,
          h2: (p) => (
            <h2
              className={`${HEADING} mt-8 border-b border-border pb-2 text-xl`}
              {...p}
            />
          ),
          h3: (p) => <h3 className={`${HEADING} mt-6 text-lg`} {...p} />,
          h4: (p) => <h4 className={`${HEADING} mt-4 text-base`} {...p} />,
          h5: (p) => <h5 className={`${HEADING} mt-3 text-sm`} {...p} />,
          h6: (p) => <h6 className={`${HEADING} mt-3 text-sm`} {...p} />,
          p: (p) => <p {...p} />,
          ul: (p) => <ul className="list-disc space-y-1 pl-6" {...p} />,
          ol: (p) => <ol className="list-decimal space-y-1 pl-6" {...p} />,
          li: (p) => <li className="[&>p]:my-1" {...p} />,
          blockquote: (p) => (
            <blockquote
              className="rounded-lg border-l-4 border-primary bg-muted/60 px-4 py-3 text-sm [&>p]:my-1"
              {...p}
            />
          ),
          hr: () => <hr className="my-2 border-border" />,
          code: ({ className, children, ...rest }) => {
            // Fenced blocks arrive wrapped in <pre>; inline code does not.
            const isBlock = typeof className === "string" && className.includes("language-")
            return (
              <code
                className={
                  isBlock
                    ? "font-mono text-[13px]"
                    : "rounded bg-muted px-1.5 py-0.5 font-mono text-[13px] text-foreground"
                }
                {...rest}
              >
                {children}
              </code>
            )
          },
          pre: (p) => (
            <pre
              className="overflow-x-auto rounded-lg border border-border bg-muted p-4 text-[13px] leading-6 [&>code]:bg-transparent [&>code]:p-0"
              {...p}
            />
          ),
          table: (p) => (
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full border-collapse text-sm" {...p} />
            </div>
          ),
          thead: (p) => <thead className="bg-muted/60" {...p} />,
          th: (p) => (
            <th
              className="border-b border-border px-3 py-2 text-left font-semibold"
              {...p}
            />
          ),
          td: (p) => (
            <td className="border-b border-border px-3 py-2 align-top" {...p} />
          ),
          strong: (p) => <strong className="font-semibold" {...p} />,
        }}
      >
        {stripLeadingH1(markdown)}
      </Markdown>
    </div>
  )
}
