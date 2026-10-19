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
  /** English meaning / definition given with the word. */
  definitionEn?: string
  pos?: string
  synonyms?: string[]
  collocations?: string[]
  example?: string
  exampleBn?: string
  context?: string
  /** The reader wasn't sure (blurry, cut off, found inside mixed text …): check it before importing. */
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
  /** Lines of your text that are not a word or a detail of a word (not used; shown to you). */
  skipped?: string[]
}

// ---- Finding the English words in a pasted / typed / OCR text

/** Characters copied text often carries that are invisible (zero-width, direction marks, BOM). */
const INVISIBLE = /[​-‏‪-‮⁠-⁤﻿­]/g
const BENGALI = /[ঀ-৿]/
const LATIN = /[A-Za-z]/
/** Numbering (English or Bangla digits, letters, roman numerals) and bullets at the start of a line. */
const LEAD =
  /^\s*(?:[#>]+\s*)?(?:(?:\(?\p{Nd}{1,4}\s*[.)\]:।\-–]|\(?[a-zA-Z][.)]|\(?(?:i|ii|iii|iv|v|vi|vii|viii|ix|x|xi|xii)[.)])\s+|\p{Nd}{1,4}\s*[.)।]\s*(?=\p{L})|[-•*–·▪◦●○■□➤►✓✔→]\s*)+/iu
const POS_PAREN =
  /\s*[([]\s*(n|v|adj|adv|prep|conj|pron|interj|det|phr\.?\s*v|phrasal\s*verb|noun|verb|adjective|adverb|idiom|phrase|preposition|conjunction|pronoun)\.?\s*[)\]]/i
const SENTENCE_END = /[.!?]["”’']?$/
/** Starts like a story sentence ("The farmer…", "He saved…") rather than a dictionary meaning. */
const SENTENCE_START = /^(the|i|he|she|they|we|you|it|his|her|my|our|their|this|that|these|those|there)\b/i
/** Several sentences ("… frugal. His …"): a passage, not a meaning. */
const MANY_SENTENCES = /[.!?]["”’']?\s+[A-Z]/

type Field = 'bn' | 'en' | 'meaning' | 'syn' | 'ex' | 'exbn' | 'pos' | 'col' | 'word' | 'ignore'
/** Labels used in vocabulary lists (English and Bangla). "meaning" goes to Bangla or English by its script. */
const LABELS: [RegExp, Field][] = [
  [/^((bangla|bengali|bn)(\s*meaning)?|meaning\s*\((bangla|bengali|bn)\)|বাংলা(\s*অর্থ)?|বাংলা\s*মানে)$/i, 'bn'],
  [/^(english(\s*(meaning|definition))?|meaning\s*\((en|english)\)|definition|def|ইংরেজি(\s*(অর্থ|সংজ্ঞা|মানে))?|সংজ্ঞা)$/i, 'en'],
  [/^(meaning|meanings|অর্থ|মানে)$/i, 'meaning'],
  [/^(synonyms?|similar(\s*words?)?|syn|সমার্থক(\s*শব্দ)?|প্রতিশব্দ)$/i, 'syn'],
  [/^(antonyms?|opposites?|ant|বিপরীত(\s*শব্দ)?|বিপরীতার্থক(\s*শব্দ)?)$/i, 'ignore'],
  [/^(examples?|example\s*sentences?|sentence|e\.?\s*g\.?|usage|উদাহরণ(\s*বাক্য)?|বাক্য)$/i, 'ex'],
  [/^(((bangla|bengali)\s*)?translation|(বাংলা\s*)?অনুবাদ)$/i, 'exbn'],
  [/^(part\s*of\s*speech|parts?\s*of\s*speech|pos|word\s*class|পদ)$/i, 'pos'],
  [/^(collocations?|common\s*collocations?|common\s*phrases?)$/i, 'col'],
  [/^(word|term|vocabulary|headword|শব্দ)$/i, 'word'],
  [/^(pronunciation|ipa|উচ্চারণ|notes?|tips?|origin|etymology|level|type|category)$/i, 'ignore']
]
/** A label we don't know, but that clearly describes a word (e.g. "Meaning in context"). */
const LABEL_HINT = /\b(meaning|example|synonym|antonym|definition|translation|usage|note|pronunciation)s?\b|অর্থ|উদাহরণ|সমার্থক|বিপরীত/i
const STOP = new Set(
  'a an the i you he she it we they me him her us them my your his its our their is am are was were be been being do does did have has had to of in on at for with by from and or but so not no yes this that these those there here what which who whom whose when where why how as if than then too very just also only can could will would shall should may might must ok okay'.split(' ')
)

const words = (s: string): string[] => s.trim().split(/\s+/).filter(Boolean)
const clean = (raw: string): string =>
  raw
    .replace(INVISIBLE, '')
    .replace(/\*\*|__|`/g, '')
    .replace(/\s+/g, ' ')
    .trim()
const stripLead = (s: string): string => s.replace(LEAD, '').trim()

/** An English word or phrase that can be learned (not a sentence, no Bangla, not a label). */
function asTerm(s: string): { term: string; pos?: string } | null {
  let t = stripLead(s)
  let pos: string | undefined
  const p = t.match(POS_PAREN)
  if (p) {
    pos = p[1].toLowerCase().replace(/\.$/, '')
    t = t.replace(POS_PAREN, ' ')
  }
  t = t
    .replace(/^["“‘'(\[]+|["”’')\]]+$/g, '')
    .replace(/[.,;:!?]+$/, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!t || BENGALI.test(t) || !LATIN.test(t)) return null
  if (!/^[A-Za-z][A-Za-z'’\-\s.()/]*$/.test(t)) return null
  const n = words(t).length
  if (n > 6 || t.length > 60) return null
  if (STOP.has(t.toLowerCase())) return null
  return { term: t, pos }
}

function labelOf(label: string): Field | null {
  const l = clean(label).replace(/[.:：\-–]+$/, '').trim()
  for (const [re, f] of LABELS) if (re.test(l)) return f
  return null
}

const list = (s: string): string[] =>
  s
    .split(/\s*(?:[,;/、]|\bor\b)\s*/)
    .map((x) => x.replace(/[.]+$/, '').trim())
    .filter((x) => x && LATIN.test(x) && !BENGALI.test(x))
    .slice(0, 8)

export interface ParsedVocab {
  drafts: VbDraft[]
  /** Lines that are neither a word nor a detail of a word (kept out; shown to you). */
  unknown: string[]
  /** Lines of mixed Bangla-English text from which English words were picked out (to check). */
  mixed: number
}

/**
 * Finds the English vocabulary in a pasted, typed or OCR-read text and keeps its order. It
 * understands numbered lists (English or Bangla digits, bullets), headwords followed by labelled
 * lines (English meaning / ইংরেজি অর্থ, Bangla meaning / বাংলা অর্থ, Synonyms, Example …), inline
 * "word – meaning" pairs and "(adj.)" labels. Labels, meanings, synonyms and examples are attached to
 * their word — never turned into words. Anything it can't place is reported, not imported.
 */
export function parseVocabText(text: string): ParsedVocab {
  const drafts: VbDraft[] = []
  const unknown: string[] = []
  let mixed = 0
  let cur: VbDraft | null = null
  /** The current word's details are still being read (a following unlabelled line may be its meaning). */
  let justStarted = false

  const start = (term: string, pos?: string): VbDraft => {
    cur = { term, ...(pos ? { pos } : {}) }
    drafts.push(cur)
    justStarted = true
    return cur
  }
  const setMeaning = (d: VbDraft, value: string, field: 'bn' | 'en' | 'meaning'): void => {
    const v = value.replace(/^[-–—:]\s*/, '').trim()
    if (!v) return
    const toBn = field === 'bn' || (field === 'meaning' && BENGALI.test(v))
    if (toBn) d.meaningBn = d.meaningBn ? `${d.meaningBn}; ${v}` : v
    else d.definitionEn = d.definitionEn ? `${d.definitionEn}; ${v}` : v
  }
  const detail = (d: VbDraft, field: Field, value: string): void => {
    switch (field) {
      case 'bn':
      case 'en':
      case 'meaning':
        return setMeaning(d, value, field)
      case 'syn':
        d.synonyms = [...(d.synonyms ?? []), ...list(value)].slice(0, 8)
        return
      case 'col':
        d.collocations = [...(d.collocations ?? []), ...list(value)].slice(0, 8)
        return
      case 'ex':
        if (!d.example) d.example = value.replace(/^["“]|["”]$/g, '').trim()
        return
      case 'exbn':
        if (!d.exampleBn) d.exampleBn = value.trim()
        return
      case 'pos':
        if (!d.pos) d.pos = value.trim().toLowerCase()
        return
    }
  }

  for (const raw of text.split(/\r?\n/)) {
    const line = stripLead(clean(raw))
    if (!line || /^[-–—_=*~.·•]+$/.test(line)) continue

    // "Label: value"
    const lab = line.match(/^([^:：|=]{1,32}?)\s*[:：]\s*(.*)$/)
    if (lab) {
      const field = labelOf(lab[1]) ?? (cur && LABEL_HINT.test(lab[1]) ? 'ignore' : null)
      if (field === 'word') {
        const t = asTerm(lab[2])
        if (t) start(t.term, t.pos)
        else unknown.push(raw.trim())
        continue
      }
      if (field) {
        if (cur && field !== 'ignore') detail(cur, field, lab[2])
        else if (!cur) unknown.push(raw.trim())
        justStarted = false
        continue
      }
    }

    // "word – meaning", "word | meaning", "word: meaning", "word = meaning", "word<TAB>meaning"
    const sep = line.match(/\s*(?:\||\t|\s[-–—]\s|[-–—](?=\s*[ঀ-৿])|:\s*|=)\s*/)
    if (sep && sep.index && sep.index > 0) {
      const t = asTerm(line.slice(0, sep.index))
      const rest = line.slice(sep.index + sep[0].length).trim()
      // "Paragraph: The old farmer was frugal …" is a passage, not "word: meaning".
      const story = MANY_SENTENCES.test(rest) || (SENTENCE_START.test(rest) && words(rest).length >= 5)
      if (t && rest && !story && words(rest).length <= 25) {
        const d = start(t.term, t.pos)
        setMeaning(d, rest, 'meaning')
        justStarted = false
        continue
      }
    }

    // A headword on its own line (maybe with "(adj.)").
    const t = asTerm(line)
    if (t && !(words(t.term).length > 3 && SENTENCE_END.test(line))) {
      start(t.term, t.pos)
      continue
    }

    // "Vulnerable অরক্ষিত": an English word followed by its Bangla meaning.
    const pair = line.match(/^([A-Za-z][A-Za-z'’\- ]{0,60}?(?:\s*\([^)]{1,20}\))?)\s+([ঀ-৿].*)$/)
    if (pair) {
      const t2 = asTerm(pair[1])
      if (t2) {
        const d = start(t2.term, t2.pos)
        setMeaning(d, pair[2], 'bn')
        justStarted = false
        continue
      }
    }

    const hasBn = BENGALI.test(line)
    const hasLatin = LATIN.test(line)
    // A Bangla line right under a word: its Bangla meaning.
    if (hasBn && !hasLatin && cur && !(cur as VbDraft).meaningBn) {
      ;(cur as VbDraft).meaningBn = line
      justStarted = false
      continue
    }
    // An English sentence under a word: its example (if it uses the word) or its meaning.
    if (!hasBn && hasLatin && cur) {
      const d = cur as VbDraft
      if (!d.example && blankSentence(line, d.term)) {
        d.example = line
        justStarted = false
        continue
      }
      if (justStarted && !d.definitionEn && !SENTENCE_START.test(line) && !MANY_SENTENCES.test(line)) {
        d.definitionEn = line
        justStarted = false
        continue
      }
    }
    // Mixed Bangla-English text: the English words in it are picked out (marked to check).
    if (hasBn && hasLatin) {
      const runs = line.match(/[A-Za-z][A-Za-z'’\-]*(?:\s+[A-Za-z][A-Za-z'’\-]*){0,3}/g) ?? []
      const picked = runs.map((r) => asTerm(r)).filter((x): x is { term: string; pos?: string } => !!x)
      if (picked.length) {
        mixed++
        for (const p of picked) {
          const d = start(p.term, p.pos)
          d.uncertain = true
          d.note = 'found inside mixed text'
        }
        justStarted = false
        unknown.push(raw.trim())
        continue
      }
    }
    unknown.push(raw.trim())
  }
  // A "word" that is really a label left alone (e.g. "Synonyms") is not kept.
  return { drafts: drafts.filter((d) => !labelOf(d.term)), unknown, mixed }
}

/** The words of a pasted / typed list (see parseVocabText). */
export function parseWordList(text: string): VbDraft[] {
  return parseVocabText(text).drafts
}

/**
 * Lines read by Windows OCR → words. A heading such as "Unit 7 - Page 42" becomes the page
 * reference; every word is marked "check" because offline OCR gives no certainty per word.
 */
export function draftsFromOcrLines(lines: string[]): { drafts: VbDraft[]; pageRef: string | null; unknown: string[] } {
  let pageRef: string | null = null
  const kept: string[] = []
  for (const l of lines) {
    const line = clean(l)
    if (!line) continue
    if (!pageRef && /\b(page|p\.|unit|lesson|chapter)\s*\d+/i.test(line) && !LEAD.test(line)) {
      pageRef = line
      continue
    }
    kept.push(line)
  }
  const r = parseVocabText(kept.join('\n'))
  return { drafts: r.drafts.map((d) => ({ ...d, uncertain: true })), pageRef, unknown: r.unknown }
}

/** Keeps only words that really occur in the text (an AI suggestion that isn't there is dropped), in text order. */
export function inTextOrder<T extends { term: string }>(items: T[], text: string): { kept: T[]; dropped: string[] } {
  const hay = clean(text).toLowerCase().replace(/[’]/g, "'")
  const found: { item: T; at: number }[] = []
  const dropped: string[] = []
  for (const item of items) {
    const needle = clean(item.term).toLowerCase().replace(/[’]/g, "'")
    const at = needle ? hay.indexOf(needle) : -1
    if (at < 0) dropped.push(item.term)
    else found.push({ item, at })
  }
  return { kept: found.sort((a, b) => a.at - b.at).map((f) => f.item), dropped }
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
