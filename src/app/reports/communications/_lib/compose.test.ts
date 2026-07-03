import { describe, expect, it } from "vitest"

import {
  buildMessageInputFromObject,
  buildRecipientRows,
  filterSendableGroups,
  isUuid,
  validateMessageInput,
} from "./compose"

const G1 = "11111111-1111-4111-8111-111111111111"
const G2 = "22222222-2222-4222-8222-222222222222"
const TPL = "33333333-3333-4333-8333-333333333333"

describe("isUuid", () => {
  it("accepts a valid v4-shaped uuid and rejects junk", () => {
    expect(isUuid(G1)).toBe(true)
    expect(isUuid("not-a-uuid")).toBe(false)
    expect(isUuid("")).toBe(false)
  })
})

describe("buildMessageInputFromObject", () => {
  it("returns null for non-objects", () => {
    expect(buildMessageInputFromObject(null)).toBeNull()
    expect(buildMessageInputFromObject("nope")).toBeNull()
  })

  it("trims subject/body and nulls an empty subject", () => {
    const out = buildMessageInputFromObject({
      subject: "  Hello  ",
      body: "  hi team  ",
      group_ids: [G1],
    })!
    expect(out.subject).toBe("Hello")
    expect(out.body).toBe("hi team")

    const noSubject = buildMessageInputFromObject({
      subject: "   ",
      body: "x",
      group_ids: [G1],
    })!
    expect(noSubject.subject).toBeNull()
  })

  it("parses requires_acknowledgement from boolean and form-checkbox values", () => {
    expect(buildMessageInputFromObject({ requires_acknowledgement: true })!.requiresAck).toBe(true)
    expect(buildMessageInputFromObject({ requires_acknowledgement: "on" })!.requiresAck).toBe(true)
    expect(buildMessageInputFromObject({ requires_acknowledgement: "true" })!.requiresAck).toBe(true)
    expect(buildMessageInputFromObject({ requires_acknowledgement: "off" })!.requiresAck).toBe(false)
    expect(buildMessageInputFromObject({})!.requiresAck).toBe(false)
  })

  it("keeps only valid uuid group ids and dedupes them", () => {
    const out = buildMessageInputFromObject({
      body: "x",
      group_ids: [G1, "bad", G1, "  ", G2],
    })!
    expect(out.groupIds).toEqual([G1, G2])
  })

  it("only accepts a valid uuid template id, else null", () => {
    expect(buildMessageInputFromObject({ template_id: TPL })!.templateId).toBe(TPL)
    expect(buildMessageInputFromObject({ template_id: "nope" })!.templateId).toBeNull()
    expect(buildMessageInputFromObject({})!.templateId).toBeNull()
  })

  it("defaults missing fields safely", () => {
    const out = buildMessageInputFromObject({})!
    expect(out).toEqual({
      subject: null,
      body: "",
      requiresAck: false,
      templateId: null,
      groupIds: [],
      recipientEmployeeIds: [],
      parentMessageId: null,
    })
  })

  it("parses reply fields: direct recipients + parent message id", () => {
    const out = buildMessageInputFromObject({
      body: "reply body",
      recipient_employee_ids: [G1, "junk", G1],
      parent_message_id: TPL,
    })!
    expect(out.recipientEmployeeIds).toEqual([G1])
    expect(out.parentMessageId).toBe(TPL)
    expect(
      buildMessageInputFromObject({ parent_message_id: "nope" })!
        .parentMessageId,
    ).toBeNull()
  })
})

describe("validateMessageInput", () => {
  it("accepts a body + at least one recipient group", () => {
    const input = buildMessageInputFromObject({ body: "hi", group_ids: [G1] })!
    expect(validateMessageInput(input)).toEqual({ ok: true })
  })

  it("rejects an empty body", () => {
    const input = buildMessageInputFromObject({ body: "   ", group_ids: [G1] })!
    const res = validateMessageInput(input)
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.fieldErrors.body).toBeTruthy()
  })

  it("rejects when no recipient groups are selected", () => {
    const input = buildMessageInputFromObject({ body: "hi", group_ids: [] })!
    const res = validateMessageInput(input)
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.fieldErrors.group_ids).toBeTruthy()
  })

  it("accepts direct recipients in place of groups (reply flow)", () => {
    const input = buildMessageInputFromObject({
      body: "hi",
      recipient_employee_ids: [G1],
      parent_message_id: TPL,
    })!
    expect(validateMessageInput(input)).toEqual({ ok: true })
  })

  it("reports both errors at once, body first (focus order)", () => {
    const input = buildMessageInputFromObject({ body: "", group_ids: ["bad"] })!
    const res = validateMessageInput(input)
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(Object.keys(res.fieldErrors)[0]).toBe("body")
      expect(res.fieldErrors.group_ids).toBeTruthy()
    }
  })
})

describe("filterSendableGroups", () => {
  const groups = [
    { id: G1, is_active: true, staff_can_message: true },
    { id: G2, is_active: true, staff_can_message: false },
    { id: TPL, is_active: false, staff_can_message: true },
  ]

  it("admins can send to any active group", () => {
    const out = filterSendableGroups(groups, { isAdmin: true })
    expect(out.map((g) => g.id)).toEqual([G1, G2])
  })

  it("non-admin staff are restricted to staff_can_message groups", () => {
    const out = filterSendableGroups(groups, { isAdmin: false })
    expect(out.map((g) => g.id)).toEqual([G1])
  })

  it("inactive groups are never sendable, even for admins", () => {
    const out = filterSendableGroups(groups, { isAdmin: true })
    expect(out.some((g) => g.id === TPL)).toBe(false)
  })
})

describe("buildRecipientRows", () => {
  const MSG = "44444444-4444-4444-8444-444444444444"
  const FAC = "55555555-5555-4555-8555-555555555555"
  const NOW = "2026-07-03T12:00:00.000Z"

  it("dedupes employees who appear in several groups", () => {
    const rows = buildRecipientRows(MSG, FAC, [G1, G2, G1], NOW)
    expect(rows).toHaveLength(2)
    expect(rows.map((r) => r.employee_id)).toEqual([G1, G2])
  })

  it("stamps every row with the message, facility, and delivery time", () => {
    const rows = buildRecipientRows(MSG, FAC, [G1], NOW)
    expect(rows[0]).toEqual({
      message_id: MSG,
      employee_id: G1,
      facility_id: FAC,
      delivered_at: NOW,
    })
  })

  it("returns no rows for no members", () => {
    expect(buildRecipientRows(MSG, FAC, [], NOW)).toEqual([])
  })
})
