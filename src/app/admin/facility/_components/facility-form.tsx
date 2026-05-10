"use client"

import { useRouter } from "next/navigation"
import { useState, useTransition } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

import { createFacility, updateFacility } from "../actions"
import {
  DEFAULT_TIMEZONE,
  SLUG_PATTERN,
  TIMEZONE_OPTIONS,
  type FacilityRow,
} from "../types"

type Mode = "create" | "edit"

type Props = {
  mode: Mode
  initial?: FacilityRow
  onClose?: () => void
}

function suggestSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
}

export function FacilityForm({ mode, initial, onClose }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const [name, setName] = useState(initial?.name ?? "")
  const [slug, setSlug] = useState(initial?.slug ?? "")
  const [slugDirty, setSlugDirty] = useState(mode === "edit")
  const [timezone, setTimezone] = useState(
    initial?.timezone ?? DEFAULT_TIMEZONE
  )
  const [isActive, setIsActive] = useState(initial?.is_active ?? true)
  const [address, setAddress] = useState(initial?.address ?? "")
  const [zipCode, setZipCode] = useState(initial?.zip_code ?? "")
  const [phone, setPhone] = useState(initial?.phone ?? "")
  const [error, setError] = useState<string | null>(null)

  function handleNameChange(value: string) {
    setName(value)
    if (!slugDirty) {
      setSlug(suggestSlug(value))
    }
  }

  function handleSlugChange(value: string) {
    setSlug(value)
    setSlugDirty(true)
  }

  function clientValidate(): string | null {
    if (name.trim().length < 2) return "Name must be at least 2 characters."
    if (!slug.trim()) return "Slug is required."
    if (!SLUG_PATTERN.test(slug.trim())) {
      return "Slug must be lowercase letters, numbers, and hyphens (e.g. max-ice-center)."
    }
    return null
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    const validationError = clientValidate()
    if (validationError) {
      setError(validationError)
      return
    }

    startTransition(async () => {
      if (mode === "create") {
        const res = await createFacility({
          name,
          slug,
          timezone,
          address: address || null,
          zip_code: zipCode || null,
          phone: phone || null,
        })
        if (!res.ok) {
          setError(res.error)
          return
        }
        onClose?.()
        router.refresh()
      } else if (initial) {
        const res = await updateFacility(initial.id, {
          name,
          slug,
          timezone,
          is_active: isActive,
          address: address || null,
          zip_code: zipCode || null,
          phone: phone || null,
        })
        if (!res.ok) {
          setError(res.error)
          return
        }
        onClose?.()
        router.refresh()
      }
    })
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
      <div className="flex flex-col gap-2">
        <Label htmlFor="facility-name">Name</Label>
        <Input
          id="facility-name"
          name="name"
          value={name}
          onChange={(e) => handleNameChange(e.target.value)}
          placeholder="Max Ice Center"
          autoFocus
          required
          disabled={isPending}
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="facility-slug">Slug</Label>
        <Input
          id="facility-slug"
          name="slug"
          value={slug}
          onChange={(e) => handleSlugChange(e.target.value)}
          placeholder="max-ice-center"
          required
          disabled={isPending}
          aria-describedby="facility-slug-help"
        />
        <p
          id="facility-slug-help"
          className="text-muted-foreground text-xs"
        >
          Lowercase letters, numbers, and hyphens. Used in URLs and must be
          unique.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="facility-timezone">Timezone</Label>
        <select
          id="facility-timezone"
          name="timezone"
          value={timezone}
          onChange={(e) => setTimezone(e.target.value)}
          disabled={isPending}
          className="border-input bg-background focus-visible:border-ring focus-visible:ring-ring/50 flex h-9 w-full rounded-md border px-3 py-1 text-sm shadow-xs outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {TIMEZONE_OPTIONS.map((tz) => (
            <option key={tz} value={tz}>
              {tz}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="facility-address">Address</Label>
        <Input
          id="facility-address"
          name="address"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="123 Main St"
          disabled={isPending}
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="facility-zip">Zip code</Label>
        <Input
          id="facility-zip"
          name="zip_code"
          value={zipCode}
          onChange={(e) => setZipCode(e.target.value)}
          placeholder="12345"
          disabled={isPending}
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="facility-phone">Phone number</Label>
        <Input
          id="facility-phone"
          name="phone"
          type="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="(555) 555-5555"
          disabled={isPending}
        />
      </div>

      {mode === "edit" && (
        <div className="flex items-center gap-3 rounded-md border p-3">
          <input
            id="facility-active"
            type="checkbox"
            checked={isActive}
            onChange={(e) => setIsActive(e.target.checked)}
            disabled={isPending}
            className="size-4 rounded border-input"
          />
          <div className="flex flex-col">
            <Label htmlFor="facility-active">Active</Label>
            <span className="text-muted-foreground text-xs">
              Inactive facilities are hidden from most views.
            </span>
          </div>
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="border-destructive/40 bg-destructive/10 text-destructive rounded-md border px-3 py-2 text-sm"
        >
          {error}
        </div>
      )}

      <div className="flex items-center justify-end gap-2 pt-2">
        {onClose && (
          <Button
            type="button"
            variant="ghost"
            onClick={onClose}
            disabled={isPending}
          >
            Cancel
          </Button>
        )}
        <Button type="submit" disabled={isPending}>
          {isPending
            ? mode === "create"
              ? "Creating..."
              : "Saving..."
            : mode === "create"
              ? "Create facility"
              : "Save changes"}
        </Button>
      </div>
    </form>
  )
}
