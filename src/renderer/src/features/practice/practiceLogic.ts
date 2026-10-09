/** Pure practice logic (no UI), shared by Movie Mode and YouTube. */

export const COUNTS = [2, 5, 8, 10] as const
export type Count = (typeof COUNTS)[number]
/** Padding around a line so words aren't cut off. */
export const PAD = 0.4

/** One repetition: speed and whether the line text is hidden. */
export interface Rep {
  rate: number
  hideText: boolean
}

/** Smart repeat: first rep normal with text, middle reps slower (later ones without text), last rep normal without text. */
export function repeatPlan(n: number, smart: boolean): Rep[] {
  if (!smart) return Array.from({ length: n }, () => ({ rate: 1, hideText: false }))
  return Array.from({ length: n }, (_, i) => {
    if (i === 0) return { rate: 1, hideText: false }
    if (i === n - 1) return { rate: 1, hideText: true }
    return { rate: 0.75, hideText: i >= Math.ceil((n - 1) / 2) }
  })
}

const normalize = (w: string): string => w.toLowerCase().replace(/[’]/g, "'").replace(/[^a-z0-9']/g, '')

/** Which words of the line appear (in order) in what was heard. */
export function matchHeard(target: string[], heardText: string): boolean[] {
  const heard = heardText.split(/\s+/).map(normalize).filter(Boolean)
  const out = target.map(() => false)
  let j = 0
  target.forEach((w, i) => {
    const t = normalize(w)
    if (!t) {
      out[i] = true
      return
    }
    const k = heard.indexOf(t, j)
    if (k >= 0 && k - j <= 3) {
      out[i] = true
      j = k + 1
    }
  })
  return out
}
