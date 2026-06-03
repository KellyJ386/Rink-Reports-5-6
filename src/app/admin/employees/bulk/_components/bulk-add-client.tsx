"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useMemo, useState, useTransition } from "react"
import { ClipboardPaste, Plus, Trash2, X } from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"

import type { RoleRow } from "../../types"
import { bulkCreateEmployees } from "../actions"
import {
  buildBatchEmailCounts,
  isRowBlank,
  parsePastedRows,
  validateRows,
} from "../_lib/validation"
import { useBulkStore } from "../_lib/store"
import type { BulkEmployeeInput, BulkRow, RowErrors } from "../types"

type Props = {
  facilityId: string
  roles: RoleRow[]
  /** Lowercased emails already in use in this facility. */
  existingEmails: string[]
}

export function BulkAddClient({ facilityId, roles, existingEmails }: Props) {
  const router = useRouter()
  const rows = useBulkStore((s) => s.rows)
  const results = useBulkStore((s) => s.results)
  const addRow = useBulkStore((s) => s.addRow)
  const appendRows = useBulkStore((s) => s.appendRows)
  const updateCell = useBulkStore((s) => s.updateCell)
  const removeRow = useBulkStore((s) => s.removeRow)
  const clear = useBulkStore((s) => s.clear)
  const removeSucceeded = useBulkStore((s) => s.removeSucceeded)
  const setResults = useBulkStore((s) => s.setResults)

  const [sendInvites, setSendInvites] = useState(true)
  const [showErrors, setShowErrors] = useState(false)
  const [pasteOpen, setPasteOpen] = useState(false)
  const [pending, startTransition] = useTransition()

  const roleIds = useMemo(() => new Set(roles.map((r) => r.id)), [roles])
  const existingSet = useMemo(
    () => new Set(existingEmails.map((e) => e.toLowerCase())),
    [existingEmails]
  )

  const errorsById = useMemo(() => {
    const batchEmailCounts = buildBatchEmailCounts(rows)
    return validateRows(rows, {
      roleIds,
      existingEmails: existingSet,
      batchEmailCounts,
    })
  }, [rows, roleIds, existingSet])

  const filledCount = rows.filter((r) => !isRowBlank(r)).length
  const invalidCount = errorsById.size
  const succeededCount = Object.values(results).filter((r) => r.ok).length

  function handleSubmit() {
    setShowErrors(true)

    const nonBlank = rows.filter((r) => !isRowBlank(r))
    if (nonBlank.length === 0) {
      toast.error("Add at least one employee.")
      return
    }
    if (invalidCount > 0) {
      toast.error(
        `Fix ${invalidCount} row${invalidCount === 1 ? "" : "s"} with errors before submitting.`
      )
      return
    }

    // Snapshot the ordered ids we send so we can map results back by index.
    const orderedIds = nonBlank.map((r) => r.id)
    const payload: BulkEmployeeInput[] = nonBlank.map((r) => ({
      firstName: r.firstName,
      lastName: r.lastName,
      email: r.email,
      hireDate: r.hireDate,
      roleId: r.roleId,
    }))

    startTransition(async () => {
      const res = await bulkCreateEmployees({
        facilityId,
        sendInvites,
        rows: payload,
      })

      if (!res.ok) {
        toast.error(res.error)
        return
      }

      const byId: Record<string, (typeof res.results)[number]> = {}
      for (const r of res.results) {
        const id = orderedIds[r.index]
        if (id) byId[id] = r
      }
      setResults(byId)

      const ok = res.results.filter((r) => r.ok).length
      const failed = res.results.length - ok
      if (failed === 0) {
        toast.success(`Added ${ok} employee${ok === 1 ? "" : "s"}.`)
      } else {
        toast.warning(`Added ${ok}, ${failed} failed. Review the rows below.`)
      }
      router.refresh()
    })
  }

  function handlePaste(text: string) {
    const parsed = parsePastedRows(text, roles)
    if (parsed.length === 0) {
      toast.error("Nothing to import — paste rows first.")
      return
    }
    appendRows(parsed)
    setPasteOpen(false)
    setShowErrors(true)
    toast.success(
      `Imported ${parsed.length} row${parsed.length === 1 ? "" : "s"}.`
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={addRow}>
            <Plus className="size-4" /> Add row
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setPasteOpen(true)}
          >
            <ClipboardPaste className="size-4" /> Paste from spreadsheet
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={clear}>
            <Trash2 className="size-4" /> Clear all
          </Button>
        </div>
        <div className="text-muted-foreground flex items-center gap-2 text-sm">
          <span>
            {filledCount} to add
            {showErrors && invalidCount > 0 && (
              <span className="text-destructive"> · {invalidCount} with errors</span>
            )}
          </span>
        </div>
      </div>

      <div className="overflow-auto rounded-md border">
        <table className="w-full border-collapse text-sm">
          <thead className="bg-muted/60 sticky top-0 z-10">
            <tr>
              <th className="border-b px-3 py-2 text-left font-medium">First name</th>
              <th className="border-b px-3 py-2 text-left font-medium">Last name</th>
              <th className="border-b px-3 py-2 text-left font-medium">Email</th>
              <th className="border-b px-3 py-2 text-left font-medium">Hire date</th>
              <th className="border-b px-3 py-2 text-left font-medium">Role</th>
              <th className="border-b px-3 py-2 text-left font-medium">Status</th>
              <th className="border-b px-3 py-2 text-right font-medium" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <GridRow
                key={row.id}
                row={row}
                roles={roles}
                errors={showErrors ? errorsById.get(row.id) : undefined}
                result={results[row.id]}
                disabled={pending}
                onChange={(field, value) => updateCell(row.id, field, value)}
                onRemove={() => removeRow(row.id)}
              />
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-4 rounded-md border p-4">
        <label className="flex items-start gap-3 text-sm">
          <Switch
            checked={sendInvites}
            onCheckedChange={setSendInvites}
            aria-label="Send login invites and apply role permissions"
          />
          <span>
            Send login invites &amp; apply role permissions
            <span className="text-muted-foreground block text-xs font-normal">
              Each employee gets an email invite; the role&apos;s pre-configured
              permission set is applied automatically. Uncheck to create
              schedule-only records (no login).
            </span>
          </span>
        </label>

        <div className="flex items-center gap-2">
          {succeededCount > 0 && (
            <Button
              type="button"
              variant="outline"
              onClick={removeSucceeded}
              disabled={pending}
            >
              Clear {succeededCount} added
            </Button>
          )}
          <Button type="button" onClick={handleSubmit} disabled={pending}>
            {pending
              ? "Adding…"
              : `Add ${filledCount} employee${filledCount === 1 ? "" : "s"}`}
          </Button>
        </div>
      </div>

      <p className="text-muted-foreground text-xs">
        Need departments, emergency contacts, or an employee code?{" "}
        <Link href="/admin/employees" className="underline">
          Use the single-employee form
        </Link>{" "}
        — or add those details per person after import.
      </p>

      <PasteSheet
        open={pasteOpen}
        onOpenChange={setPasteOpen}
        onImport={handlePaste}
      />
    </div>
  )
}

