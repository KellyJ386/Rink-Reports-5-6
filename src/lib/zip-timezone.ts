// US zip code → IANA timezone.
//
// The facility's timezone drives every wall-clock conversion in the app
// (scheduling, occurred_at, report displays — see src/lib/timezone.ts), but
// admins shouldn't need to know IANA zone names: the rink's zip code already
// implies its zone. This module derives it so the facility form can fill the
// timezone automatically; the timezone picker remains as a manual override.
//
// Resolution is by 3-digit zip prefix (USPS sectional center), which is exact
// for the overwhelming majority of US zips, plus a small curated 5-digit
// exception list for well-known split areas (e.g. the Central-time counties
// of Michigan's western Upper Peninsula). A few sparsely populated
// border-county zips (far-west Kansas/Nebraska, Oregon's Malheur fringe,
// Navajo Nation, West Wendover NV) can still resolve to the neighboring zone
// — that's what the manual override is for. Non-US postal codes (e.g.
// Canadian) return null and leave the timezone untouched.

const ET = "America/New_York"
const CT = "America/Chicago"
const MT = "America/Denver"
const AZ = "America/Phoenix" // no DST
const PT = "America/Los_Angeles"
const AK = "America/Anchorage"
const HI = "Pacific/Honolulu"
const PR = "America/Puerto_Rico"
const GU = "Pacific/Guam"
const MI = "America/Detroit" // same rules as ET; matches the picker's option

// Inclusive 3-digit-prefix ranges, checked in order. Gaps (military APO/FPO
// prefixes 090-098, 340, 962-966 and unassigned prefixes) resolve to null.
const PREFIX_RANGES: ReadonlyArray<readonly [number, number, string]> = [
  [5, 5, ET], // Holtsville NY (IRS)
  [6, 9, PR], // Puerto Rico / US Virgin Islands
  [10, 69, ET], // MA RI NH ME VT CT
  [70, 89, ET], // NJ
  [100, 149, ET], // NY
  [150, 196, ET], // PA
  [197, 199, ET], // DE
  [200, 219, ET], // DC / MD
  [220, 246, ET], // VA
  [247, 268, ET], // WV
  [270, 289, ET], // NC
  [290, 299, ET], // SC
  [300, 319, ET], // GA
  [320, 323, ET], // FL northeast (Jacksonville, Tallahassee)
  [324, 325, CT], // FL panhandle (Panama City, Pensacola)
  [326, 349, ET], // FL peninsula
  [350, 369, CT], // AL
  [370, 372, CT], // TN — Nashville
  [373, 374, ET], // TN — Chattanooga
  [375, 375, CT], // TN — (Memphis-side allocation)
  [376, 379, ET], // TN — Tri-Cities / Knoxville
  [380, 385, CT], // TN — Memphis / Jackson / Cookeville
  [386, 397, CT], // MS
  [398, 399, ET], // GA (Albany / Atlanta overflow)
  [400, 418, ET], // KY — Louisville / Lexington / eastern KY
  [420, 424, CT], // KY — Paducah / Bowling Green / Owensboro
  [425, 427, ET], // KY — Somerset / Elizabethtown
  [430, 459, ET], // OH
  [460, 462, ET], // IN — Indianapolis
  [463, 464, CT], // IN — Gary / Hammond (NW corner)
  [465, 475, ET], // IN — South Bend / Fort Wayne / Bloomington
  [476, 477, CT], // IN — Evansville (SW corner)
  [478, 479, ET], // IN — Terre Haute / Lafayette
  [480, 499, MI], // MI (western-UP Central zips via ZIP5_EXCEPTIONS)
  [500, 528, CT], // IA
  [530, 549, CT], // WI
  [550, 567, CT], // MN
  [570, 576, CT], // SD east
  [577, 577, MT], // SD — Rapid City / Black Hills
  [580, 585, CT], // ND east
  [586, 586, MT], // ND — Dickinson (SW corner)
  [587, 588, CT], // ND — Williston / Minot
  [590, 599, MT], // MT
  [600, 629, CT], // IL
  [630, 658, CT], // MO
  [660, 679, CT], // KS
  [680, 692, CT], // NE
  [693, 693, MT], // NE — panhandle (Alliance / Scottsbluff)
  [700, 714, CT], // LA
  [716, 729, CT], // AR
  [730, 749, CT], // OK (733 = TX Austin overflow, also Central)
  [750, 797, CT], // TX
  [798, 799, MT], // TX — El Paso
  [800, 816, MT], // CO
  [820, 831, MT], // WY
  [832, 834, MT], // ID — Pocatello / Twin Falls / Idaho Falls
  [835, 835, PT], // ID — Lewiston
  [836, 837, MT], // ID — Boise
  [838, 838, PT], // ID — northern panhandle
  [840, 847, MT], // UT
  [850, 864, AZ], // AZ (Navajo Nation observes DST — override if needed)
  [865, 865, MT], // NM — Gallup
  [870, 884, MT], // NM
  [885, 885, MT], // TX — El Paso overflow
  [889, 898, PT], // NV
  [900, 961, PT], // CA
  [967, 968, HI], // HI
  [969, 969, GU], // Guam / Micronesia
  [970, 978, PT], // OR
  [979, 979, MT], // OR — Ontario / Malheur County
  [980, 994, PT], // WA
  [995, 999, AK], // AK
]

// Well-known 5-digit splits inside an otherwise uniform prefix. Curated, not
// exhaustive — the facility form's timezone picker covers the long tail.
const ZIP5_EXCEPTIONS: Readonly<Record<string, string>> = {
  // Michigan's western Upper Peninsula (Central-time counties).
  "49801": CT, // Iron Mountain
  "49802": CT, // Kingsford
  "49858": CT, // Menominee
  "49938": CT, // Ironwood
  "49947": CT, // Wakefield
  "49968": CT, // Bessemer
}

/**
 * IANA timezone for a US zip code ("13210" or ZIP+4 "13210-1234"), or null
 * when the input isn't a resolvable US zip. Callers should treat null as
 * "leave the timezone alone", never as UTC.
 */
export function zipToTimezone(zip: string | null | undefined): string | null {
  if (!zip) return null
  const m = /^\s*(\d{5})(?:-\d{4})?\s*$/.exec(zip)
  if (!m) return null
  const zip5 = m[1]
  const exception = ZIP5_EXCEPTIONS[zip5]
  if (exception) return exception
  const prefix = Number(zip5.slice(0, 3))
  for (const [lo, hi, tz] of PREFIX_RANGES) {
    if (prefix >= lo && prefix <= hi) return tz
  }
  return null
}
