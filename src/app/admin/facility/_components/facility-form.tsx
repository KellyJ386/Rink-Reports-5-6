"use client"

import { useRouter } from "next/navigation"
import { useState, useTransition } from "react"

import { Button } from "@/components/ui/button"
import { FieldError } from "@/components/ui/field-error"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { RequiredMark } from "@/components/ui/required-mark"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

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
  const [city, setCity] = useState(initial?.city ?? "")
  const [state, setState] = useState(initial?.state ?? "")
  const [zipCode, setZipCode] = useState(initial?.zip_code ?? "")
  const [phone, setPhone] = useState(initial?.phone ?? "")
  const [email, setEmail] = useState(initial?.email ?? "")
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<{
    name?: string
    slug?: string
    email?: string
  }>({})

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

  function clientValidate(): {
    name?: string
    slug?: string
  } {
    const out: { name?: string; slug?: string } = {}
    if (name.trim().length < 2) out.name = "Name must be at least 2 characters."
    if (!slug.trim()) out.slug = "Slug is required."
    else if (!SLUG_PATTERN.test(slug.trim()))
      out.slug =
        "Slug must be lowercase letters, numbers, and hyphens (e.g. max-ice-center)."
    return out
  }

  function applyServerError(res: { error: string; fieldErrors?: typeof fieldErrors }) {
    if (res.fieldErrors && Object.keys(res.fieldErrors).length > 0) {
      setFieldErrors(res.fieldErrors)
      setError(null)
      // Focus first invalid input in visual order so keyboard users
      // don't have to hunt.
      const order: Array<keyof typeof res.fieldErrors> = ["name", "slug", "email"]
      const first = order.find((k) => res.fieldErrors?.[k])
      if (first) {
        document.getElementById(`facility-${first}`)?.focus()
      }
      return
    }
    setError(res.error)
    setFieldErrors({})
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    const clientErrors = clientValidate()
    if (Object.keys(clientErrors).length > 0) {
      setFieldErrors(clientErrors)
      const order: Array<keyof typeof clientErrors> = ["name", "slug"]
      const first = order.find((k) => clientErrors[k])
      if (first) document.getElementById(`facility-${first}`)?.focus()
      return
    }
    setFieldErrors({})

    startTransition(async () => {
      if (mode === "create") {
        const res = await createFacility({
          name,
          slug,
          timezone,
          address: address || null,
          city: city || null,
          state: state || null,
          zip_code: zipCode || null,
          phone: phone || null,
          email: email || null,
        })
        if (!res.ok) {
          applyServerError(res)
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
          city: city || null,
          state: state || null,
          zip_code: zipCode || null,
          phone: phone || null,
          email: email || null,
        })
        if (!res.ok) {
          applyServerError(res)
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
        <Label htmlFor="facility-name">Name<RequiredMark /></Label>
        <Input
          id="facility-name"
          name="name"
          value={name}
          onChange={(e) => handleNameChange(e.target.value)}
          placeholder="Max Ice Center"
          autoFocus
          required
          aria-invalid={fieldErrors.name ? "true" : undefined}
          aria-describedby={fieldErrors.name ? "facility-name-error" : undefined}
          disabled={isPending}
        />
        <FieldError id="facility-name-error" message={fieldErrors.name} />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="facility-slug">Slug<RequiredMark /></Label>
        <Input
          id="facility-slug"
          name="slug"
          value={slug}
          onChange={(e) => handleSlugChange(e.target.value)}
          placeholder="max-ice-center"
          required
          aria-invalid={fieldErrors.slug ? "true" : undefined}
          aria-describedby={
            fieldErrors.slug
              ? "facility-slug-error facility-slug-help"
              : "facility-slug-help"
          }
          disabled={isPending}
        />
        <FieldError id="facility-slug-error" message={fieldErrors.slug} />
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
        <Select
          value={timezone}
          onValueChange={(v) => setTimezone(v)}
          disabled={isPending}
        >
          <SelectTrigger id="facility-timezone">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TIMEZONE_OPTIONS.map((tz) => (
              <SelectItem key={tz} value={tz}>
                {tz}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
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

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="flex flex-col gap-2 sm:col-span-2">
          <Label htmlFor="facility-city">City</Label>
          <Input
            id="facility-city"
            name="city"
            value={city}
            onChange={(e) => setCity(e.target.value)}
            placeholder="Syracuse"
            disabled={isPending}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="facility-state">State</Label>
          <Input
            id="facility-state"
            name="state"
            value={state}
            onChange={(e) => setState(e.target.value)}
            placeholder="NY"
            maxLength={2}
            disabled={isPending}
          />
        </div>
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

      <div className="flex flex-col gap-2">
        <Label htmlFor="facility-email">Email</Label>
        <Input
          id="facility-email"
          name="email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="info@rink.example"
          aria-invalid={fieldErrors.email ? "true" : undefined}
          aria-describedby={
            fieldErrors.email ? "facility-email-error" : undefined
          }
          disabled={isPending}
        />
        <FieldError id="facility-email-error" message={fieldErrors.email} />
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
