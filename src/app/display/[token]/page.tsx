import type { Metadata } from "next"

import { DisplayBoardClient } from "./_components/display-board-client"

// ---------------------------------------------------------------------------
// Public locker-room TV board.
//
// Unauthenticated by design: the URL's 256-bit token IS the credential, and
// src/proxy.ts does not list /display among its protected prefixes. The page
// itself renders no data — it hands the token to a client component that polls
// /api/display/[token], which is where the token is actually resolved. Keeping
// the page a thin shell means a wrong token produces the same shell and an
// error card rather than a server-side redirect that would confirm the guess.
//
// Fixed navy/lime, not the app's theme tokens: this is a wall display in a
// lobby, not an app surface, and it must render identically whatever the TV
// browser's OS theme happens to be. This is the one deliberate exception to
// the "always use semantic tokens" rule, and the colours are the brand's own
// (#002244 / #4DFF00).
// ---------------------------------------------------------------------------

export const metadata: Metadata = {
  title: "Locker Rooms",
  // A lobby display should never be indexed, and the URL is a bearer token.
  robots: { index: false, follow: false, nocache: true },
}

export const dynamic = "force-dynamic"

export default async function DisplayPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  return <DisplayBoardClient token={token} />
}
