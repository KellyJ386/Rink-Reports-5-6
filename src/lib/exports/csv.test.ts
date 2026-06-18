import { describe, expect, it } from "vitest"

import { buildCsv } from "./csv"
import type { ExportTable } from "./types"

const BOM = "﻿"

function table(headers: string[], rows: string[][]): ExportTable {
  return { module: "daily_reports", title: "Daily", headers, rows }
}

function text(t: ExportTable, d: "comma" | "tab" | "semicolon" = "comma") {
  return buildCsv(t, d).toString("utf-8")
}

describe("buildCsv", () => {
  it("prepends a UTF-8 BOM and CRLF-terminates every row", () => {
    const out = text(table(["a", "b"], [["c", "d"]]))
    expect(out).toBe(`${BOM}a,b\r\nc,d\r\n`)
  })

  it("emits a header-only file (with trailing CRLF) when there are no rows", () => {
    expect(text(table(["a", "b"], []))).toBe(`${BOM}a,b\r\n`)
  })

  it("quotes cells containing the delimiter", () => {
    const out = text(table(["x"], [["a,b"]]))
    expect(out).toBe(`${BOM}x\r\n"a,b"\r\n`)
  })

  it("does NOT quote a comma when the delimiter is a tab", () => {
    const out = text(table(["x"], [["a,b"]]), "tab")
    expect(out).toBe(`${BOM}x\r\na,b\r\n`)
  })

  it("quotes cells containing a tab when the delimiter is a tab", () => {
    const out = text(table(["x"], [["a\tb"]]), "tab")
    expect(out).toBe(`${BOM}x\r\n"a\tb"\r\n`)
  })

  it("doubles embedded quotes and wraps the cell", () => {
    const out = text(table(["x"], [['he said "hi"']]))
    expect(out).toBe(`${BOM}x\r\n"he said ""hi"""\r\n`)
  })

  it("quotes cells containing newlines or carriage returns", () => {
    expect(text(table(["x"], [["line1\nline2"]]))).toBe(
      `${BOM}x\r\n"line1\nline2"\r\n`,
    )
    expect(text(table(["x"], [["a\rb"]]))).toBe(`${BOM}x\r\n"a\rb"\r\n`)
  })

  it("renders a null/missing cell as an empty field", () => {
    // rows are typed string[][] but data can carry holes; coerce to exercise
    // the `c ?? ""` guard.
    const t = table(["a", "b"], [[null as unknown as string, "v"]])
    expect(text(t)).toBe(`${BOM}a,b\r\n,v\r\n`)
  })

  it("honors the semicolon delimiter", () => {
    const out = text(table(["a", "b"], [["1", "2"]]), "semicolon")
    expect(out).toBe(`${BOM}a;b\r\n1;2\r\n`)
  })

  it("does not quote a value that merely contains the non-active delimiter", () => {
    // A semicolon in the data is fine under a comma delimiter — no quoting.
    const out = text(table(["x"], [["a;b"]]), "comma")
    expect(out).toBe(`${BOM}x\r\na;b\r\n`)
  })
})
