# Bulk upload (CSV / XLSX)

One shared, schema-driven importer for every admin checklist builder. Each
builder gets the same UX: download a template, fill it, drop the file, preview
per-row validation, then commit. There is exactly one component and one parsing
stack — do not fork per-surface importers.

- `<BulkUploadPanel schema={...} />` — `bulk-upload-panel.tsx`. Renders the
  trigger button, file picker + drop zone, template downloads, the preview
  table (row #, parsed values, ok/error + inline messages, valid/error counts),
  and the confirm action.
- `parse.ts` — reads `.xlsx` with exceljs and `.csv` with the small RFC 4180
  parser in `parse-core.ts` into header + rows (cells normalized to strings).
  Legacy `.xls` (BIFF) is not supported — exceljs only reads OOXML.
- `validate.ts` — case-insensitive/trimmed header mapping (reports unknown and
  missing-required headers), per-`ColumnDef` coercion, then `zodRow` validation.
- `template.ts` — generates the `.xlsx` (header + example row + an
  Instructions sheet) and `.csv` template from the same `columns`.
- `types.ts` — the `ColumnDef` / `ImportSchema` contract.

Facility scoping is **server-side only**: the `onImport` server action derives
`facility_id` from the authenticated profile and re-validates every row with the
same `zodRow`. The client never sends a facility id.

## How to add a bulk importer to a new checklist surface

1. **Confirm it's a flat list.** Coordinate/structured layouts (ice-depth
   points, refrigeration sections→fields→thresholds) are not tabular and don't
   belong here.

2. **Write a client-safe spec module** (no `"use server"` / `"use client"`),
   e.g. `admin/<surface>/_components/<surface>-import.ts`:

   ```ts
   import { z } from "zod"
   import type { ImportSpec } from "@/components/admin/bulk-upload"

   export const mySurfaceImportSpec: ImportSpec = {
     surfaceId: "my-surface",          // used in template filenames
     mode: "strict",                    // "strict" blocks on any row error
     columns: [
       { key: "label", header: "Label", required: true, type: "string",
         example: "Inspect the thing", description: "Shown to staff." },
       // type: "string" | "number" | "boolean" | "enum"
       // enums: add enumValues; optional columns: add default + required: false
     ],
     zodRow: z.object({
       label: z.string({ error: "Label is required" }).trim().min(1).max(200),
     }),
     // cross-field rules go in a .transform()/.refine() on the object
   }
   ```

   The same module is imported by both the client panel (preview) and the
   server action (re-validation), so the rules live in one place.

3. **Write the server action** in the surface's `actions.ts`:

   ```ts
   import type { ImportResult, ValidatedRow } from "@/components/admin/bulk-upload"
   import { mySurfaceImportSpec } from "./_components/my-surface-import"

   export async function importMySurface(
     contextId: string,            // e.g. a template id, if the surface is nested
     rows: ValidatedRow[],
   ): Promise<ImportResult> {
     await requireAdmin()
     const facility = await resolveFacility()
     if (!facility.ok) return { ok: false, error: facility.error }
     // re-validate each row with mySurfaceImportSpec.zodRow.safeParse(r.values)
     // verify any context id belongs to facility, compute sort_order, insert
     // with facility_id: facility.facilityId
     return { ok: true, inserted: rows.length }
   }
   ```

4. **Drop the panel into the builder** (a client component), binding the action
   and any contextual id:

   ```tsx
   import { BulkUploadPanel, type ImportSchema } from "@/components/admin/bulk-upload"
   import { mySurfaceImportSpec } from "./my-surface-import"
   import { importMySurface } from "../actions"

   const schema: ImportSchema = useMemo(() => ({
     ...mySurfaceImportSpec,
     onImport: (rows) => importMySurface(contextId, rows),
   }), [contextId])

   <BulkUploadPanel schema={schema} onImported={() => router.refresh()} />
   ```

   Keep the single-item add form intact alongside it.

Reference implementations: Daily Reports checklist items
(`admin/daily-reports`), Circle Check items and Circle Check template fields
(`admin/ice-operations`).
