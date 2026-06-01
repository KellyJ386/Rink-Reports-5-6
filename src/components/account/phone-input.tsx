"use client"

import * as React from "react"
import { AsYouType, parsePhoneNumberFromString } from "libphonenumber-js"

import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  countryOptions,
  detectCountry,
  getCountryCallingCode,
  type CountryCode,
} from "@/lib/account/phone"
import { cn } from "@/lib/utils"

interface PhoneInputProps {
  /** Form field name — the hidden input submits the canonical E.164 value. */
  name: string
  id: string
  /** Stored E.164 value (or empty). */
  defaultValue?: string | null
  defaultCountry?: CountryCode
  invalid?: boolean
  describedBy?: string
  required?: boolean
  /** Notifies the parent form that the value changed (for dirty tracking). */
  onDirty?: () => void
}

function toSubmitValue(national: string, country: CountryCode): string {
  const trimmed = national.trim()
  if (!trimmed) return ""
  const parsed = parsePhoneNumberFromString(trimmed, country)
  if (parsed) return parsed.number
  // Fall back to an explicit +<calling code> form so the server can still
  // parse (and reject) it with the right country context.
  const digits = trimmed.replace(/[^\d]/g, "")
  return digits ? `+${getCountryCallingCode(country)}${digits}` : trimmed
}

export function PhoneInput({
  name,
  id,
  defaultValue,
  defaultCountry = "US",
  invalid,
  describedBy,
  required,
  onDirty,
}: PhoneInputProps) {
  const options = React.useMemo(() => countryOptions(), [])

  const [country, setCountry] = React.useState<CountryCode>(() =>
    detectCountry(defaultValue, defaultCountry),
  )
  const [display, setDisplay] = React.useState<string>(() => {
    if (!defaultValue) return ""
    const parsed = parsePhoneNumberFromString(defaultValue)
    return parsed ? parsed.formatNational() : defaultValue
  })

  const submitValue = toSubmitValue(display, country)

  return (
    <div className="flex gap-2">
      <Select
        value={country}
        onValueChange={(value) => {
          setCountry(value as CountryCode)
          onDirty?.()
        }}
      >
        <SelectTrigger
          aria-label="Country calling code"
          className="w-[7.5rem] shrink-0"
        >
          <SelectValue>
            {country} +{getCountryCallingCode(country)}
          </SelectValue>
        </SelectTrigger>
        <SelectContent className="max-h-72">
          {options.map((opt) => (
            <SelectItem key={opt.code} value={opt.code}>
              {opt.name} (+{opt.callingCode})
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Input
        id={id}
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        aria-required={required || undefined}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        value={display}
        onChange={(e) => {
          setDisplay(new AsYouType(country).input(e.target.value))
          onDirty?.()
        }}
        className={cn("flex-1")}
      />
      <input type="hidden" name={name} value={submitValue} />
    </div>
  )
}
