"use client"

import Link from "next/link"
import { useEffect } from "react"
import { useActionState } from "react"
import { useFormStatus } from "react-dom"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

import { FormError } from "@/components/auth/form-error"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"

import {
  acknowledgeMessage,
  markMessageRead,
  type MessageActionFormState,
} from "../actions"

import { formatTimestamp } from "./format"

const initialState: MessageActionFormState = {}

type Props = {
  message: {
    id: string
    subject: string | null
    body: string
    sent_at: string
    requires_acknowledgement: boolean
    sender_name: string | null
    pdf_signed_url: string | null
  }
  recipient: {
    read_at: string | null
    acknowledged_at: string | null
  }
  timezone: string | null
}

export function MessageDetail({ message, recipient, timezone }: Props) {
  return (
    <>
      <Card>
        <CardHeader>
          <p className="text-sm text-muted-foreground">
            From{" "}
            <span className="font-medium text-foreground">
              {message.sender_name ?? "Unknown sender"}
            </span>{" "}
            · {formatTimestamp(message.sent_at, timezone)}
          </p>
          <CardTitle className="mt-1 text-xl">
            {message.subject && message.subject.trim().length > 0
              ? message.subject
              : "(No subject)"}
          </CardTitle>
          {message.requires_acknowledgement ? (
            <CardDescription className="mt-1">
              Acknowledgement required.
            </CardDescription>
          ) : null}
        </CardHeader>
        <CardContent>
          <p className="whitespace-pre-wrap text-sm leading-relaxed">
            {message.body}
          </p>
          {message.pdf_signed_url ? (
            <p className="mt-4 text-sm">
              <a
                href={message.pdf_signed_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex h-10 items-center rounded-md border border-input bg-background px-3 font-medium hover:bg-accent"
              >
                Download PDF attachment
              </a>
            </p>
          ) : null}
        </CardContent>
      </Card>

      {recipient.read_at === null ? (
        <MarkReadCard messageId={message.id} />
      ) : (
        <p className="text-xs text-muted-foreground">
          Read on {formatTimestamp(recipient.read_at, timezone)}.
        </p>
      )}

      {message.requires_acknowledgement ? (
        recipient.acknowledged_at ? (
          <p className="text-xs text-muted-foreground">
            Acknowledged on{" "}
            {formatTimestamp(recipient.acknowledged_at, timezone)}.
          </p>
        ) : (
          <AcknowledgeMessageForm messageId={message.id} />
        )
      ) : null}

      <div>
        <Link
          href="/reports/communications?inbox=messages"
          className="inline-flex h-11 items-center rounded-md border border-input bg-background px-4 text-sm font-medium hover:bg-accent"
        >
          Back to inbox
        </Link>
      </div>
    </>
  )
}

function MarkReadCard({ messageId }: { messageId: string }) {
  const router = useRouter()
  const [state, formAction] = useActionState(markMessageRead, initialState)

  useEffect(() => {
    if (state.error) {
      toast.error(state.error)
    } else if (state.ok) {
      router.refresh()
    }
  }, [state, router])

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <FormError message={state.error} />
      <input type="hidden" name="message_id" value={messageId} />
      <MarkReadButton />
    </form>
  )
}

function MarkReadButton() {
  const { pending } = useFormStatus()
  return (
    <Button
      type="submit"
      variant="outline"
      size="lg"
      disabled={pending}
      className="h-11 w-full text-sm sm:w-auto"
    >
      {pending ? "Marking…" : "Mark as read"}
    </Button>
  )
}

function AcknowledgeMessageForm({ messageId }: { messageId: string }) {
  const router = useRouter()
  const [state, formAction] = useActionState(acknowledgeMessage, initialState)

  useEffect(() => {
    if (state.error) {
      toast.error(state.error)
    } else if (state.ok) {
      toast.success("Message acknowledged.")
      router.refresh()
    }
  }, [state, router])

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Acknowledge this message</CardTitle>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="flex flex-col gap-4">
          <FormError message={state.error} />
          <input type="hidden" name="message_id" value={messageId} />
          <div className="flex flex-col gap-2">
            <Label htmlFor="notes">Notes (optional)</Label>
            <Textarea
              id="notes"
              name="notes"
              rows={3}
              placeholder="Anything you want to note?"
              className="min-h-24 text-base"
            />
          </div>
          <AckButton />
        </form>
      </CardContent>
    </Card>
  )
}

function AckButton() {
  const { pending } = useFormStatus()
  return (
    <Button
      type="submit"
      size="lg"
      disabled={pending}
      className="h-12 w-full text-base"
    >
      {pending ? "Acknowledging…" : "Acknowledge"}
    </Button>
  )
}