type GridRowProps = {
  row: BulkRow
  roles: RoleRow[]
  errors: RowErrors | undefined
  result: { ok: boolean; error?: string; warning?: string } | undefined
  disabled: boolean
  onChange: (field: Exclude<keyof BulkRow, "id">, value: string) => void
  onRemove: () => void
}

function GridRow({
  row,
  roles,
  errors,
  result,
  disabled,
  onChange,
  onRemove,
}: GridRowProps) {
  const rowState = result?.ok
    ? "ok"
    : result && !result.ok
      ? "failed"
      : undefined

  return (
    <tr
      className={cn(
        "align-top hover:bg-muted/30",
        rowState === "ok" && "bg-success/5",
        rowState === "failed" && "bg-destructive/5"
      )}
    >
      <Cell>
        <CellInput
          value={row.firstName}
          placeholder="First"
          error={errors?.firstName}
          disabled={disabled}
          onChange={(v) => onChange("firstName", v)}
        />
      </Cell>
      <Cell>
        <CellInput
          value={row.lastName}
          placeholder="Last"
          error={errors?.lastName}
          disabled={disabled}
          onChange={(v) => onChange("lastName", v)}
        />
      </Cell>
      <Cell>
        <CellInput
          value={row.email}
          type="email"
          placeholder="name@example.com"
          error={errors?.email}
          disabled={disabled}
          onChange={(v) => onChange("email", v)}
        />
      </Cell>
      <Cell>
        <CellInput
          value={row.hireDate}
          type="date"
          error={errors?.hireDate}
          disabled={disabled}
          onChange={(v) => onChange("hireDate", v)}
        />
      </Cell>
      <Cell>
        <Select
          value={row.roleId || undefined}
          onValueChange={(v) => onChange("roleId", v)}
          disabled={disabled}
        >
          <SelectTrigger
            className={cn("h-9", errors?.roleId && "border-destructive")}
            aria-invalid={errors?.roleId ? "true" : undefined}
          >
            <SelectValue placeholder="Role…" />
          </SelectTrigger>
          <SelectContent>
            {roles.map((r) => (
              <SelectItem key={r.id} value={r.id}>
                {r.display_name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {errors?.roleId && (
          <p className="text-destructive mt-1 text-xs">{errors.roleId}</p>
        )}
      </Cell>
      <Cell>
        <RowStatus result={result} />
      </Cell>
      <Cell className="text-right">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={onRemove}
          disabled={disabled}
          aria-label="Remove row"
          className="size-8"
        >
          <X className="size-4" />
        </Button>
      </Cell>
    </tr>
  )
}

function Cell({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <td className={cn("border-b px-2 py-2", className)}>{children}</td>
  )
}

function CellInput({
  value,
  onChange,
  error,
  placeholder,
  type = "text",
  disabled,
}: {
  value: string
  onChange: (v: string) => void
  error?: string
  placeholder?: string
  type?: string
  disabled?: boolean
}) {
  return (
    <div className="min-w-[8rem]">
      <Input
        value={value}
        type={type}
        placeholder={placeholder}
        disabled={disabled}
        aria-invalid={error ? "true" : undefined}
        onChange={(e) => onChange(e.target.value)}
        className={cn("h-9", error && "border-destructive")}
      />
      {error && <p className="text-destructive mt-1 text-xs">{error}</p>}
    </div>
  )
}

function RowStatus({
  result,
}: {
  result: { ok: boolean; error?: string; warning?: string } | undefined
}) {
  if (!result) return <span className="text-muted-foreground text-xs">—</span>
  if (!result.ok) {
    return (
      <span className="text-destructive text-xs" title={result.error}>
        {result.error ?? "Failed"}
      </span>
    )
  }
  if (result.warning) {
    return (
      <span className="flex flex-col gap-0.5">
        <Badge variant="secondary">Added</Badge>
        <span className="text-muted-foreground text-xs" title={result.warning}>
          {result.warning}
        </span>
      </span>
    )
  }
  return <Badge variant="success">Added</Badge>
}

function PasteSheet({
  open,
  onOpenChange,
  onImport,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onImport: (text: string) => void
}) {
  const [text, setText] = useState("")
  return (
    <Sheet
      open={open}
      onOpenChange={(o) => {
        if (!o) setText("")
        onOpenChange(o)
      }}
    >
      <SheetContent side="right" className="w-full max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Paste from a spreadsheet</SheetTitle>
          <SheetDescription>
            One employee per line. Columns, in order:{" "}
            <strong>First name, Last name, Email, Hire date, Role</strong>.
            Tab- or comma-separated. Hire date accepts{" "}
            <code>YYYY-MM-DD</code> or <code>M/D/YYYY</code>. Role matches the
            role name (e.g. &ldquo;Staff&rdquo;).
          </SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-4 px-4 pb-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="paste-area">Rows</Label>
            <Textarea
              id="paste-area"
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={12}
              placeholder={
                "Jane\tDoe\tjane@example.com\t2026-01-15\tStaff\nJohn\tSmith\tjohn@example.com\t2026-02-01\tSupervisor"
              }
              className="font-mono text-xs"
            />
          </div>
          <div className="flex items-center justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="button" onClick={() => onImport(text)}>
              Import rows
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}
