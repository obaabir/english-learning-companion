/** WCAG 2.x colour contrast (relative luminance), used to check the Explain appearance colours. */

/** Normal text needs 4.5:1 against its background (WCAG AA); large text 3:1. */
export const AA_NORMAL = 4.5
export const AA_LARGE = 3

export function parseHex(hex: string): [number, number, number] | null {
  const m = hex.trim().match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i)
  if (!m) return null
  const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1]
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number]
}

export function toHex([r, g, b]: [number, number, number]): string {
  return `#${[r, g, b].map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('')}`
}

function luminance(rgb: [number, number, number]): number {
  const [r, g, b] = rgb.map((v) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** Contrast ratio between two colours (1–21). Unparseable colours count as 1 (fail). */
export function contrastRatio(a: string, b: string): number {
  const x = parseHex(a)
  const y = parseHex(b)
  if (!x || !y) return 1
  const [hi, lo] = [luminance(x), luminance(y)].sort((p, q) => q - p)
  return (hi + 0.05) / (lo + 0.05)
}

/**
 * The closest readable version of `fg` on `bg`: mixes it step by step towards black (on light
 * backgrounds) or white (on dark ones) until it reaches `min`. Keeps the hue as far as possible.
 */
export function readableVersion(fg: string, bg: string, min = AA_NORMAL): string {
  const f = parseHex(fg)
  const b = parseHex(bg)
  if (!f || !b) return fg
  if (contrastRatio(fg, bg) >= min) return toHex(f)
  const target: [number, number, number] = luminance(b) > 0.18 ? [0, 0, 0] : [255, 255, 255]
  for (let t = 0.05; t <= 1.0001; t += 0.05) {
    const mixed = toHex([0, 1, 2].map((i) => f[i] + (target[i] - f[i]) * t) as [number, number, number])
    if (contrastRatio(mixed, bg) >= min) return mixed
  }
  return toHex(target)
}
