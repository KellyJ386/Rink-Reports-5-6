import { describe, expect, it } from "vitest"

import {
  evaluateSustained,
  lookbackMsForSpecs,
  parseSustainedSpecs,
  pollutantOfReadingKey,
  type SeriesPoint,
  type SustainedSpec,
} from "./sustained"

const MIN = 60_000

describe("parseSustainedSpecs", () => {
  it("parses the MN-style rule body (string JSON)", () => {
    const body =
      '{"sustained":[{"co":40,"minutes":60},{"co":20,"minutes":120},{"no2":0.6,"minutes":60}]}'
    expect(parseSustainedSpecs(body)).toEqual([
      { pollutant: "co", threshold: 40, minutes: 60 },
      { pollutant: "co", threshold: 20, minutes: 120 },
      { pollutant: "no2", threshold: 0.6, minutes: 60 },
    ])
  })

  it("accepts an already-parsed object", () => {
    expect(
      parseSustainedSpecs({ sustained: [{ co: 40, minutes: 60 }] }),
    ).toEqual([{ pollutant: "co", threshold: 40, minutes: 60 }])
  })

  it("is tolerant: bad JSON / shape / entries yield no specs", () => {
    expect(parseSustainedSpecs("not json")).toEqual([])
    expect(parseSustainedSpecs(null)).toEqual([])
    expect(parseSustainedSpecs('{"other":1}')).toEqual([])
    expect(
      parseSustainedSpecs('{"sustained":[{"co":40},{"minutes":60}]}'),
    ).toEqual([]) // first lacks minutes, second has only the reserved key
  })
})

describe("pollutantOfReadingKey", () => {
  it("maps reading-type keys to spec pollutants", () => {
    expect(pollutantOfReadingKey("co_ppm")).toBe("co")
    expect(pollutantOfReadingKey("no2_ppm")).toBe("no2")
    expect(pollutantOfReadingKey("co2_ppm")).toBe("co2")
  })
})

describe("lookbackMsForSpecs", () => {
  it("is the largest minutes window", () => {
    const specs: SustainedSpec[] = [
      { pollutant: "co", threshold: 40, minutes: 60 },
      { pollutant: "co", threshold: 20, minutes: 120 },
    ]
    expect(lookbackMsForSpecs(specs)).toBe(120 * MIN)
  })
})

describe("evaluateSustained", () => {
  const co = (mins: number, value: number): SeriesPoint => ({
    atMs: 1_000_000_000_000 + mins * MIN,
    value,
  })

  it("triggers when an at/above run spans >= minutes", () => {
    // CO >= 40 at t=0,30,60 (60 min span) → triggers the 60-min/40 spec.
    const series = new Map([["co", [co(0, 45), co(30, 41), co(60, 50)]]])
    const hits = evaluateSustained(
      [{ pollutant: "co", threshold: 40, minutes: 60 }],
      series,
    )
    expect(hits).toHaveLength(1)
    expect(hits[0]).toMatchObject({ pollutant: "co", threshold: 40, observedMinutes: 60 })
  })

  it("does not trigger when the newest reading is below threshold", () => {
    const series = new Map([["co", [co(0, 45), co(30, 50), co(60, 12)]]])
    expect(
      evaluateSustained([{ pollutant: "co", threshold: 40, minutes: 60 }], series),
    ).toEqual([])
  })

  it("does not trigger when the run is shorter than minutes", () => {
    // Only the last 30 min are >= 40 (the 0-min reading broke the run).
    const series = new Map([["co", [co(0, 10), co(30, 45), co(60, 50)]]])
    expect(
      evaluateSustained([{ pollutant: "co", threshold: 40, minutes: 60 }], series),
    ).toEqual([])
  })

  it("a single reading is never sustained", () => {
    const series = new Map([["co", [co(60, 99)]]])
    expect(
      evaluateSustained([{ pollutant: "co", threshold: 40, minutes: 60 }], series),
    ).toEqual([])
  })

  it("evaluates the lower long-duration band independently", () => {
    // CO held at 25 for 120 min: clears the 20/120 spec but not the 40/60 spec.
    const series = new Map([
      ["co", [co(0, 25), co(60, 25), co(120, 25)]],
    ])
    const hits = evaluateSustained(
      [
        { pollutant: "co", threshold: 40, minutes: 60 },
        { pollutant: "co", threshold: 20, minutes: 120 },
      ],
      series,
    )
    expect(hits).toHaveLength(1)
    expect(hits[0]).toMatchObject({ threshold: 20, minutes: 120, observedMinutes: 120 })
  })

  it("ignores pollutants with no series", () => {
    expect(
      evaluateSustained(
        [{ pollutant: "no2", threshold: 0.6, minutes: 60 }],
        new Map(),
      ),
    ).toEqual([])
  })
})
