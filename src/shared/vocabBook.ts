import { normTerm } from './vocab'

/**
 * Vocabulary Book Learning: a separate module for words from vocabulary books, pictures, stories and
 * passages. It has its own tables, its own learning order, its own deck and revision schedule
 * (Day 1 → Day 4 → Day 7 after the learning day), its own mistake history and its own Google Doc.
 * Nothing here is mixed with the regular collection (Notes / Flashcards / Games).
 */

export type VbSourceKind = 'book_page' | 'word_list_image' | 'story' | 'passage' | 'manual' | 'pasted'

export const VB_SOURCE_KINDS: { value: VbSourceKind; label: string; image?: boolean }[] = [
  { value: 'book_page', label: 'Picture of a vocabulary book page', image: true },
  { value: 'word_list_image', label: 'Image with a word list', image: true },
  { value: 'story', label: 'A story' },
  { value: 'passage', label: 'A contextual passage' },
  { value: 'manual', label: 'Type words or phrases' },
  { value: 'pasted', label: 'Paste a list' }
]

export interface VbBook {
  id: number
  title: string
  /** New words introduced per day (5, 10, 15, 20 or your own number). */
  dailyNew: number
  createdAt: string
  total: number
}

export interface VbSource {
  id: number
  bookId: number
  kind: VbSourceKind
  title: string | null
  /** The full story / passage / pasted text (kept as reference). */
  text: string | null
  /** A saved copy of the picture (file name inside the app's data folder). */
  imageFile: string | null
  pageRef: string | null
  /** How the words were read: e.g. "Gemini vision", "Windows OCR (offline)", "typed". */
  extraction: string | null
  createdAt: string
  itemCount?: number
}

export interface VbItem {
  id: number
  uid: string
  bookId: number
  sourceId: number | null
  /** Learning order (1, 2, 3 … in the order the words were supplied). */
  seq: number
  term: string
  /** The word as first imported (kept if you edit the term). */
  originalTerm: string
  meaningBn: string
  definitionEn: string
  pos: string
  /** The sentence of the story / passage / page the word came from. */
  context: string
  example: string
  exampleBn: string
  synonyms: string[]
  collocations: string[]
  pageRef: string | null
  /** Meaning etc. filled in (by Gemini or by you). */
  enriched: boolean
  enrichError: string | null
  /** null = still new (not studied yet). Set once, never reset. */
  introducedAt: string | null
  step: number
  intervalDays: number
  ease: number
  reps: number
  lapses: number
  due: string | null
  lastReviewedAt: string | null
  lastRating: number | null
  /** How many wrong answers so far (Mistake 1, Mistake 2 …); history is kept in mistakes. */
  mistakes: number
  /** Mistakes not yet followed by a correct answer. */
  openMistakes: number
  /** Wrong sentence-making answers so far. */
  sentenceMistakes: number
  gdocSyncedAt: string | null
  gdocError: string | null
  createdAt: string
}

export type VbStatus = 'new' | 'learning' | 'due' | 'struggling' | 'mastered'

export const VB_MASTERED_DAYS = 21

/** Where an item stands now (history stays in the mistake log). */
export function vbStatus(i: Pick<VbItem, 'introducedAt' | 'due' | 'intervalDays' | 'lastRating' | 'openMistakes' | 'lapses' | 'mistakes'>, now = new Date()): VbStatus {
  if (!i.introducedAt) return 'new'
  if (isVbMastered(i)) return 'mastered'
  if (i.openMistakes > 0 && i.mistakes >= 2) return 'struggling'
  if (i.due && new Date(i.due) <= endOfDay(now)) return 'due'
  return 'learning'
}

/** Mastered: a long gap, remembered last time, and no mistake still waiting for a correct answer. */
export function isVbMastered(i: Pick<VbItem, 'introducedAt' | 'intervalDays' | 'lastRating' | 'openMistakes'>): boolean {
  return !!i.introducedAt && i.intervalDays >= VB_MASTERED_DAYS && (i.lastRating ?? 0) >= 3 && i.openMistakes === 0
}

export function endOfDay(now = new Date()): Date {
  const d = new Date(now)
  d.setHours(23, 59, 59, 999)
  return d
}
export function startOfDay(now = new Date()): Date {
  const d = new Date(now)
  d.setHours(0, 0, 0, 0)
  return d
}

// ---- Daily learning modes

export type VbMode = 'mcq' | 'flashcard' | 'sentence' | 'recognition' | 'matching' | 'context'

export const VB_MODES: { value: VbMode; label: string; hint: string }[] = [
  { value: 'mcq', label: 'Multiple choice', hint: 'Pick the right Bangla meaning of the word.' },
  { value: 'flashcard', label: 'Flashcards', hint: 'See the word, recall it, check the back.' },
  { value: 'sentence', label: 'Sentence making', hint: 'Write your own sentence with the word.' },
  { value: 'recognition', label: 'Meaning recognition', hint: 'See the meaning, pick the word.' },
  { value: 'matching', label: 'Word–meaning matching', hint: 'Match up to 5 words with their meanings.' },
  { value: 'context', label: 'Context questions', hint: 'Fill the word into its original sentence.' }
]

