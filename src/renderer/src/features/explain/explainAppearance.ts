import { create } from 'zustand'
import { AA_NORMAL, contrastRatio, parseHex } from '@shared/contrast'

/**
 * Colours of the Explain reading surface (Movies, YouTube and Articles share them). A light, paper-like
 * background with near-black text; one colour for vocabulary words, one for example sentences.
 * These are starting points checked for contrast (WCAG AA), not colours proven to improve memory.
 */
export interface ExplainColors {
  bg: string
  vocab: string
  example: string
}

/** Main text and meanings: near-black, fixed (always checked against the background). */
export const EXPLAIN_TEXT = '#171717'
export const EXPLAIN_DEFAULTS: ExplainColors = { bg: '#F7F5EF', vocab: '#2457C5', example: '#0F766E' }

export interface ContrastCheck {
  key: keyof ExplainColors
  label: string
  ratio: number
  ok: boolean
}

/** Every colour against the background: text, vocabulary and examples all need 4.5:1 (normal-size text). */
export function checkColors(c: ExplainColors): ContrastCheck[] {
  return [
    { key: 'bg', label: 'Text on background', ratio: contrastRatio(EXPLAIN_TEXT, c.bg) },
    { key: 'vocab', label: 'Vocabulary words', ratio: contrastRatio(c.vocab, c.bg) },
    { key: 'example', label: 'Example sentences', ratio: contrastRatio(c.example, c.bg) }
  ].map((x) => ({ ...x, key: x.key as keyof ExplainColors, ok: x.ratio >= AA_NORMAL }))
}

const KEY = 'elc.explainAppearance.v1'

function load(): ExplainColors {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<ExplainColors> | null
    const c = { ...EXPLAIN_DEFAULTS, ...saved }
    // Never start from an unreadable or broken combination.
    if (![c.bg, c.vocab, c.example].every((x) => parseHex(x)) || checkColors(c).some((x) => !x.ok)) return EXPLAIN_DEFAULTS
    return c
  } catch {
    return EXPLAIN_DEFAULTS
  }
}

interface AppearanceState {
  colors: ExplainColors
  /** Saves colours; refuses a combination that fails the contrast check. */
  save: (c: ExplainColors) => boolean
  reset: () => void
}

export const useExplainAppearance = create<AppearanceState>((set) => ({
  colors: load(),
  save: (c) => {
    if (checkColors(c).some((x) => !x.ok)) return false
    set({ colors: c })
    try {
      localStorage.setItem(KEY, JSON.stringify(c))
    } catch {
      // storage unavailable: keep for this session
    }
    return true
  },
  reset: () => {
    set({ colors: EXPLAIN_DEFAULTS })
    try {
      localStorage.removeItem(KEY)
    } catch {
      // ignore
    }
  }
}))
