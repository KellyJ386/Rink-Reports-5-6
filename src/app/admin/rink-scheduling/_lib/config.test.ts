import { describe, expect, it } from "vitest"

import {
  DAY_LABELS,
  MAX_ACTIVE_RINKS,
  defaultOccupancyWindow,
  describeLastSeen,
  formatTaxRateAsPercent,
  isHexColor,
  minutesToTime,
  normalizeShortCode,
  parseTaxRatePercent,
  parseTimeToMinutes,
  slugify,
  validateHoursRow,
  validateSettings,
  windowsOverlap,
  wrapsMidnight,
} from "./config"

const validSettings = {
  defaultBufferMinutes: 15,
  slotIncrementMinutes: 30,
  defaultPaymentTermsDays: 30,
  invoicePrefix: "INV-",
  taxRatePercent: "",
  lockerLeadMinutes: 45,
  lockerVacateMinutes: 30,
  displayRefreshSeconds: 60,
}

describe("slugify", () => {
  it("lowercases and hyphenates", () => {
    expect(slugify("Main Rink")).toBe("main-rink")
    expect(slugify("Camp/Clinic")).toBe("camp-clinic")
  })

  it("trims leading and trailing separators", () => {
    expect(slugify("  --Olympic Oval--  ")).toBe("olympic-oval")
  })

  it("never returns a slug longer than the column allows", () => {
    expect(slugify("x".repeat(200)).length).toBeLessThanOrEqual(60)
  })
})

describe("normalizeShortCode", () => {
  it("upper-cases and strips punctuation for the TV display", () => {
    expect(normalizeShortCode("main-1")).toBe("MAIN1")
    expect(normalizeShortCode(" oval ")).toBe("OVAL")
  })

  it("caps at the 8 characters the column permits", () => {
    expect(normalizeShortCode("abcdefghijkl")).toBe("ABCDEFGH")
  })
})

describe("isHexColor", () => {
  it("accepts 6-digit hex in either case", () => {
    expect(isHexColor("#4DFF00")).toBe(true)
    expect(isHexColor("#002244")).toBe(true)
    expect(isHexColor("#00224a")).toBe(true)
  })

  it("rejects shorthand, missing hash and bad characters", () => {
    expect(isHexColor("#FFF")).toBe(false)
    expect(isHexColor("4DFF00")).toBe(false)
    expect(isHexColor("#GGGGGG")).toBe(false)
  })
})

describe("time parsing", () => {
  it("parses wall-clock times to minutes past midnight", () => {
    expect(parseTimeToMinutes("06:00")).toBe(360)
    expect(parseTimeToMinutes("23:00")).toBe(1380)
    expect(parseTimeToMinutes("09:30:00")).toBe(570)
  })

  it("rejects impossible clock values", () => {
    expect(parseTimeToMinutes("24:00")).toBeNull()
    expect(parseTimeToMinutes("10:75")).toBeNull()
    expect(parseTimeToMinutes("noon")).toBeNull()
  })

  it("round-trips through minutesToTime", () => {
    expect(minutesToTime(360)).toBe("06:00")
    expect(minutesToTime(1380)).toBe("23:00")
    expect(minutesToTime(0)).toBe("00:00")
  })
})

describe("validateHoursRow", () => {
  it("accepts an ordinary open day", () => {
    expect(validateHoursRow({ dayOfWeek: 1, isClosed: false, openTime: "06:00", closeTime: "23:00" })).toBeNull()
  })

  it("ignores times on a closed day", () => {
    expect(validateHoursRow({ dayOfWeek: 0, isClosed: true, openTime: "", closeTime: "" })).toBeNull()
  })

  it("allows a day that runs past midnight", () => {
    // A 6am-2am rink is normal, and reads as open > close.
    expect(validateHoursRow({ dayOfWeek: 5, isClosed: false, openTime: "06:00", closeTime: "02:00" })).toBeNull()
  })

  it("rejects a zero-length open day as the typo it is", () => {
    const err = validateHoursRow({ dayOfWeek: 2, isClosed: false, openTime: "08:00", closeTime: "08:00" })
    expect(err).toMatch(/closed/i)
  })

  it("rejects an out-of-range weekday", () => {
    expect(validateHoursRow({ dayOfWeek: 7, isClosed: false, openTime: "06:00", closeTime: "23:00" })).toMatch(/0-6/)
  })

  it("has a label for every valid weekday", () => {
    expect(DAY_LABELS).toHaveLength(7)
    expect(DAY_LABELS[0]).toBe("Sunday")
  })
})

describe("wrapsMidnight", () => {
  it("is true only when the close time precedes the open time", () => {
    expect(wrapsMidnight(360, 120)).toBe(true)
    expect(wrapsMidnight(360, 1380)).toBe(false)
  })
})