export type VbTaskKind = 'new' | 'review' | 'mistake' | 'retry'

export interface VbTask {
  kind: VbTaskKind
  mode: VbMode
  itemIds: number[]
}

type ItemForTask = Pick<VbItem, 'id' | 'term' | 'meaningBn' | 'definitionEn' | 'context' | 'example'>

/** Can this item be asked in this mode? (Meaning modes need a meaning; context needs a sentence with the word.) */
export function modeFits(mode: VbMode, item: ItemForTask, others: number): boolean {
  const hasMeaning = !!(item.meaningBn || item.definitionEn)
  switch (mode) {
    case 'mcq':
    case 'recognition':
      return hasMeaning && others >= 1
    case 'matching':
      return hasMeaning
    case 'context':
      return others >= 1 && !!blankSentence(item.context || item.example, item.term)
    default:
      return true
  }
}

/**
 * Today's session: the chosen modes are taken in turn; an item that can't be asked in a mode gets the
 * next one that fits (flashcards always fit). Matching groups up to 5 items into one task, placed where
 * its first word comes, so the learning order is kept.
 */
export function buildTasks(entries: { item: ItemForTask; kind: VbTaskKind }[], modes: VbMode[], pool: ItemForTask[]): VbTask[] {
  const chosen: VbMode[] = modes.length ? modes : ['flashcard']
  const others = (id: number): number => pool.filter((p) => p.id !== id && (p.meaningBn || p.definitionEn)).length
  const tasks: VbTask[] = []
  const matching = new Map<VbTaskKind, VbTask>()
  entries.forEach(({ item, kind }, i) => {
    let mode: VbMode = 'flashcard'
    for (let k = 0; k < chosen.length; k++) {
      const m = chosen[(i + k) % chosen.length]
      if (modeFits(m, item, others(item.id))) {
        mode = m
        break
      }
    }
    if (mode === 'matching') {
      // The group sits where its first word is, so words keep their learning order.
      let group = matching.get(kind)
      if (!group || group.itemIds.length === 5) {
        group = { kind, mode, itemIds: [] }
        matching.set(kind, group)
        tasks.push(group)
      }
      group.itemIds.push(item.id)
      return
    }
    tasks.push({ kind, mode, itemIds: [item.id] })
  })
  // A group of one can't be matched: it becomes a flashcard.
  for (const t of tasks) if (t.mode === 'matching' && t.itemIds.length < 2) t.mode = 'flashcard'
  return tasks
}

/** The item's sentence with the word replaced by a blank (null if the word isn't in it). */
export function blankSentence(sentence: string | null | undefined, term: string): string | null {
  const s = (sentence ?? '').trim()
  const t = term.trim()
  if (!s || !t) return null
  const words = t.split(/\s+/).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  // Also matches simple endings (-s, -es, -ed, -d, -ing) on the last word; not other words such as "diligently".
  const last = words.pop()!
  const re = new RegExp(`\\b${[...words, `${last}(?:s|es|ed|d|ing)?`].join('\\s+')}\\b`, 'i')
  if (!re.test(s)) return null
  return s.replace(re, '_____')
}

/** Wrong options for a question: other items of the same book (deterministic for a seed). */
export function pickDistractors<T extends { id: number }>(correct: T, pool: T[], n: number, key: (t: T) => string, seed = 1): T[] {
  const seen = new Set([normTerm(key(correct))])
  const out: T[] = []
  const list = pool.filter((p) => p.id !== correct.id)
  let x = (seed * 9301 + correct.id * 49297) % 233280
  const shuffled = list
    .map((p) => {
      x = (x * 9301 + 49297) % 233280
      return { p, r: x }
    })
    .sort((a, b) => a.r - b.r)
    .map((e) => e.p)
  for (const p of shuffled) {
    const k = normTerm(key(p))
    if (!k || seen.has(k)) continue
    seen.add(k)
    out.push(p)
    if (out.length === n) break
  }
  return out
}

/**
 * Mistake Review order: many mistakes first, then low recall ratings, items due, and items that were
 * hard to use in a sentence. Items with no mistakes and good ratings are not included.
 */
export function mistakePriority(i: Pick<VbItem, 'mistakes' | 'openMistakes' | 'lastRating' | 'due' | 'sentenceMistakes' | 'introducedAt'>, now = new Date()): number {
  if (!i.introducedAt) return 0
  const low = i.lastRating !== null && i.lastRating <= 2
  if (!i.mistakes && !low) return 0
  return i.mistakes * 3 + i.openMistakes * 2 + (low ? 2 : 0) + (i.due && new Date(i.due) <= endOfDay(now) ? 1 : 0) + Math.min(2, i.sentenceMistakes) * 2
}

// ---- Imports

/** One word in the review list before importing (you can edit or untick it). */
export interface VbDraft {
  term: string
  meaningBn?: string
  context?: string
  /** The reader wasn't sure (blurry, cut off …): check it before importing. */
  uncertain?: boolean
  note?: string
  /** Already in this book (its number), so it isn't added twice by accident. */
  duplicateOf?: number | null
}

