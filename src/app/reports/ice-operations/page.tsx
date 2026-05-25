import { redirect } from "next/navigation"

import { DEFAULT_OPERATION_TYPE } from "./types"

export const dynamic = "force-dynamic"

export default function IceOperationsHomePage() {
  redirect(`/reports/ice-operations/${DEFAULT_OPERATION_TYPE}`)
}
