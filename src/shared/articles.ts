import type { NoteKind } from './types'

/** A block of an article's original text, kept so the article can be read again later (even offline). */
export interface ArticleBlock {
  type: 'h' | 'p' | 'li' | 'quote' | 'pre'
  text: string
  /** Heading level (1–6) for type 'h'. */
  level?: number
}

/** What the in-app browser (or a paste) gives when an article is opened. */
export interface ArticleInput {
  url: string
  title: string
  siteName?: string | null
  byline?: string | null
  excerpt?: string | null
  /** The readable original text (Reader view). Kept only if longer than what is already stored. */
  blocks?: ArticleBlock[] | null
}

export interface Article {
  id: number
  url: string
  title: string
  /** e.g. "bbc.com"; "Pasted text" for articles pasted by hand. */
  domain: string
  siteName: string | null
  byline: string | null
  excerpt: string | null
  /** The learner's own note on the article. */
  personalNote: string | null
  firstOpenedAt: string
  lastOpenedAt: string
  hasSnapshot: boolean
  /** Saved vocabulary, phrases and idioms. */
  vocabCount: number
  /** Saved sentences, structures and grammar notes. */
  sentenceCount: number
  otherCount: number
}

export interface ArticleDetail extends Article {
  blocks: ArticleBlock[]
}

/** Pasted articles have no web address; they get a local id instead. */
export const PASTED_PREFIX = 'pasted:'

export const VOCAB_KINDS: NoteKind[] = ['word', 'phrase', 'idiom', 'phrasal', 'collocation']
export const SENTENCE_KINDS: NoteKind[] = ['sentence', 'structure', 'grammar']

export function isPasted(url: string): boolean {
  return url.startsWith(PASTED_PREFIX)
}

export function domainOf(url: string): string {
  if (isPasted(url)) return 'Pasted text'
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

/** A word or short phrase is explained like vocabulary; five or more words like a sentence. */
export function articleMode(text: string): 'word' | 'sentence' {
  return text.trim().split(/\s+/).filter(Boolean).length >= 5 ? 'sentence' : 'word'
}

/** The note type a selection is saved as by default. */
export function suggestedArticleKind(text: string): NoteKind {
  const words = text.trim().split(/\s+/).filter(Boolean).length
  return words <= 1 ? 'word' : words < 5 ? 'phrase' : 'sentence'
}

/**
 * The sentence of `block` that contains `selected` (the whole selection if it spans sentences).
 * Falls back to the selection itself when it can't be found.
 */
export function sentenceAround(block: string, selected: string): string {
  const text = block.replace(/\s+/g, ' ').trim()
  const sel = selected.replace(/\s+/g, ' ').trim()
  const at = text.indexOf(sel)
  if (!sel || at < 0) return sel
  // Sentence ends: . ! ? (optionally followed by quotes/brackets) and a space. Avoids "e.g." / "Mr." style splits poorly but cheaply.
  const ends: number[] = []
  const re = /[.!?]+["'”’)\]]*\s+(?=[A-Z0-9"“'‘(])/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) ends.push(m.index + m[0].length)
  let start = 0
  for (const e of ends) if (e <= at) start = e
  let end = text.length
  for (const e of ends)
    if (e >= at + sel.length) {
      end = e
      break
    }
  return text.slice(start, end).trim()
}

/** Local calendar day (YYYY-MM-DD) of an ISO time. */
export function localDay(iso: string): string {
  const d = new Date(iso)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * Articles grouped by the day they were first opened, oldest first: Day 1 is the first day
 * you read an article here, Day 2 the next day you read one, and so on.
 */
export function groupByDay<T extends { firstOpenedAt: string }>(items: T[]): { day: number; date: string; items: T[] }[] {
  const byDate = new Map<string, T[]>()
  for (const it of [...items].sort((a, b) => a.firstOpenedAt.localeCompare(b.firstOpenedAt))) {
    const d = localDay(it.firstOpenedAt)
    byDate.set(d, [...(byDate.get(d) ?? []), it])
  }
  return [...byDate.entries()].map(([date, list], i) => ({ day: i + 1, date, items: list }))
}

/** Whether a saved item's text is original article text (vs. text from an AI explanation). */
export function isFromArticle(text: string, article: { blocks: ArticleBlock[] }, contextSentence?: string | null): boolean {
  const norm = (s: string): string => s.replace(/[\s“”"‘’']+/g, ' ').trim().toLowerCase()
  const t = norm(text)
  if (!t) return false
  if (contextSentence && norm(contextSentence).includes(t)) return true
  return article.blocks.some((b) => norm(b.text).includes(t))
}

/** Text selected in a web page (in Chrome via the extension, or in the in-app browser). */
export interface WebSelection {
  text: string
  sentence: string | null
  paragraph: string | null
  url: string
  title: string
  /** The page's readable article text, when it could be read (for history and Reader view). */
  article?: ArticleInput | null
}

/** Port of the local link that the Chrome extension sends selections to (127.0.0.1 only). */
export const BRIDGE_PORT = 47821