describe("tax rate conversion", () => {
  it("converts a typed percent to the stored fraction", () => {
    expect(parseTaxRatePercent("8.75").value).toBe(0.0875)
    expect(parseTaxRatePercent("0").value).toBe(0)
  })

  it("treats blank as no tax at all, not as zero tax", () => {
    // Distinct states: null suppresses the invoice tax line entirely.
    expect(parseTaxRatePercent("").value).toBeNull()
    expect(parseTaxRatePercent("   ").value).toBeNull()
    expect(parseTaxRatePercent("").error).toBeUndefined()
  })

  it("rejects out-of-range and non-numeric input", () => {
    expect(parseTaxRatePercent("-1").error).toBeTruthy()
    expect(parseTaxRatePercent("101").error).toBeTruthy()
    expect(parseTaxRatePercent("lots").error).toBeTruthy()
  })

  it("round-trips back to a percent for display", () => {
    expect(formatTaxRateAsPercent(0.0875)).toBe("8.75")
    expect(formatTaxRateAsPercent(null)).toBe("")
  })
})

describe("validateSettings", () => {
  it("passes a valid settings payload", () => {
    expect(validateSettings(validSettings)).toEqual({})
  })

  it("mirrors each database CHECK with a readable message", () => {
    const errors = validateSettings({
      ...validSettings,
      defaultBufferMinutes: 121,
      slotIncrementMinutes: 7,
      defaultPaymentTermsDays: 400,
      invoicePrefix: "IN VOICE!",
      lockerLeadMinutes: -1,
      lockerVacateMinutes: 999,
      displayRefreshSeconds: 5,
      taxRatePercent: "250",
    })
    expect(Object.keys(errors).sort()).toEqual(
      [
        "defaultBufferMinutes",
        "defaultPaymentTermsDays",
        "displayRefreshSeconds",
        "invoicePrefix",
        "lockerLeadMinutes",
        "lockerVacateMinutes",
        "slotIncrementMinutes",
        "taxRatePercent",
      ].sort(),
    )
  })

  it("accepts a zero buffer, which is a real choice for a rink that never floods between slots", () => {
    expect(validateSettings({ ...validSettings, defaultBufferMinutes: 0 })).toEqual({})
  })
})

describe("locker room occupancy", () => {
  const start = Date.UTC(2026, 8, 1, 22, 0, 0) // 18:00 EDT
  const end = Date.UTC(2026, 8, 1, 23, 0, 0)

  it("applies the lead and vacate defaults around the booking", () => {
    const { fromMs, untilMs } = defaultOccupancyWindow(start, end, 45, 30)
    expect(fromMs).toBe(start - 45 * 60_000)
    expect(untilMs).toBe(end + 30 * 60_000)
  })

  it("collapses to the booking window when both are zero", () => {
    const { fromMs, untilMs } = defaultOccupancyWindow(start, end, 0, 0)
    expect(fromMs).toBe(start)
    expect(untilMs).toBe(end)
  })

  it("flags a genuine overlap", () => {
    expect(windowsOverlap(0, 100, 50, 150)).toBe(true)
    expect(windowsOverlap(50, 150, 0, 100)).toBe(true)
  })

  it("treats an exact handover as NOT overlapping", () => {
    // Half-open, matching the booking constraint's '[)' convention: one team
    // clearing out at exactly the moment the next moves in is fine.
    expect(windowsOverlap(0, 100, 100, 200)).toBe(false)
  })

  it("does not flag disjoint windows", () => {
    expect(windowsOverlap(0, 100, 200, 300)).toBe(false)
  })
})

describe("MAX_ACTIVE_RINKS", () => {
  it("is the 10 the module spec caps a facility at", () => {
    expect(MAX_ACTIVE_RINKS).toBe(10)
  })
})

describe("describeLastSeen", () => {
  const now = Date.UTC(2026, 8, 1, 12, 0, 0)
  const minutesAgo = (n: number) => new Date(now - n * 60_000).toISOString()

  it("reports a revoked display as revoked, whatever its last check-in", () => {
    expect(describeLastSeen(minutesAgo(1), now, true)).toBe("revoked")
  })

  it("spells out a display that has never checked in", () => {
    // The case an admin most needs to notice: a screen that was never plugged
    // in looks identical to a healthy one if this renders blank.
    expect(describeLastSeen(null, now, false)).toBe("never checked in")
  })

  it("treats a very recent poll as active", () => {
    expect(describeLastSeen(minutesAgo(0), now, false)).toBe("active now")
    expect(describeLastSeen(minutesAgo(1), now, false)).toBe("active now")
  })

  it("scales from minutes to hours to days", () => {
    expect(describeLastSeen(minutesAgo(30), now, false)).toBe("last seen 30m ago")
    expect(describeLastSeen(minutesAgo(60 * 5), now, false)).toBe("last seen 5h ago")
    expect(describeLastSeen(minutesAgo(60 * 24 * 3), now, false)).toBe("last seen 3d ago")
  })

  it("does not crash on an unparseable timestamp", () => {
    expect(describeLastSeen("not-a-date", now, false)).toBe("never checked in")
  })
})
