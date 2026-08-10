import { describe, expect, it } from "vitest"

import {
  editableCachedInstances,
  isFormsCacheForToday,
  type CachedFormsArea,
  type CachedInstance,
} from "./daily-forms-cache"

// 2026-07-18T03:30:00Z. In UTC that's July 18; in America/Chicago (UTC-5,
// DST) it's still July 17 — the classic near-midnight divergence.
const NOW = new Date("2026-07-18T03:30:00Z")

describe("isFormsCacheForToday", () => {
  it("matches a same-day snapshot in the facility timezone", () => {
    expect(
      isFormsCacheForToday(
        { businessDate: "2026-07-17", timezone: "America/Chicago" },
        NOW,
      ),
    ).toBe(true)
    expect(
      isFormsCacheForToday({ businessDate: "2026-07-18", timezone: "UTC" }, NOW),
    ).toBe(true)
  })

  it("rejects a snapshot from a previous business date", () => {
    expect(
      isFormsCacheForToday({ businessDate: "2026-07-17", timezone: "UTC" }, NOW),
    ).toBe(false)
  })

  it("null timezone falls back to UTC", () => {
    expect(
      isFormsCacheForToday({ businessDate: "2026-07-18", timezone: null }, NOW),
    ).toBe(true)
  })
})

function inst(over: Partial<CachedInstance>): CachedInstance {
  return {
    id: "i1",
    title: "T",
    status: "draft",
    templateName: "Form",
    ownerName: null,
    mine: true,
    snapshot: { template_id: "t", template_name: "Form", version: 1, fields: [] },
    responses: {},
    ...over,
  }
}

function area(instances: CachedInstance[]): CachedFormsArea {
  return { id: "a1", name: "Area", color: null, templates: [], instances }
}

describe("editableCachedInstances", () => {
  it("returns only the user's own drafts", () => {
    const record = {
      locked: false,
      areas: [
        area([
          inst({ id: "mine-draft" }),
          inst({ id: "mine-submitted", status: "submitted" }),
          inst({ id: "theirs-draft", mine: false }),
        ]),
      ],
    }
    expect(editableCachedInstances(record).map((i) => i.id)).toEqual([
      "mine-draft",
    ])
  })

  it("returns nothing when the cached day was locked", () => {
    const record = { locked: true, areas: [area([inst({})])] }
    expect(editableCachedInstances(record)).toEqual([])
  })

  it("flattens across areas", () => {
    const record = {
      locked: false,
      areas: [area([inst({ id: "a" })]), area([inst({ id: "b" })])],
    }
    expect(editableCachedInstances(record).map((i) => i.id)).toEqual(["a", "b"])
  })
})
