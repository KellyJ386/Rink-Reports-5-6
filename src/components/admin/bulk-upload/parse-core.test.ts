import { describe, expect, it } from "vitest"

import {
  normalizeCellValue,
  parseCsvText,
  toParsedSheet,
} from "./parse-core"

describe("parseCsvText", () => {
  it("parses a simple header + rows grid", () => {
    expect(parseCsvText("a,b,c\n1,2,3\n4,5,6")).toEqual([
      ["a", "b", "c"],
      ["1", "2", "3"],
      ["4", "5", "6"],
    ])
  })

  it("handles CRLF and a trailing newline without an extra row", () => {
    expect(parseCsvText("a,b\r\n1,2\r\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ])
  })

  it("handles quoted fields with commas, newlines, and escaped quotes", () => {
    expect(
      parseCsvText('name,notes\n"Smith, Jo","line1\nline2"\n"say ""hi""",x'),
    ).toEqual([
      ["name", "notes"],
      ["Smith, Jo", "line1\nline2"],
      ['say "hi"', "x"],
    ])
  })

  it("strips a UTF-8 BOM", () => {
    expect(parseCsvText("\uFEFFa,b\n1,2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ])
  })

  it("keeps empty fields and does not trim values", () => {
    expect(parseCsvText("a,b,c\n, x ,")).toEqual([
      ["a", "b", "c"],
      ["", " x ", ""],
    ])
  })

  it("returns [] for empty input", () => {
    expect(parseCsvText("")).toEqual([])
  })
})

describe("normalizeCellValue", () => {
  it("maps null/undefined to empty string", () => {
    expect(normalizeCellValue(null)).toBe("")
    expect(normalizeCellValue(undefined)).toBe("")
  })

  it("passes strings through untouched", () => {
    expect(normalizeCellValue(" hello ")).toBe(" hello ")
  })

  it("stringifies numbers, trimming binary float noise", () => {
    expect(normalizeCellValue(42)).toBe("42")
    expect(normalizeCellValue(0.1 + 0.2)).toBe("0.3")
    expect(normalizeCellValue(-1.5)).toBe("-1.5")
  })

  it("renders booleans as TRUE/FALSE (SheetJS display form)", () => {
    expect(normalizeCellValue(true)).toBe("TRUE")
    expect(normalizeCellValue(false)).toBe("FALSE")
  })

  it("renders date-only Dates as YYYY-MM-DD using UTC", () => {
    expect(normalizeCellValue(new Date(Date.UTC(2026, 0, 5)))).toBe(
      "2026-01-05",
    )
  })

  it("appends a time component when present", () => {
    expect(
      normalizeCellValue(new Date(Date.UTC(2026, 0, 5, 14, 30))),
    ).toBe("2026-01-05 14:30")
    expect(
      normalizeCellValue(new Date(Date.UTC(2026, 0, 5, 14, 30, 9))),
    ).toBe("2026-01-05 14:30:09")
  })

  it("joins rich text runs", () => {
    expect(
      normalizeCellValue({
        richText: [{ text: "Hello " }, { text: "world" }],
      }),
    ).toBe("Hello world")
  })

  it("uses display text for hyperlink cells", () => {
    expect(
      normalizeCellValue({ text: "Docs", hyperlink: "https://example.com" }),
    ).toBe("Docs")
  })

  it("uses the cached result for formula cells", () => {
    expect(normalizeCellValue({ formula: "A1+A2", result: 7 })).toBe("7")
    expect(
      normalizeCellValue({ sharedFormula: "A1", result: "text" }),
    ).toBe("text")
    expect(normalizeCellValue({ formula: "A1+A2" })).toBe("")
  })

  it("renders error cells as their error code", () => {
    expect(normalizeCellValue({ error: "#DIV/0!" })).toBe("#DIV/0!")
    expect(
      normalizeCellValue({ formula: "A1/A2", result: { error: "#N/A" } }),
    ).toBe("#N/A")
  })
})

describe("toParsedSheet", () => {
  it("returns empty for an empty grid", () => {
    expect(toParsedSheet([])).toEqual({ headers: [], rows: [] })
  })

  it("trims headers and pads/truncates rows to the header width", () => {
    expect(
      toParsedSheet([
        [" Name ", "Qty"],
        ["a"],
        ["b", "2", "extra"],
      ]),
    ).toEqual({
      headers: ["Name", "Qty"],
      rows: [
        ["a", ""],
        ["b", "2"],
      ],
    })
  })

  it("drops rows whose cells are all blank or whitespace", () => {
    expect(
      toParsedSheet([
        ["h1", "h2"],
        ["", "  "],
        ["x", ""],
        [],
      ]),
    ).toEqual({
      headers: ["h1", "h2"],
      rows: [["x", ""]],
    })
  })
})
