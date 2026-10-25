import { close } from './reading'

/**
 * The structured part of an explanation: the vocabulary, idioms and phrasal verbs of the selected text,
 * each with its meaning IN THIS CONTEXT. Gemini returns raw JSON; normalizeAnalysis checks it against the
 * source text so nothing is shown that isn't really there (no invented idioms, no duplicates).
 */

export type ExpressionType = 'idiom' | 'phrasal verb' | 'fixed expression'

export interface ExplainVocab {
  /** Exactly as written in the text. */
  term: string
  /** Part of speech in this sentence, e.g. "verb". */
  pos: string
  meaningBn: string
  /** Simple English definition of the meaning used here. */
  meaningEn: string
  /** One new example sentence with the same meaning (AI-written, not from the source). */
  example: string
  /** False when the context is not enough to be sure of the meaning. */
  certain: boolean
  /** How the text spells it, when that differs (a printing or scanning error, e.g. "resemhled"). */
  writtenAs?: string
}

export interface ExplainExpression {
  /** As written in the text (may be separated, e.g. "turned the offer down"). */
  term: string
  /** Dictionary form, e.g. "turn down". */
  baseForm: string
  type: ExpressionType
  meaningBn: string
  /** What it means in this text, in simple English. */
  meaningEn: string
  example: string
  certain: boolean
  writtenAs?: string
}

export interface ExplainAnalysis {
  vocabulary: ExplainVocab[]
  expressions: ExplainExpression[]
  /** Set when the meaning can't be decided from the given context. */
  ambiguity: string
}

/** What Gemini returns (snake_case, see the schema in main/ai/sentenceWordsSchema.ts). */
export interface RawAnalysis {
  gist?: string
  vocabulary?: { term?: string; written_as?: string; pos?: string; meaning_bn?: string; meaning_en?: string; example?: string; certain?: boolean }[]
  expressions?: { term?: string; written_as?: string; base_form?: string; type?: string; meaning_bn?: string; meaning_en?: string; example?: string; certain?: boolean }[]
  ambiguity?: string
}

const MAX_VOCAB = 10
const MAX_EXPRESSIONS = 6
const TYPES: ExpressionType[] = ['idiom', 'phrasal verb', 'fixed expression']

/** Lower-case word tokens (apostrophes kept inside words: "don't"). */
export function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .match(/[a-z0-9]+(?:'[a-z]+)?/g) ?? []
}

/**
 * Where the words of `term` appear in `source` in this order (up to `gap` other words between them, for
 * separable phrasal verbs): the source word positions, or null. `near` also accepts a slightly different
 * spelling (a misprint or scanning error in the source, e.g. "resemhled" for "resembled").
 */
export function locate(term: string, source: string[], gap = 4, near = false): number[] | null {
  const t = tokens(term)
  if (!t.length) return null
  const same = (a: string, b: string): boolean => a === b || (near && close(a, b))
  for (let start = 0; start < source.length; start++) {
    if (!same(t[0], source[start])) continue
    const at = [start]
    for (let k = 1; k < t.length; k++) {
      const prev = at[at.length - 1]
      let found = -1
      for (let j = prev + 1; j <= Math.min(source.length - 1, prev + 1 + gap); j++) {
        if (same(t[k], source[j])) {
          found = j
          break
        }
      }
      if (found < 0) break
      at.push(found)
    }
    if (at.length === t.length) return at
  }
  return null
}

/** The words of `term` appear in `source` in this order; up to `gap` other words may sit between them (separable phrasal verbs). */
export function appearsIn(term: string, source: string[], gap = 4): boolean {
  return locate(term, source, gap) !== null
}

/**
 * Finds `term` (or the spelling the model says the text uses) in the source: exactly, or failing that with a
 * slightly different spelling. Returns how the text spells it when that differs, or null if it isn't there.
 */
function find(term: string, writtenAs: string, source: string[], gap: number): { ok: boolean; writtenAs?: string } {
  if (locate(term, source, gap)) return { ok: true }
  if (writtenAs && locate(writtenAs, source, gap)) return { ok: true, writtenAs: tokens(writtenAs).join(' ') }
  const at = locate(term, source, gap, true)
  if (!at) return { ok: false }
  const spelled = at.map((i) => source[i]).join(' ')
  return { ok: true, writtenAs: spelled !== tokens(term).join(' ') ? spelled : undefined }
}

const clean = (s: unknown, max = 400): string => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim().slice(0, max) : '')

/**
 * Keeps only items that really occur in the source:
 *  - vocabulary must be in the selected text;
 *  - an expression must occur in the selected text or its sentence (words in order, separable allowed)
 *    and share at least one word with the selection;
 *  - duplicates go, and single words that are only part of a listed idiom / phrasal verb go too.
 */
export function normalizeAnalysis(raw: RawAnalysis | null | undefined, selected: string, sentence?: string | null): ExplainAnalysis {
  const sel = tokens(selected)
  const around = tokens(`${selected} ${sentence ?? ''}`)
  const selSet = new Set(sel)

  const expressions: ExplainExpression[] = []
  const seenExpr = new Set<string>()
  for (const e of raw?.expressions ?? []) {
    const term = clean(e?.term, 120)
    const baseForm = clean(e?.base_form, 120) || term
    const type = TYPES.find((t) => t === clean(e?.type).toLowerCase())
    const meaningBn = clean(e?.meaning_bn)
    const meaningEn = clean(e?.meaning_en)
    if (!term || !type || (!meaningBn && !meaningEn)) continue
    if (tokens(term).length < 2) continue // an "expression" of one word is just vocabulary
    const where = find(term, clean(e?.written_as, 120), around, 4)
    if (!where.ok) continue
    if (![...tokens(term), ...tokens(where.writtenAs ?? '')].some((w) => selSet.has(w))) continue
    const key = tokens(baseForm).join(' ')
    if (seenExpr.has(key)) continue
    seenExpr.add(key)
    expressions.push({ term, baseForm, type, meaningBn, meaningEn, example: clean(e?.example), certain: e?.certain !== false, ...(where.writtenAs ? { writtenAs: where.writtenAs } : {}) })
    if (expressions.length >= MAX_EXPRESSIONS) break
  }

  const inExpressions = new Set(expressions.flatMap((e) => [...tokens(e.term), ...tokens(e.writtenAs ?? '')]))
  const vocabulary: ExplainVocab[] = []
  const seenVocab = new Set<string>()
  for (const v of raw?.vocabulary ?? []) {
    const term = clean(v?.term, 80)
    const meaningBn = clean(v?.meaning_bn)
    const meaningEn = clean(v?.meaning_en)
    if (!term || (!meaningBn && !meaningEn)) continue
    const words = tokens(term)
    if (!words.length) continue
    const where = find(term, clean(v?.written_as, 80), sel, 0)
    if (!where.ok) continue
    const key = words.join(' ')
    if (seenVocab.has(key) || seenExpr.has(key)) continue
    // A word that only appears as part of a listed expression is explained there (unless it was the selection itself).
    if (words.length === 1 && (inExpressions.has(words[0]) || inExpressions.has(where.writtenAs ?? '')) && sel.length > 1) continue
    seenVocab.add(key)
    vocabulary.push({ term, pos: clean(v?.pos, 40), meaningBn, meaningEn, example: clean(v?.example), certain: v?.certain !== false, ...(where.writtenAs ? { writtenAs: where.writtenAs } : {}) })
    if (vocabulary.length >= MAX_VOCAB) break
  }

  return { vocabulary, expressions, ambiguity: clean(raw?.ambiguity, 300) }
}
