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

const FACILITY_ID = "4490bad7-ef1b-4544-8d7f-7aea49884550"

class FakeSupabase {
  readonly cronRuns: Array<Record<string, unknown>> = []
  readonly rpcCalls: Array<{ fn: string; args: unknown }> = []

  constructor(
    private readonly rpcResult: { data: unknown; error: { message: string } | null } = {
      data: { facility_id: FACILITY_ID, days: 1, total_rows: 8 },
      error: null,
    },
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

function requestWith(query: string) {
  return new Request(`https://app.test/api/cron/daily-metrics-backfill${query}`, {
    headers: { authorization: "Bearer test-cron-secret" },
  })
}

describe("daily-metrics-backfill cron route", () => {
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

  it("rejects a request without the correct bearer secret", async () => {
    const supabase = new FakeSupabase()
    mocks.createClient.mockReturnValue(supabase)

    const { GET } = await import("./route")
    const res = await GET(
      new Request(
        `https://app.test/api/cron/daily-metrics-backfill?facility_id=${FACILITY_ID}&from=2026-08-01&to=2026-08-05`,
        { headers: { authorization: "Bearer wrong-secret" } },
      ),
    )

    expect(res.status).toBe(401)
    expect(supabase.rpcCalls).toHaveLength(0)
  })

  it("treats a request with no params as a harmless canary no-op (the weekly schedule)", async () => {
    const supabase = new FakeSupabase()
    mocks.createClient.mockReturnValue(supabase)

    const { GET } = await import("./route")
    const res = await GET(requestWith(""))
    const body = (await res.json()) as Record<string, unknown>

    expect(res.status).toBe(200)
    expect(body).toMatchObject({ ok: true, ran: false })
    expect(supabase.rpcCalls).toHaveLength(0)
    // The canary must never look like a failure in cron_runs.
    expect(supabase.cronRuns[0]).toMatchObject({ ok: true })
  })

  it.each([
    ["not-a-uuid", "2026-08-01", "2026-08-05", "facility_id must be a valid UUID"],
    [FACILITY_ID, "not-a-date", "2026-08-05", "from and to are required, in YYYY-MM-DD format"],
    [FACILITY_ID, "2026-08-01", "08/05/2026", "from and to are required, in YYYY-MM-DD format"],
    [FACILITY_ID, "2026-08-10", "2026-08-01", "to must be on or after from"],
  ])("rejects invalid params (%s, %s, %s) with a 400 and never calls the RPC", async (fid, from, to, expectedError) => {
    const supabase = new FakeSupabase()
    mocks.createClient.mockReturnValue(supabase)

    const { GET } = await import("./route")
    const res = await GET(requestWith(`?facility_id=${fid}&from=${from}&to=${to}`))
    const body = (await res.json()) as Record<string, unknown>

    expect(res.status).toBe(400)
    expect(body).toMatchObject({ ok: false, error: expectedError })
    expect(supabase.rpcCalls).toHaveLength(0)
  })

  it("rejects a range over the 400-day cap before calling the RPC", async () => {
    const supabase = new FakeSupabase()
    mocks.createClient.mockReturnValue(supabase)

    const { GET } = await import("./route")
    const res = await GET(
      requestWith(`?facility_id=${FACILITY_ID}&from=2020-01-01&to=2021-06-01`),
    )
    const body = (await res.json()) as Record<string, unknown>

    expect(res.status).toBe(400)
    expect(body.error).toMatch(/400-day cap/)
    expect(supabase.rpcCalls).toHaveLength(0)
  })

  it("accepts a range at exactly the 400-day cap", async () => {
    const supabase = new FakeSupabase()
    mocks.createClient.mockReturnValue(supabase)

    const { GET } = await import("./route")
    // 2026-01-01 .. 2027-02-04 inclusive is exactly 400 days.
    const res = await GET(
      requestWith(`?facility_id=${FACILITY_ID}&from=2026-01-01&to=2027-02-04`),
    )

    expect(res.status).toBe(200)
    expect(supabase.rpcCalls).toHaveLength(1)
  })

  it("calls backfill_facility_daily_metrics with the parsed params and surfaces the summary", async () => {
    const supabase = new FakeSupabase({
      data: { facility_id: FACILITY_ID, days: 5, total_rows: 40 },
      error: null,
    })
    mocks.createClient.mockReturnValue(supabase)

    const { GET } = await import("./route")
    const res = await GET(
      requestWith(`?facility_id=${FACILITY_ID}&from=2026-08-01&to=2026-08-05`),
    )
    const body = (await res.json()) as Record<string, unknown>

    expect(res.status).toBe(200)
    expect(supabase.rpcCalls).toEqual([
      {
        fn: "backfill_facility_daily_metrics",
        args: { p_facility_id: FACILITY_ID, p_from: "2026-08-01", p_to: "2026-08-05" },
      },
    ])
    expect(body).toMatchObject({ ok: true, facility_id: FACILITY_ID, days: 5, total_rows: 40 })
  })

  it("returns an opaque 500 and logs the real error when the RPC fails", async () => {
    const supabase = new FakeSupabase({
      data: null,
      error: { message: "permission denied for function backfill_facility_daily_metrics" },
    })
    mocks.createClient.mockReturnValue(supabase)

    const { GET } = await import("./route")
    const res = await GET(
      requestWith(`?facility_id=${FACILITY_ID}&from=2026-08-01&to=2026-08-05`),
    )
    const body = (await res.json()) as Record<string, unknown>

    expect(res.status).toBe(500)
    expect(body.error).toBe("backfill failed — see server logs")
    expect(mocks.logServerError).toHaveBeenCalledWith(
      "cron/daily-metrics-backfill",
      expect.objectContaining({ message: "permission denied for function backfill_facility_daily_metrics" }),
      { facilityId: FACILITY_ID, from: "2026-08-01", to: "2026-08-05" },
    )
  })
})
