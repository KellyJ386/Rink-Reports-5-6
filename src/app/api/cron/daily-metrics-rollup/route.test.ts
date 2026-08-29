import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => {
  return {
    createClient: vi.fn(),
    logServerError: vi.fn(),
  }
})

vi.mock("@supabase/supabase-js", () => ({
  createClient: mocks.createClient,
}))

vi.mock("@/lib/observability/log-server-error", () => ({
  logServerError: mocks.logServerError,
}))

/** Minimal fake covering only what this route touches: one RPC, cron_runs. */
class FakeSupabase {
  readonly cronRuns: Array<Record<string, unknown>> = []
  readonly rpcCalls: Array<{ fn: string; args: unknown }> = []

  constructor(
    private readonly rpcResult: { data: unknown; error: { message: string } | null },
  ) {}

  rpc(fn: string, args?: unknown) {
    this.rpcCalls.push({ fn, args })
    return Promise.resolve(this.rpcResult)
  }

  from(table: string) {
    expect(table).toBe("cron_runs")
    return {
      insert: (payload: Record<string, unknown>) => {
        this.cronRuns.push(payload)
        return Promise.resolve({ data: null, error: null })
      },
    }
  }
}

describe("daily-metrics-rollup cron route", () => {
  const oldEnv = { ...process.env }

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    process.env = {
      ...oldEnv,
      CRON_SECRET: "test-cron-secret",
      NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "service-role",
    }
  })

  afterEach(() => {
    process.env = oldEnv
  })

  function authedRequest() {
    return new Request("https://app.test/api/cron/daily-metrics-rollup", {
      headers: { authorization: "Bearer test-cron-secret" },
    })
  }

  it("rejects a request without the correct bearer secret", async () => {
    const supabase = new FakeSupabase({ data: null, error: null })
    mocks.createClient.mockReturnValue(supabase)

    const { GET } = await import("./route")
    const res = await GET(
      new Request("https://app.test/api/cron/daily-metrics-rollup", {
        headers: { authorization: "Bearer wrong-secret" },
      }),
    )

    expect(res.status).toBe(401)
    expect(supabase.rpcCalls).toHaveLength(0)
  })

  it("calls run_daily_metrics_rollup_for_yesterday with no args and surfaces the summary", async () => {
    const supabase = new FakeSupabase({
      data: {
        facilities: 3,
        total_rows: 24,
        per_facility: [
          { facility_id: "f1", business_date: "2026-08-27", rows: 8 },
          { facility_id: "f2", business_date: "2026-08-27", rows: 8 },
          { facility_id: "f3", business_date: "2026-08-27", rows: 8 },
        ],
      },
      error: null,
    })
    mocks.createClient.mockReturnValue(supabase)

    const { GET } = await import("./route")
    const res = await GET(authedRequest())
    const body = (await res.json()) as Record<string, unknown>

    expect(res.status).toBe(200)
    expect(supabase.rpcCalls).toEqual([
      { fn: "run_daily_metrics_rollup_for_yesterday", args: undefined },
    ])
    expect(body).toMatchObject({ ok: true, facilities: 3, total_rows: 24 })

    // withCronRoute's own record — proves the route never bypasses it.
    expect(supabase.cronRuns).toHaveLength(1)
    expect(supabase.cronRuns[0]).toMatchObject({
      route: "/api/cron/daily-metrics-rollup",
      ok: true,
    })
  })

  it("returns an opaque 500 and logs the real error when the RPC fails", async () => {
    const supabase = new FakeSupabase({
      data: null,
      error: { message: "relation facility_daily_metrics does not exist" },
    })
    mocks.createClient.mockReturnValue(supabase)

    const { GET } = await import("./route")
    const res = await GET(authedRequest())
    const body = (await res.json()) as Record<string, unknown>

    expect(res.status).toBe(500)
    expect(body.error).toBe("rollup failed — see server logs")
    expect(body).not.toHaveProperty("relation facility_daily_metrics does not exist")
    expect(mocks.logServerError).toHaveBeenCalledWith(
      "cron/daily-metrics-rollup",
      expect.objectContaining({ message: "relation facility_daily_metrics does not exist" }),
    )
    expect(supabase.cronRuns[0]).toMatchObject({ ok: false })
  })

  it("defaults facilities/total_rows to 0 when the RPC returns null data", async () => {
    const supabase = new FakeSupabase({ data: null, error: null })
    mocks.createClient.mockReturnValue(supabase)

    const { GET } = await import("./route")
    const res = await GET(authedRequest())
    const body = (await res.json()) as Record<string, unknown>

    expect(res.status).toBe(200)
    expect(body).toMatchObject({ ok: true, facilities: 0, total_rows: 0 })
  })
})
