import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => {
  return {
    createClient: vi.fn(),
    isEmailConfigured: vi.fn(() => true),
    sendEmail: vi.fn(async () => ({ ok: true as const })),
    downloadPdf: vi.fn(),
    logServerError: vi.fn(),
  }
})

vi.mock("@supabase/supabase-js", () => ({
  createClient: mocks.createClient,
}))

vi.mock("@/lib/notifications/transport/email", () => ({
  isEmailConfigured: mocks.isEmailConfigured,
  sendEmail: mocks.sendEmail,
}))

vi.mock("@/lib/notifications/pdf/upload", () => ({
  downloadPdf: mocks.downloadPdf,
}))

vi.mock("@/lib/observability/log-server-error", () => ({
  logServerError: mocks.logServerError,
}))

type RecipientFixture = {
  id: string
  message_id: string
  email_attempts: number
  employees: { email: string }
  communication_messages: {
    subject: string
    body: string
    pdf_url: string | null
  }
}

type Settlement = {
  payload: Record<string, unknown>
  filters: Array<[string, unknown]>
}

class FakeSupabase {
  private claimed = false
  readonly settlements: Settlement[] = []
  readonly claimTokens: string[] = []

  constructor(private readonly row: RecipientFixture) {}

  from(table: string) {
    expect(table).toBe("communication_recipients")
    return new FakeQuery(this)
  }

  loadRows() {
    return { data: [this.row], error: null }
  }

  applyUpdate(payload: Record<string, unknown>, filters: Array<[string, unknown]>) {
    if (payload.email_status === "sending") {
      this.claimTokens.push(String(payload.email_claim_token))
      if (this.claimed) return { data: [], error: null }
      this.claimed = true
      return { data: [{ id: this.row.id }], error: null }
    }

    this.settlements.push({ payload, filters })
    return { data: null, error: null }
  }
}

class FakeQuery {
  private mode: "select" | "update" | null = null
  private payload: Record<string, unknown> | null = null
  private filters: Array<[string, unknown]> = []

  constructor(private readonly supabase: FakeSupabase) {}

  select() {
    this.mode ??= "select"
    return this
  }

  update(payload: Record<string, unknown>) {
    this.mode = "update"
    this.payload = payload
    return this
  }

  eq(column: string, value: unknown) {
    this.filters.push([column, value])
    return this
  }

  in(column: string, value: unknown) {
    this.filters.push([column, value])
    return this
  }

  or(value: string) {
    this.filters.push(["or", value])
    return this
  }

  order() {
    return this
  }

  limit() {
    return this
  }

  then<TResult1 = unknown, TResult2 = never>(
    onfulfilled?:
      | ((value: unknown) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?:
      | ((reason: unknown) => TResult2 | PromiseLike<TResult2>)
      | null,
  ) {
    try {
      const result =
        this.mode === "update" && this.payload
          ? this.supabase.applyUpdate(this.payload, this.filters)
          : this.supabase.loadRows()
      return Promise.resolve(result).then(onfulfilled, onrejected)
    } catch (error) {
      return Promise.reject(error).then(onfulfilled, onrejected)
    }
  }
}

describe("send-communications cron route", () => {
  const oldEnv = { ...process.env }
  let consoleLog: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    consoleLog = vi.spyOn(console, "log").mockImplementation(() => {})
    process.env = {
      ...oldEnv,
      CRON_SECRET: "test-cron-secret",
      NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "service-role",
    }
  })

  afterEach(() => {
    consoleLog.mockRestore()
    process.env = oldEnv
  })

  it("claim-token gates two concurrent workers so only one email is sent", async () => {
    const supabase = new FakeSupabase({
      id: "recipient-1",
      message_id: "message-1",
      email_attempts: 0,
      employees: { email: "operator@example.com" },
      communication_messages: {
        subject: "Safety update",
        body: "Check the resurfacer before opening.",
        pdf_url: null,
      },
    })
    mocks.createClient.mockReturnValue(supabase)

    const { GET } = await import("./route")
    const request = new Request("https://app.test/api/cron/send-communications", {
      headers: { authorization: "Bearer test-cron-secret" },
    })

    const [a, b] = await Promise.all([GET(request), GET(request.clone())])
    expect(a.status).toBe(200)
    expect(b.status).toBe(200)
    expect(mocks.sendEmail).toHaveBeenCalledTimes(1)
    expect(mocks.sendEmail).toHaveBeenCalledWith({
      to: "operator@example.com",
      subject: "Safety update",
      bodyText: "Check the resurfacer before opening.",
      attachments: undefined,
    })

    expect(supabase.claimTokens).toHaveLength(2)
    const winningToken = supabase.claimTokens[0]
    expect(supabase.settlements).toHaveLength(1)
    expect(supabase.settlements[0]?.payload).toMatchObject({
      email_status: "sent",
      email_claim_token: null,
      email_attempts: 1,
      email_next_attempt_at: null,
      email_error: null,
    })
    expect(supabase.settlements[0]?.filters).toEqual(
      expect.arrayContaining([
        ["id", "recipient-1"],
        ["email_status", "sending"],
        ["email_claim_token", winningToken],
      ]),
    )

    const bodies = await Promise.all([a.json(), b.json()])
    expect(bodies.map((body) => body.email.sent).sort()).toEqual([0, 1])
    expect(bodies.map((body) => body.email.attempted).sort()).toEqual([0, 1])
  })
})
