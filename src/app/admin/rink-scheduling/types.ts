// Local types for the Rink Scheduling & Billing admin module.
// Row types come from the generated Supabase types; composite shapes are
// layered here, following the ice-operations / dasher-boards convention.

import type { Tables } from "@/types/database"

export type RinkRow = Tables<"facility_rinks">
export type LockerRoomRow = Tables<"facility_locker_rooms">
export type OperatingHoursRow = Tables<"facility_operating_hours">
export type HoursExceptionRow = Tables<"facility_operating_hours_exceptions">
export type SettingsRow = Tables<"rink_scheduling_settings">
export type BookingTypeRow = Tables<"rink_booking_types">
export type CustomerTypeRow = Tables<"rink_customer_types">
export type PaymentMethodRow = Tables<"rink_payment_methods">
export type RateCardRow = Tables<"rink_rate_cards">
export type RateCardWindowRow = Tables<"rink_rate_card_windows">
export type RateCardTypeOverrideRow = Tables<"rink_rate_card_type_overrides">
export type DisplayTokenRow = Tables<"rink_display_tokens">

// ---- Tabs ----
//
// Ordered to read top-down as a setup narrative: the facility itself, then how
// it charges, then the lists that fill the pickers, then the screens in the
// lobby, then module-wide switches. "setup" is the landing tab because it is
// the one a brand-new facility must complete before anything else works.

export type Tab = "setup" | "rates" | "lists" | "displays" | "settings"

export const TABS: ReadonlyArray<{ key: Tab; label: string }> = [
  { key: "setup", label: "Facility Setup" },
  { key: "rates", label: "Rate Cards" },
  { key: "lists", label: "Lists" },
  { key: "displays", label: "Displays" },
  { key: "settings", label: "Settings" },
]

export function asTab(value: string | undefined): Tab {
  const allowed = TABS.map((t) => t.key)
  return (allowed as readonly string[]).includes(value ?? "")
    ? (value as Tab)
    : "setup"
}

// ---- Composites ----

export type FacilitySetupData = {
  rinks: RinkRow[]
  lockerRooms: LockerRoomRow[]
  hours: OperatingHoursRow[]
  exceptions: HoursExceptionRow[]
}

export type RateCardWithDetail = RateCardRow & {
  windows: RateCardWindowRow[]
  overrides: RateCardTypeOverrideRow[]
}

/** A token's plaintext exists for exactly one render, immediately after
 *  creation. It is never stored and never re-retrievable — only its sha256
 *  hash reaches the database. */
export type CreatedToken = {
  id: string
  label: string
  url: string
}

// ---- Action plumbing ----

export type ActionState =
  | { ok: true; message?: string }
  | { ok: false; error: string }
  | { ok: null }

export type SimpleResult = { ok: true } | { ok: false; error: string }
