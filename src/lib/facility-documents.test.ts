import { describe, expect, it } from "vitest"

import {
  ALLOWED_DOCUMENT_EXTENSIONS,
  FACILITY_DOCUMENT_CATEGORIES,
  documentMimeType,
  facilityDocumentCategoryLabel,
  fileExtension,
  formatFileSize,
  isAllowedDocumentExtension,
  isFacilityDocumentCategory,
  sanitizeFileName,
  titleFromFileName,
} from "./facility-documents"

describe("category guard + label", () => {
  it("accepts every declared category and rejects everything else", () => {
    for (const c of FACILITY_DOCUMENT_CATEGORIES) {
      expect(isFacilityDocumentCategory(c.key)).toBe(true)
      expect(facilityDocumentCategoryLabel(c.key)).toBe(c.label)
    }
    expect(isFacilityDocumentCategory("nonsense")).toBe(false)
    expect(isFacilityDocumentCategory("")).toBe(false)
    // Prototype keys must not slip through the hasOwnProperty guard.
    expect(isFacilityDocumentCategory("toString")).toBe(false)
    expect(isFacilityDocumentCategory("__proto__")).toBe(false)
  })

  it("maps unknown categories to the Other label", () => {
    expect(facilityDocumentCategoryLabel("nonsense")).toBe("Other")
  })
})

describe("fileExtension", () => {
  it("lowercases and takes the last dot segment", () => {
    expect(fileExtension("Report.PDF")).toBe("pdf")
    expect(fileExtension("a.b.docx")).toBe("docx")
  })

  it("returns empty for missing or trailing-dot extensions", () => {
    expect(fileExtension("noext")).toBe("")
    expect(fileExtension("trailing.")).toBe("")
    expect(fileExtension("")).toBe("")
  })
})

describe("isAllowedDocumentExtension", () => {
  it("accepts every allowed extension, case-insensitively", () => {
    for (const ext of ALLOWED_DOCUMENT_EXTENSIONS) {
      expect(isAllowedDocumentExtension(`file.${ext}`)).toBe(true)
      expect(isAllowedDocumentExtension(`file.${ext.toUpperCase()}`)).toBe(true)
    }
  })

  it("rejects executables, scripts, and extension-less names", () => {
    for (const name of ["run.exe", "run.sh", "page.html", "app.js", "x.svg", "noext"]) {
      expect(isAllowedDocumentExtension(name)).toBe(false)
    }
  })

  it("judges only the FINAL extension, so double extensions can't smuggle", () => {
    expect(isAllowedDocumentExtension("invoice.pdf.exe")).toBe(false)
    expect(isAllowedDocumentExtension("script.exe.pdf")).toBe(true) // stored as pdf mime
  })
})

describe("documentMimeType", () => {
  it("derives the canonical type from the extension, never the client's claim", () => {
    expect(documentMimeType("a.pdf")).toBe("application/pdf")
    expect(documentMimeType("a.docx")).toBe(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    )
    expect(documentMimeType("a.JPG")).toBe("image/jpeg")
  })

  it("falls back to opaque octet-stream for anything unknown", () => {
    expect(documentMimeType("a.svg")).toBe("application/octet-stream")
    expect(documentMimeType("a.html")).toBe("application/octet-stream")
    expect(documentMimeType("noext")).toBe("application/octet-stream")
  })
})

describe("sanitizeFileName", () => {
  it("strips path components from both separator styles", () => {
    expect(sanitizeFileName("../../etc/passwd")).toBe("passwd")
    expect(sanitizeFileName("C:\\Users\\kelly\\doc.pdf")).toBe("doc.pdf")
    expect(sanitizeFileName("/absolute/path/file.txt")).toBe("file.txt")
  })

  it("collapses unsafe characters and leading dots/underscores", () => {
    expect(sanitizeFileName("my report (final)!!.pdf")).toBe("my_report_final_.pdf")
    expect(sanitizeFileName("...hidden.pdf")).toBe("hidden.pdf")
    expect(sanitizeFileName("a  b\tc.txt")).toBe("a_b_c.txt")
  })

  it("caps length and never returns an empty segment", () => {
    expect(sanitizeFileName(`${"x".repeat(300)}.pdf`).length).toBeLessThanOrEqual(120)
    expect(sanitizeFileName("///")).toBe("document")
    expect(sanitizeFileName("...")).toBe("document")
    expect(sanitizeFileName("")).toBe("document")
  })
})

describe("titleFromFileName", () => {
  it("derives a readable title from the basename", () => {
    expect(titleFromFileName("emergency_action-plan_v2.pdf")).toBe(
      "emergency action plan v2"
    )
    expect(titleFromFileName("/a/b/Staff Manual.docx")).toBe("Staff Manual")
  })

  it("keeps dotfiles whole and falls back for empty stems", () => {
    // dot at index 0 is not treated as an extension separator
    expect(titleFromFileName(".env")).toBe(".env")
    expect(titleFromFileName("")).toBe("Untitled document")
    expect(titleFromFileName("___.pdf")).toBe("Untitled document")
  })

  it("caps the title at 200 characters", () => {
    expect(titleFromFileName(`${"t".repeat(300)}.pdf`).length).toBeLessThanOrEqual(200)
  })
})

describe("formatFileSize", () => {
  it("formats each magnitude with the module's precision rules", () => {
    expect(formatFileSize(0)).toBe("0 B")
    expect(formatFileSize(1023)).toBe("1023 B")
    expect(formatFileSize(1024)).toBe("1.0 KB")
    expect(formatFileSize(10 * 1024)).toBe("10 KB")
    expect(formatFileSize(1024 * 1024)).toBe("1.0 MB")
    expect(formatFileSize(25 * 1024 * 1024)).toBe("25 MB")
  })

  it("returns empty for null/undefined/negative/non-finite", () => {
    expect(formatFileSize(null)).toBe("")
    expect(formatFileSize(undefined)).toBe("")
    expect(formatFileSize(-1)).toBe("")
    expect(formatFileSize(Number.NaN)).toBe("")
    expect(formatFileSize(Number.POSITIVE_INFINITY)).toBe("")
  })
})
