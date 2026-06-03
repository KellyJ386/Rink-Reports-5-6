/**
 * Pick a readable foreground color (near-black or white) for text/icons placed
 * on a solid background `hex`. Accepts "#rgb" or "#rrggbb". Uses the WCAG
 * relative-luminance threshold so light fills (lime, gold, amber) get dark text
 * and dark/saturated fills (indigo, red, navy) get white text.
 */
export function readableForeground(hex: string): string {
  const rgb = hexToRgb(hex)
  if (!rgb) return "#ffffff"
  const toLinear = (c: number) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  }
  const luminance =
    0.2126 * toLinear(rgb.r) +
    0.7152 * toLinear(rgb.g) +
    0.0722 * toLinear(rgb.b)
  return luminance > 0.179 ? "#111827" : "#ffffff"
}

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  let h = hex.trim().replace(/^#/, "")
  if (h.length === 3) {
    h = h
      .split("")
      .map((c) => c + c)
      .join("")
  }
  if (h.length !== 6 || /[^0-9a-fA-F]/.test(h)) return null
  const n = parseInt(h, 16)
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
}
