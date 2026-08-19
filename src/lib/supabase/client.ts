import { createBrowserClient } from "@supabase/ssr"

import type { Database } from "@/types/database"

export function createClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      // Keep in sync with AUTH_COOKIE_OPTIONS in @/lib/supabase/session
      // (not imported: session.ts is proxy-only by convention).
      cookieOptions: {
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
      },
    }
  )
}
