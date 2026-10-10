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

export type LadderStage = 'listen' | 'mumble' | 'shadow' | 'noText' | 'memory'

export interface LadderRep {
  stage: LadderStage
  label: string
  hideText: boolean
}

const STAGES: { stage: LadderStage; label: string; weight: number; hideText: boolean }[] = [
  { stage: 'listen', label: 'Listen', weight: 2, hideText: false },
  { stage: 'mumble', label: 'Mumble with text', weight: 3, hideText: false },
  { stage: 'shadow', label: 'Shadow aloud', weight: 4, hideText: false },
  { stage: 'noText', label: 'Shadow without text', weight: 3, hideText: true },
  { stage: 'memory', label: 'Say from memory', weight: 2, hideText: true }
]
/** When reps don't divide evenly, extra reps go to these stages first. */
const TIE_ORDER: LadderStage[] = ['listen', 'shadow', 'memory', 'noText', 'mumble']

/**
 * Shadow Ladder: spreads n reps (1–14) over the stages in proportion 2:3:4:3:2.
 * Small counts use fewer stages; from 3 reps on, the last rep is always without text.
 */
export function ladder(n: number): LadderRep[] {
  const reps = Math.max(1, Math.min(14, Math.round(n)))
  const rep = (s: (typeof STAGES)[number]): LadderRep => ({ stage: s.stage, label: s.label, hideText: s.hideText })
  if (reps === 1) return [rep(STAGES[2])]
  if (reps === 2) return [rep(STAGES[0]), rep(STAGES[2])]
  const total = STAGES.reduce((a, s) => a + s.weight, 0)
  const exact = STAGES.map((s) => (reps * s.weight) / total)
  const counts = exact.map(Math.floor)
  let left = reps - counts.reduce((a, b) => a + b, 0)
  const order = STAGES.map((s, i) => i).sort((a, b) => exact[b] - Math.floor(exact[b]) - (exact[a] - Math.floor(exact[a])) || TIE_ORDER.indexOf(STAGES[a].stage) - TIE_ORDER.indexOf(STAGES[b].stage))
  for (let k = 0; left > 0; k = (k + 1) % order.length, left--) counts[order[k]]++
  // Always finish without text.
  if (counts[3] + counts[4] === 0) {
    const biggest = counts.indexOf(Math.max(...counts))
    counts[biggest]--
    counts[4]++
  }
  return STAGES.flatMap((s, i) => Array.from({ length: counts[i] }, () => rep(s)))
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
