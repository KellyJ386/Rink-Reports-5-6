import { describe, expect, it } from "vitest"

import {
  diffAssignees,
  isDateWithinAssignmentWindow,
  summarizeAreaCompletion,
} from "./assignment-compute"

describe("diffAssignees", () => {
  it("computes adds and removes", () => {
    expect(diffAssignees(["a", "b"], ["b", "c"])).toEqual({
      toAdd: ["c"],
      toRemove: ["a"],
    })
  })

  it("empty current adds everything", () => {
    expect(diffAssignees([], ["a", "b"])).toEqual({
      toAdd: ["a", "b"],
      toRemove: [],
    })
  })

  it("empty next removes everything", () => {
    expect(diffAssignees(["a", "b"], [])).toEqual({
      toAdd: [],
      toRemove: ["a", "b"],
    })
  })

  it("identical sets are a no-op and duplicates are deduped", () => {
    expect(diffAssignees(["a", "a", "b"], ["b", "a"])).toEqual({
      toAdd: [],
      toRemove: [],
    })
  })
})

describe("isDateWithinAssignmentWindow", () => {
  const today = "2026-07-18"

  it("accepts today and the window edges", () => {
    expect(isDateWithinAssignmentWindow("2026-07-18", today)).toBe(true)
    expect(isDateWithinAssignmentWindow("2026-07-16", today)).toBe(true)
    expect(isDateWithinAssignmentWindow("2026-07-20", today)).toBe(true)
  })

  it("rejects dates outside the window", () => {
    expect(isDateWithinAssignmentWindow("2026-07-15", today)).toBe(false)
    expect(isDateWithinAssignmentWindow("2026-07-21", today)).toBe(false)
  })

  it("crosses month boundaries correctly", () => {
    expect(isDateWithinAssignmentWindow("2026-08-01", "2026-07-31")).toBe(true)
    expect(isDateWithinAssignmentWindow("2026-08-03", "2026-07-31")).toBe(false)
  })

  it("rejects malformed input", () => {
    expect(isDateWithinAssignmentWindow("07/18/2026", today)).toBe(false)
    expect(isDateWithinAssignmentWindow("2026-13-99", today)).toBe(false)
    expect(isDateWithinAssignmentWindow("", today)).toBe(false)
  })
})

describe("summarizeAreaCompletion", () => {
  it("counts distinct submitted templates", () => {
    expect(summarizeAreaCompletion(["t1", "t2"], ["t1", "t1"])).toEqual({
      templatesTotal: 2,
      templatesDone: 1,
      done: true,
    })
  })

  it("no submissions -> not done", () => {
    expect(summarizeAreaCompletion(["t1"], [])).toEqual({
      templatesTotal: 1,
      templatesDone: 0,
      done: false,
    })
  })

  it("a submission against a retired template still marks the area done", () => {
    expect(summarizeAreaCompletion(["t1"], ["gone"])).toEqual({
      templatesTotal: 1,
      templatesDone: 0,
      done: true,
    })
  })
})
