import { describe, expect, it } from "vitest"

import { parseCurrentTempF, parseZipCoords } from "./parse"

describe("parseZipCoords", () => {
  it("parses the Zippopotam shape (string lat/lon)", () => {
    expect(
      parseZipCoords({
        "post code": "13244",
        places: [
          { "place name": "Syracuse", latitude: "43.0362", longitude: "-76.1339" },
        ],
      }),
    ).toEqual({ latitude: 43.0362, longitude: -76.1339 })
  })

  it("rejects empty/missing places and malformed payloads", () => {
    expect(parseZipCoords(null)).toBeNull()
    expect(parseZipCoords("nope")).toBeNull()
    expect(parseZipCoords({})).toBeNull()
    expect(parseZipCoords({ places: [] })).toBeNull()
    expect(parseZipCoords({ places: [{ latitude: "abc", longitude: "1" }] })).toBeNull()
  })

  it("rejects out-of-range coordinates", () => {
    expect(
      parseZipCoords({ places: [{ latitude: "91", longitude: "0" }] }),
    ).toBeNull()
    expect(
      parseZipCoords({ places: [{ latitude: "0", longitude: "-181" }] }),
    ).toBeNull()
  })
})

describe("parseCurrentTempF", () => {
  it("parses the Open-Meteo current-weather shape", () => {
    expect(parseCurrentTempF({ current: { temperature_2m: 71.4 } })).toBe(71.4)
    expect(parseCurrentTempF({ current: { temperature_2m: -12 } })).toBe(-12)
  })

  it("rejects malformed payloads", () => {
    expect(parseCurrentTempF(null)).toBeNull()
    expect(parseCurrentTempF({})).toBeNull()
    expect(parseCurrentTempF({ current: {} })).toBeNull()
    expect(parseCurrentTempF({ current: { temperature_2m: "hot" } })).toBeNull()
  })

  it("rejects physically implausible values", () => {
    expect(parseCurrentTempF({ current: { temperature_2m: 999 } })).toBeNull()
    expect(parseCurrentTempF({ current: { temperature_2m: -200 } })).toBeNull()
  })
})
