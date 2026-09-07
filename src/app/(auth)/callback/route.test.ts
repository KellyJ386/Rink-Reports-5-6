import { NextRequest } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  exchangeCodeForSession: vi.fn(),
  verifyOtp: vi.fn(),
}))

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({ auth: mocks })),
}))

import { GET } from "./route"

function request(query: string) {
  return new NextRequest(`https://rink-reports.example/callback?${query}`)
}

describe("auth callback", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.exchangeCodeForSession.mockResolvedValue({ error: null })
    mocks.verifyOtp.mockResolvedValue({ error: null })
  })

  it.each([
    ["/dashboard", "https://rink-reports.example/dashboard"],
    ["/reports?tab=open#top", "https://rink-reports.example/reports?tab=open#top"],
    ["//evil.example", "https://rink-reports.example/update-password"],
    ["/\\evil.example", "https://rink-reports.example/update-password"],
    ["/\\/evil.example", "https://rink-reports.example/update-password"],
    ["https://evil.example", "https://rink-reports.example/update-password"],
  ])("redirects next=%j safely after PKCE exchange", async (next, expected) => {
    const response = await GET(request(`code=valid&next=${encodeURIComponent(next)}`))

    expect(response.status).toBe(307)
    expect(response.headers.get("location")).toBe(expected)
    expect(new URL(response.headers.get("location")!).origin).toBe(
      "https://rink-reports.example",
    )
  })

  it("supports a valid OTP callback", async () => {
    const response = await GET(
      request("token_hash=valid&type=invite&next=%2Fdashboard"),
    )

    expect(mocks.verifyOtp).toHaveBeenCalledWith({
      token_hash: "valid",
      type: "invite",
    })
    expect(response.headers.get("location")).toBe(
      "https://rink-reports.example/dashboard",
    )
  })

  it("uses an opaque local error redirect when authentication fails", async () => {
    mocks.exchangeCodeForSession.mockResolvedValue({ error: new Error("bad code") })

    const response = await GET(request("code=invalid&next=%2Fdashboard"))

    expect(response.headers.get("location")).toBe(
      "https://rink-reports.example/update-password?error=link_expired",
    )
  })
})
