import { DasherBoardsRinkScreen } from "./_components/rink-screen"

// Module landing = the condition map for the default rink, directly. Rink
// selection is a <select> in the page header (see rink-screen.tsx); per-rink
// deep links live at /reports/dasher-boards/[rinkSlug].

export const dynamic = "force-dynamic"
export const metadata = { title: "Dasher Boards | Rink Reports" }

export default async function DasherBoardsPage() {
  return <DasherBoardsRinkScreen rinkSlug={null} />
}
