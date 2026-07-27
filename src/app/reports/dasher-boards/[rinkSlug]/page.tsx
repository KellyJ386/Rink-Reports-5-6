import { DasherBoardsRinkScreen } from "../_components/rink-screen"

// Per-rink deep link — renders the same single-screen field tool as the
// module landing, with the rink resolved by slug instead of the default.

export const dynamic = "force-dynamic"
export const metadata = { title: "Dasher Boards | Rink Reports" }

export default async function DasherBoardsRinkPage({
  params,
}: {
  params: Promise<{ rinkSlug: string }>
}) {
  const { rinkSlug } = await params
  return <DasherBoardsRinkScreen rinkSlug={rinkSlug} />
}