export interface VbExtraction {
  drafts: VbDraft[]
  /** How it was read. */
  engine: 'gemini' | 'windows-ocr' | 'text'
  /** Whole page / list read? false = something may be missing (said clearly). */
  complete: boolean
  warning: string | null
  pageRef: string | null
  /** The saved copy of the picture, to keep with the words. */
  imageFile?: string | null
  /** What the OCR read (to compare). */
  rawText?: string
}

const NUMBERING = /^\s*(?:\(?\d{1,4}[.)\]:-]|\(?[a-zA-Z][.)]|[-•*–·▪◦])\s+/

/**
 * A pasted or typed list: one word or phrase per line, optionally "word | meaning", "word - meaning",
 * "word: meaning" or "word = meaning". Numbering and bullets are removed; the order is kept.
 */
export function parseWordList(text: string): VbDraft[] {
  const out: VbDraft[] = []
  for (const raw of text.split(/\r?\n/)) {
    let line = raw.replace(NUMBERING, '').replace(/\s+/g, ' ').trim()
    if (!line) continue
    let meaning: string | undefined
    const sep = line.match(/\s*(?:\||\s[-–—]\s|:\s|=)\s*/)
    if (sep && sep.index && sep.index > 0) {
      meaning = line.slice(sep.index + sep[0].length).trim() || undefined
      line = line.slice(0, sep.index).trim()
    }
    line = line.replace(/[.,;]+$/, '').trim()
    if (!line || line.split(' ').length > 8) continue
    out.push({ term: line, ...(meaning ? { meaningBn: meaning } : {}) })
  }
  return out
}

/**
 * Lines read by Windows OCR → words. A heading such as "Unit 7 - Page 42" becomes the page
 * reference; everything is marked "check" because offline OCR gives no certainty per word.
 */
export function draftsFromOcrLines(lines: string[]): { drafts: VbDraft[]; pageRef: string | null } {
  let pageRef: string | null = null
  const kept: string[] = []
  for (const l of lines) {
    const line = l.trim()
    if (!line) continue
    if (!pageRef && /\b(page|p\.|unit|lesson|chapter)\s*\d+/i.test(line) && !NUMBERING.test(line)) {
      pageRef = line
      continue
    }
    kept.push(line)
  }
  const drafts = parseWordList(kept.join('\n')).map((d) => ({ ...d, uncertain: true }))
  return { drafts, pageRef }
}

/** The sentence of a passage that contains the word (for its context). */
export function sentenceWith(passage: string, term: string): string | null {
  const sentences = passage.replace(/\s+/g, ' ').match(/[^.!?]+[.!?]+["”’']?|[^.!?]+$/g) ?? []
  for (const s of sentences) if (blankSentence(s, term)) return s.trim()
  return null
}

/** Marks drafts that are already in the book (and repeats within the list), so they start unticked. */
export function markDuplicates(drafts: VbDraft[], existing: { term: string; seq: number }[]): VbDraft[] {
  const have = new Map(existing.map((e) => [normTerm(e.term), e.seq]))
  const inList = new Set<string>()
  return drafts.map((d) => {
    const k = normTerm(d.term)
    const dup = have.get(k) ?? (inList.has(k) ? 0 : null)
    inList.add(k)
    return { ...d, duplicateOf: dup }
  })
}

export const VB_ERROR_TYPES: Record<string, string> = {
  wrong_meaning: 'Wrong meaning chosen',
  wrong_word: 'Wrong word chosen',
  wrong_match: 'Wrong match',
  wrong_context: 'Wrong word in context',
  forgot: 'Did not remember',
  sentence_usage: 'Word used incorrectly in a sentence',
  sentence_grammar: 'Grammar mistake in the sentence'
}

export interface VbMistake {
  id: number
  itemId: number
  term: string
  /** Mistake 1, Mistake 2 … for this item. */
  number: number
  mode: VbMode
  question: string
  answer: string
  correct: string
  errorType: string
  createdAt: string
  /** When a later answer was correct (the record is kept). */
  correctedAt: string | null
}

export interface VbAnswer {
  itemId: number
  kind: VbTaskKind
  mode: VbMode
  correct: boolean
  /** How well it was remembered: 1 Again, 2 Hard, 3 Good, 4 Easy. */
  rating: 1 | 2 | 3 | 4
  question: string
  answer: string
  correctAnswer: string
  errorType?: string
}

export interface VbDashboard {
  bookId: number
  total: number
  dailyNew: number
  newToday: number
  remainingNewToday: number
  /** New words not yet studied (in order). */
  newLeft: number
  reviewsToday: number
  dueNow: number
  mistakesToday: number
  mistakesTotal: number
  frequent: { id: number; term: string; mistakes: number; seq: number }[]
  mastered: number
  learning: number
  /** Number of the next new word in the sequence. */
  nextSeq: number | null
}

export interface VbSession {
  newItems: VbItem[]
  reviewItems: VbItem[]
  pool: VbItem[]
}

export interface VbItemEdit {
  id: number
  term?: string
  meaningBn?: string
  definitionEn?: string
  pos?: string
  context?: string
  example?: string
  exampleBn?: string
  synonyms?: string[]
  collocations?: string[]
}
