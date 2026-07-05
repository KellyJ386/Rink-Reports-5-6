import { describe, expect, it } from "vitest"

import { zipToTimezone } from "./zip-timezone"

describe("zipToTimezone", () => {
  it("resolves major-market zips to their zones", () => {
    expect(zipToTimezone("13210")).toBe("America/New_York") // Syracuse NY
    expect(zipToTimezone("60601")).toBe("America/Chicago") // Chicago IL
    expect(zipToTimezone("80202")).toBe("America/Denver") // Denver CO
    expect(zipToTimezone("85001")).toBe("America/Phoenix") // Phoenix AZ
    expect(zipToTimezone("90210")).toBe("America/Los_Angeles") // LA CA
    expect(zipToTimezone("48201")).toBe("America/Detroit") // Detroit MI
    expect(zipToTimezone("99501")).toBe("America/Anchorage") // Anchorage AK
    expect(zipToTimezone("96813")).toBe("Pacific/Honolulu") // Honolulu HI
    expect(zipToTimezone("00901")).toBe("America/Puerto_Rico") // San Juan PR
  })

  it("handles the classic split-state boundaries", () => {
    // Tennessee: Nashville Central, Knoxville Eastern.
    expect(zipToTimezone("37201")).toBe("America/Chicago")
    expect(zipToTimezone("37902")).toBe("America/New_York")
    // Florida panhandle Central, peninsula Eastern.
    expect(zipToTimezone("32501")).toBe("America/Chicago") // Pensacola
    expect(zipToTimezone("33101")).toBe("America/New_York") // Miami
    // Indiana: Indy Eastern, Gary + Evansville Central, Terre Haute Eastern.
    expect(zipToTimezone("46204")).toBe("America/New_York")
    expect(zipToTimezone("46402")).toBe("America/Chicago")
    expect(zipToTimezone("47708")).toBe("America/Chicago")
    expect(zipToTimezone("47801")).toBe("America/New_York")
    // Kentucky: Louisville Eastern, Paducah Central.
    expect(zipToTimezone("40202")).toBe("America/New_York")
    expect(zipToTimezone("42001")).toBe("America/Chicago")
    // Texas: Dallas Central, El Paso Mountain.
    expect(zipToTimezone("75201")).toBe("America/Chicago")
    expect(zipToTimezone("79901")).toBe("America/Denver")
    // South Dakota: Sioux Falls Central, Rapid City Mountain.
    expect(zipToTimezone("57101")).toBe("America/Chicago")
    expect(zipToTimezone("57701")).toBe("America/Denver")
    // Idaho: Boise Mountain, Coeur d'Alene Pacific.
    expect(zipToTimezone("83702")).toBe("America/Denver")
    expect(zipToTimezone("83814")).toBe("America/Los_Angeles")
  })

  it("applies the 5-digit exceptions (western UP Michigan is Central)", () => {
    expect(zipToTimezone("49801")).toBe("America/Chicago") // Iron Mountain
    expect(zipToTimezone("49855")).toBe("America/Detroit") // Marquette
  })

  it("accepts ZIP+4 and surrounding whitespace", () => {
    expect(zipToTimezone(" 13210-1234 ")).toBe("America/New_York")
  })

  it("returns null for non-US or unresolvable input", () => {
    expect(zipToTimezone("")).toBeNull()
    expect(zipToTimezone(null)).toBeNull()
    expect(zipToTimezone("K1A 0B1")).toBeNull() // Canadian postal code
    expect(zipToTimezone("1234")).toBeNull()
    expect(zipToTimezone("96201")).toBeNull() // military APO range
  })
})
