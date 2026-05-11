import type { Metadata } from "next"

import { requireUser } from "@/lib/auth"
import { OfflineQueueView } from "./_components/offline-queue-view"

export const metadata: Metadata = { title: "Pending Sync Queue | Rink Reports" }

export default async function OfflineQueuePage() {
  await requireUser()
  return <OfflineQueueView />
}
