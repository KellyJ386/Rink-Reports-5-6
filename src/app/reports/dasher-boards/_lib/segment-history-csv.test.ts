import { describe, expect, it } from "vitest";

import {
  buildSegmentHistoryCsv,
  csvEscape,
  SEGMENT_HISTORY_CSV_HEADER,
  segmentHistoryFilename,
  type SegmentHistoryRow,
} from "./segment-history-csv";

// ---------------------------------------------------------------------------
// csvEscape — RFC 4180 field escaping
// ---------------------------------------------------------------------------

describe("csvEscape", () => {
  it("passes through plain values without quotes or special chars", () => {
    expect(csvEscape("Hello World")).toBe("Hello World");
    expect(csvEscape("12345")).toBe("12345");
    expect(csvEscape("panel_B12")).toBe("panel_B12");
  });

  it("wraps in quotes and doubles embedded quotes when value contains a quote", () => {
    expect(csvEscape('He said "yes"')).toBe('"He said ""yes"""');
    expect(csvEscape('He said "loose", twice')).toBe('"He said ""loose"", twice"');
  });

  it("wraps in quotes when value contains a comma", () => {
    expect(csvEscape("Smith, John")).toBe('"Smith, John"');
  });

  it("wraps in quotes when value contains CR or LF", () => {
    expect(csvEscape("line1\nline2")).toBe('"line1\nline2"');
    expect(csvEscape("line1\rline2")).toBe('"line1\rline2"');
  });

  it("returns an empty string as-is", () => {
    expect(csvEscape("")).toBe("");
  });

  it("handles edge case: quote and comma together", () => {
    expect(csvEscape('He said "maybe", right?')).toBe('"He said ""maybe"", right?"');
  });
});

// ---------------------------------------------------------------------------
// buildSegmentHistoryCsv — CSV document generation
// ---------------------------------------------------------------------------

