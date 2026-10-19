import type { NoteData, NoteKind } from './types'

/**
 * The learning collection: every regular vocabulary item lives in the notes table. Each item has a
 * designated TARGET — the word, phrase, idiom, phrasal verb, collocation or pattern to learn. The
 * flashcard front shows the target (never the whole sentence it came from); the sentence stays as
 * context. Vocabulary Book items (a later feature) use their own collection so they don't mix.
 */
export type Collection = 'regular' | 'book'

/** Kinds whose saved text IS the item to learn. */
export const TERM_KINDS: NoteKind[] = ['word', 'phrase', 'collocation', 'idiom', 'phrasal']
export const IDIOM_TERM_KINDS: NoteKind[] = ['idiom', 'phrasal']

const words = (s: string): string[] => s.trim().split(/\s+/).filter(Boolean)
export const normTerm = (s: string | null | undefined): string =>
  (s ?? '')
    .toLowerCase()
    .replace(/[“”"‘’'`.,!?;:()…]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

/** A word or phrase short enough to be a flashcard front (not a whole sentence). */
export function isTargetLike(s: string | null | undefined): boolean {
  const t = (s ?? '').trim()
  if (!t) return false
  const n = words(t).length
  // Two sentences ("I'm just a junker, man. I was just checking stuff out.") are never a target.
  return n <= 7 && !/[.!?]\s+\S/.test(t)
}

type ItemLike = { kind: NoteKind; text: string; data?: NoteData | null }

/**
 * The target for a newly saved item: the text itself for words, phrases, idioms, phrasal verbs and
 * collocations (and short patterns); for a sentence, the key expression Gemini found in it. null
 * means "not chosen yet" (no flashcard is made until there is one).
 */
export function initialTarget(n: ItemLike): string | null {
  const text = n.text.trim()
  const d = n.data
  const fromData = d?.target_term?.trim() || d?.idioms_phrasal?.[0]?.term?.trim() || d?.vocabulary?.[0]?.term?.trim() || null
  switch (n.kind) {
    case 'word':
    case 'phrase':
    case 'collocation':
    case 'idiom':
    case 'phrasal':
      return text || null
    case 'structure':
    case 'grammar':
      return isTargetLike(text) || words(text).length <= 10 ? text : d?.target_term?.trim() || d?.grammar?.[0]?.pattern?.trim() || null
    case 'sentence':
      return words(text).length <= 4 ? text : fromData && isTargetLike(fromData) ? fromData : null
    default:
      return null
  }
}

/** The meaning of the target (Bangla and English), taken from the item's own analysis. */
export function targetMeaning(n: ItemLike & { target?: string | null }): { bn: string; en: string } {
  const d = n.data
  if (!d) return { bn: '', en: '' }
  const target = normTerm(n.target ?? '')
  if (TERM_KINDS.includes(n.kind) || !target || target === normTerm(n.text)) return { bn: d.meaning_bn ?? '', en: d.meaning_en ?? '' }
  if (d.target_term && normTerm(d.target_term) === target) return { bn: d.target_meaning_bn ?? '', en: d.target_meaning_en ?? '' }
  const term = [...(d.idioms_phrasal ?? []), ...(d.vocabulary ?? [])].find((t) => normTerm(t.term) === target)
  return { bn: term?.meaning_bn ?? '', en: '' }
}

/** The original sentence an item came from (source text, not AI). */
export function originalSentence(n: { kind: NoteKind; text: string; contextSentence?: string | null }): string | null {
  return n.contextSentence?.trim() || (n.kind === 'sentence' || n.kind === 'structure' ? n.text.trim() : null)
}
