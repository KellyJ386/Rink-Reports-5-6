import { redirect } from "next/navigation"

export const dynamic = "force-dynamic"

export default function IceOperationsHomePage() {
  redirect("/reports/ice-operations/ice_make")
}
