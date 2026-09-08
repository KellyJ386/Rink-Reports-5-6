import { NextRequest } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

// Route Handler test for the email-link callback. This is the one place the
// redirect validator is combined with `new URL(next, request.url)`, so the
// assertion that matters is on the final `Location` header, not on the helper.
//
// The Supabase server client is mocked at the module boundary, so the
// server-only cookie/`next/headers` code is never loaded (see the vitest
// scoping note in CLAUDE.md).

const mocks = vi.hoisted(() => ({
  exchangeCodeForSession: vi.fn(),
  verifyOtp: vi.fn(),
}))

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({ auth: mocks })),
}))

import { GET } from "./route"

const ORIGIN = "https://rink-reports.example"

function request(query: string) {
  return new NextRequest(`${ORIGIN}/callback?${query}`)
}

describe("auth callback", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.exchangeCodeForSession.mockResolvedValue({ error: null })
    mocks.verifyOtp.mockResolvedValue({ error: null })
  })

  it.each([
    ["/dashboard", `${ORIGIN}/dashboard`],
    ["/reports?tab=open#top", `${ORIGIN}/reports?tab=open#top`],
    ["//evil.example", `${ORIGIN}/update-password`],
    ["/\\evil.example", `${ORIGIN}/update-password`],
    ["/\\/evil.example", `${ORIGIN}/update-password`],
    ["/\t/evil.example", `${ORIGIN}/update-password`],
    ["https://evil.example", `${ORIGIN}/update-password`],
    ["javascript:alert(1)", `${ORIGIN}/update-password`],
  ])("redirects next=%j safely after PKCE exchange", async (next, expected) => {
    const response = await GET(request(`code=valid&next=${encodeURIComponent(next)}`))

    expect(mocks.exchangeCodeForSession).toHaveBeenCalledWith("valid")
    expect(response.status).toBe(307)
    const location = response.headers.get("location")
    expect(location).toBe(expected)
    expect(new URL(location!).origin).toBe(ORIGIN)
  })

  it("falls back to /update-password when next is absent", async () => {
    const response = await GET(request("code=valid"))

    expect(response.headers.get("location")).toBe(`${ORIGIN}/update-password`)
  })

  it("supports a valid OTP callback", async () => {
    const response = await GET(
      request("token_hash=valid&type=invite&next=%2Fdashboard"),
    )

    expect(mocks.verifyOtp).toHaveBeenCalledWith({
      token_hash: "valid",
      type: "invite",
    })
    expect(mocks.exchangeCodeForSession).not.toHaveBeenCalled()
    expect(response.headers.get("location")).toBe(`${ORIGIN}/dashboard`)
  })

  it("uses an opaque local error redirect when the exchange fails", async () => {
    mocks.exchangeCodeForSession.mockResolvedValue({ error: new Error("bad code") })

    const response = await GET(request("code=invalid&next=%2Fdashboard"))

    expect(response.headers.get("location")).toBe(
      `${ORIGIN}/update-password?error=link_expired`,
    )
  })

  it("treats a request with neither code nor token as a failed link", async () => {
    const response = await GET(request("next=%2Fdashboard"))

    expect(mocks.exchangeCodeForSession).not.toHaveBeenCalled()
    expect(mocks.verifyOtp).not.toHaveBeenCalled()
    expect(response.headers.get("location")).toBe(
      `${ORIGIN}/update-password?error=link_expired`,
    )
  })
})
