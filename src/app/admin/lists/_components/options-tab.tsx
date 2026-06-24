"use client"

import Link from "next/link"
import { useState, useTransition } from "react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

import { deleteOption, setOptionActive } from "../actions"
import {
  DOMAIN_LIST,
  type DomainConfig,
  type DropdownDomain,
  type FacilityDropdownOptionRow,
} from "../types"

import { OptionForm } from "./option-form"
import { SeedDefaultsCard } from "./seed-defaults-card"

type Props = {
  config: DomainConfig
  rows: FacilityDropdownOptionRow[]
  countsByDomain: Record<DropdownDomain, number>
}

function domainHref(d: DropdownDomain): string {
  const sp = new URLSearchParams()
  sp.set("domain", d)
  return `/admin/lists?${sp.toString()}`
}

export function OptionsTab({ config, rows, countsByDomain }: Props) {
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<FacilityDropdownOptionRow | null>(null)
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [, startTransition] = useTransition()

  function openCreate() {
    setEditing(null)
    setFormOpen(true)
  }

  function openEdit(row: FacilityDropdownOptionRow) {
    setEditing(row)
    setFormOpen(true)
  }

  function runRowAction(
    id: string,
    fn: () => Promise<{ ok: boolean; error?: string }>,
  ) {
    setPendingId(id)
    startTransition(async () => {
      const r = await fn()
      if (!r.ok) toast.error(r.error ?? "Action failed.")
      setPendingId(null)
    })
  }

  const activeCount = rows.filter((r) => r.is_active).length

  return (
    <div className="flex flex-col gap-4">
      {DOMAIN_LIST.length > 1 && (
        <DomainNav active={config.domain} counts={countsByDomain} />
      )}

      <p className="text-muted-foreground text-sm">{config.description}</p>

      {rows.length === 0 ? (
        <>
          <SeedDefaultsCard config={config} />
          <div>
            <Button onClick={openCreate} variant="outline">
              Add {config.singular} manually
            </Button>
          </div>
        </>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-3">
              <Badge variant="secondary">{activeCount} active</Badge>
              <span className="text-muted-foreground text-sm">
                {rows.length} total
              </span>
            </div>
            <Button onClick={openCreate}>Add {config.singular}</Button>
          </div>

          <div className="overflow-auto rounded-md border">
            <table className="w-full border-collapse text-sm">
              <thead className="bg-muted/60 sticky top-0 z-10">
                <tr>
                  <th className="border-b px-3 py-2 text-left font-medium">
                    Display name
                  </th>
                  <th className="border-b px-3 py-2 text-left font-medium">
                    Key
                  </th>
                  <th className="border-b px-3 py-2 text-left font-medium">
                    Order
                  </th>
                  <th className="border-b px-3 py-2 text-left font-medium">
                    Status
                  </th>
                  <th className="border-b px-3 py-2 text-right font-medium">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const isPending = pendingId === row.id
                  return (
                    <tr key={row.id} className="hover:bg-muted/30">
                      <td className="border-b px-3 py-2 align-middle">
                        <div className="flex items-center gap-2">
                          {row.color && (
                            <span
                              aria-hidden
                              className="inline-block size-3 rounded-full"
                              style={{ backgroundColor: row.color }}
                            />
                          )}
                          <span className="font-medium">
                            {row.display_name}
                          </span>
                        </div>
                      </td>
                      <td className="border-b px-3 py-2 align-middle font-mono text-xs">
                        {row.key}
                      </td>
                      <td className="text-muted-foreground border-b px-3 py-2 align-middle tabular-nums">
                        {row.sort_order}
                      </td>
                      <td className="border-b px-3 py-2 align-middle">
                        {row.is_active ? (
                          <Badge variant="success">Active</Badge>
                        ) : (
                          <Badge variant="secondary">Inactive</Badge>
                        )}
                      </td>
                      <td className="border-b px-3 py-2 align-middle">
                        <div className="flex items-center justify-end gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => openEdit(row)}
                            disabled={isPending}
                          >
                            Edit
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              runRowAction(row.id, () =>
                                setOptionActive(
                                  row.id,
                                  config.domain,
                                  !row.is_active,
                                ),
                              )
                            }
                            disabled={isPending}
                          >
                            {row.is_active ? "Deactivate" : "Reactivate"}
                          </Button>
                          <Button
                            type="button"
                            variant="destructive"
                            size="sm"
                            onClick={() => {
                              if (
                                window.confirm(
                                  `Delete "${row.display_name}"? This cannot be undone.`,
                                )
                              ) {
                                runRowAction(row.id, () =>
                                  deleteOption(row.id, config.domain),
                                )
                              }
                            }}
                            disabled={isPending}
                          >
                            Delete
                          </Button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      <OptionForm
        open={formOpen}
        onOpenChange={setFormOpen}
        config={config}
        editing={editing}
      />
    </div>
  )
}

function DomainNav({
  active,
  counts,
}: {
  active: DropdownDomain
  counts: Record<DropdownDomain, number>
}) {
  return (
    <nav className="flex flex-wrap items-center gap-1 rounded-md border p-1">
      {DOMAIN_LIST.map((d) => (
        <Link
          key={d.domain}
          href={domainHref(d.domain)}
          className={cn(
            "rounded px-3 py-1.5 text-sm font-medium transition-colors",
            active === d.domain
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
          )}
        >
          {d.label}
          <span
            className={cn(
              "ml-1.5 inline-flex items-center justify-center rounded-full px-1.5 py-0.5 text-[10px] font-medium tabular-nums",
              active === d.domain
                ? "bg-primary-foreground/20 text-primary-foreground"
                : "bg-muted text-muted-foreground",
            )}
          >
            {counts[d.domain] ?? 0}
          </span>
        </Link>
      ))}
    </nav>
  )
}