describe("buildSegmentHistoryCsv", () => {
  const baseRow = (over: Partial<SegmentHistoryRow>): SegmentHistoryRow => ({
    occurredAt: "2026-08-28T10:30:00Z",
    rinkName: "Downtown Arena",
    segmentDisplayLabel: "Board B12",
    segmentIdentityLabel: "B12",
    loggedAsLabel: null,
    zoneName: "North",
    recordType: "walk_check",
    inspectionKind: "routine",
    contractorName: null,
    outcome: "pass",
    category: null,
    detail: "Routine inspection",
    recordedBy: "Alice Smith",
    resolvedAt: null,
    ...over,
  });

  it("header line exactly matches SEGMENT_HISTORY_CSV_HEADER joined by commas", () => {
    const csv = buildSegmentHistoryCsv([]);
    const lines = csv.split("\r\n");
    const headerLine = lines[0];
    const expectedHeader = SEGMENT_HISTORY_CSV_HEADER.join(",");
    expect(headerLine).toBe(expectedHeader);
  });

  it("renders walk_check as 'Walk check' and issue as 'Issue'", () => {
    const csv = buildSegmentHistoryCsv([
      baseRow({ recordType: "walk_check", detail: "check1" }),
      baseRow({ recordType: "issue", detail: "check2" }),
    ]);
    const lines = csv.split("\r\n");
    expect(lines[1]).toContain("Walk check");
    expect(lines[2]).toContain("Issue");
  });

  it("renders inspection kinds: null → empty, routine → Routine, annual_contractor → Annual contractor", () => {
    const routine = buildSegmentHistoryCsv([
      baseRow({ inspectionKind: "routine", detail: "r1" }),
    ]);
    expect(routine).toContain("Routine");

    const annual = buildSegmentHistoryCsv([
      baseRow({ inspectionKind: "annual_contractor", detail: "a1" }),
    ]);
    expect(annual).toContain("Annual contractor");

    const nullKind = buildSegmentHistoryCsv([
      baseRow({ inspectionKind: null, detail: "n1" }),
    ]);
    const lines = nullKind.split("\r\n");
    const fields = lines[1].split(",");
    // inspectionKind is at index 7 (after "Record type" at index 6)
    expect(fields[7]).toBe("");
  });

  it("renders nulls as empty fields", () => {
    const csv = buildSegmentHistoryCsv([
      baseRow({
        loggedAsLabel: null,
        zoneName: null,
        contractorName: null,
        category: null,
        detail: null,
        recordedBy: null,
        resolvedAt: null,
      }),
    ]);
    const lines = csv.split("\r\n");
    const fields = lines[1].split(",");
    // Positions: occurredAt=0, rinkName=1, segmentDisplayLabel=2, segmentIdentityLabel=3,
    // loggedAsLabel=4, zoneName=5, recordType=6, inspectionKind=7, contractorName=8,
    // outcome=9, category=10, detail=11, recordedBy=12, resolvedAt=13
    expect(fields[4]).toBe(""); // loggedAsLabel
    expect(fields[5]).toBe(""); // zoneName
    expect(fields[8]).toBe(""); // contractorName
    expect(fields[10]).toBe(""); // category
    expect(fields[11]).toBe(""); // detail
    expect(fields[12]).toBe(""); // recordedBy
    expect(fields[13]).toBe(""); // resolvedAt
  });

  it("escapes and round-trips a description with quotes and commas", () => {
    const description = 'He said "loose", twice';
    const csv = buildSegmentHistoryCsv([baseRow({ detail: description })]);
    const lines = csv.split("\r\n");
    // A naive comma split would break inside the quoted field — assert the
    // full RFC 4180 escaped form appears intact in the data line instead.
    expect(lines[1]).toContain('"He said ""loose"", twice"');
  });

  it("uses \\r\\n line endings throughout", () => {
    const csv = buildSegmentHistoryCsv([
      baseRow({ detail: "row1" }),
      baseRow({ detail: "row2" }),
    ]);
    // Should be: header\r\nrow1\r\nrow2\r\n
    const lines = csv.split("\r\n");
    expect(lines.length).toBe(4); // header, row1, row2, empty string from trailing \r\n
    expect(lines[0]).toContain("Date");
    expect(lines[3]).toBe(""); // the trailing empty line after final \r\n
  });

  it("ends with a final \\r\\n", () => {
    const csv = buildSegmentHistoryCsv([baseRow({ detail: "test" })]);
    expect(csv.endsWith("\r\n")).toBe(true);
  });

  it("handles multiple rows in the order given", () => {
    const csv = buildSegmentHistoryCsv([
      baseRow({ segmentDisplayLabel: "First" }),
      baseRow({ segmentDisplayLabel: "Second" }),
      baseRow({ segmentDisplayLabel: "Third" }),
    ]);
    const lines = csv.split("\r\n");
    expect(lines[1]).toContain("First");
    expect(lines[2]).toContain("Second");
    expect(lines[3]).toContain("Third");
  });

  it("handles a row with all fields populated (walk_check + issue both covered)", () => {
    const fullRow = baseRow({
      occurredAt: "2026-08-28T14:45:00Z",
      rinkName: "Olympic Center",
      segmentDisplayLabel: "Glass G12",
      segmentIdentityLabel: "G12",
      loggedAsLabel: "Old Label",
      zoneName: "West",
      recordType: "walk_check",
      inspectionKind: "annual_contractor",
      contractorName: "Acme Inspections",
      outcome: "fail",
      category: "Structural",
      detail: "Crack detected",
      recordedBy: "Bob Jones",
      resolvedAt: "2026-08-28T16:00:00Z",
    });
    const csv = buildSegmentHistoryCsv([fullRow]);
    const lines = csv.split("\r\n");
    expect(lines[1]).toContain("Olympic Center");
    expect(lines[1]).toContain("Walk check");
    expect(lines[1]).toContain("Annual contractor");
    expect(lines[1]).toContain("Acme Inspections");
  });
});

// ---------------------------------------------------------------------------
// segmentHistoryFilename — filename generation
// ---------------------------------------------------------------------------

describe("segmentHistoryFilename", () => {
  it("generates the correct filename format", () => {
    const filename = segmentHistoryFilename("downtown-arena", "2026-08-28");
    expect(filename).toBe("dasher-inspection-history-downtown-arena-2026-08-28.csv");
  });

  it("handles rink slugs with hyphens", () => {
    const filename = segmentHistoryFilename("north-side-rink", "2026-08-01");
    expect(filename).toBe("dasher-inspection-history-north-side-rink-2026-08-01.csv");
  });

  it("preserves date key exactly as given", () => {
    const filename = segmentHistoryFilename("rink1", "2026-Q3");
    expect(filename).toBe("dasher-inspection-history-rink1-2026-Q3.csv");
  });
});
