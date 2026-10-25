/**
 * Reading Companion: a passage of a physical book prepared in advance (pasted or read from page photos),
 * split into pages → paragraphs → sentences, and the search that finds what the learner names by voice
 * ("explain 'reluctantly'", "page 12, paragraph 3, second sentence").
 */

export interface BookPage {
  /** The page number or label printed in the book ("12"), or as typed. */
  label: string
  paragraphs: string[]
  /** The page photo it was read from (file name in the app's data folder), if any. */
  image?: string | null
}

/** Something explained during a session, so it can be reopened ("go back to the previous word"). */
export interface ReadingTarget {
  text: string
  page: number
  paragraph: number
  sentence: number
  at: string
}

export interface ReadingSession {
  id: number
  /** The matching Articles entry (saved words link to it, like words saved from an article). */
  articleId: number
  url: string
  name: string
  bookTitle: string
  author: string
  edition: string
  pages: BookPage[]
  /** Where the learner is: page and paragraph index (0-based). */
  lastPage: number
  lastParagraph: number
  /** Most recent first. */
  history: ReadingTarget[]
  createdAt: string
  updatedAt: string
}

export interface ReadingSessionInput {
  id?: number
  name: string
  bookTitle: string
  author: string
  edition: string
  pages: BookPage[]
}

/** One page photo read into text. */
export interface PageReadResult {
  imageFile: string
  /** The page number printed on the page, when it could be read. */
  label: string | null
  paragraphs: string[]
  engine: 'gemini' | 'windows-ocr'
  /** How many words could not be read (marked [unclear] in the text). */
  unclear: number
  warning: string | null
}

export const UNCLEAR = '[unclear]'
export const BOOK_PREFIX = 'book:'
export const isBook = (url: string | null | undefined): boolean => !!url && url.startsWith(BOOK_PREFIX)

/** "[page 13]" or "--- page 13 ---" on its own line starts a new page in pasted text. */
const PAGE_MARK = /^\s*(?:\[\s*page\s+([^\]]+?)\s*\]|-{2,}\s*page\s+(.+?)\s*-{2,})\s*$/i

/** Joins the printed lines of a paragraph; a word broken with a hyphen at a line end is joined again. */
function joinLines(lines: string[]): string {
  return lines
    .map((l) => l.trim())
    .filter(Boolean)
    .reduce((acc, l) => (!acc ? l : /[a-z]-$/i.test(acc) ? acc.slice(0, -1) + l : `${acc} ${l}`), '')
}

/** Paragraphs of a block of text: separated by blank lines; without blank lines, each line is one. */
export function textToParagraphs(text: string): string[] {
  const t = text.replace(/\r\n?/g, '\n').trim()
  if (!t) return []
  if (/\n\s*\n/.test(t))
    return t
      .split(/\n\s*\n/)
      .map((b) => joinLines(b.split('\n')))
      .filter(Boolean)
  return t
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
}

/** Pasted text → pages (page marks optional; without them it is one page labelled `firstLabel`). */
export function textToPages(text: string, firstLabel = '1'): BookPage[] {
  const pages: { label: string; lines: string[] }[] = []
  let cur = { label: firstLabel.trim() || '1', lines: [] as string[] }
  for (const line of text.replace(/\r\n?/g, '\n').split('\n')) {
    const m = line.match(PAGE_MARK)
    if (m) {
      if (cur.lines.some((l) => l.trim())) pages.push(cur)
      cur = { label: (m[1] ?? m[2]).trim(), lines: [] }
    } else cur.lines.push(line)
  }
  if (cur.lines.some((l) => l.trim())) pages.push(cur)
  return pages.map((p) => ({ label: p.label, paragraphs: textToParagraphs(p.lines.join('\n')) })).filter((p) => p.paragraphs.length)
}

/** One page's paragraphs as editable text (blank line between paragraphs). */
export const pageToText = (p: BookPage): string => p.paragraphs.join('\n\n')

/** Windows OCR gives lines only: a new paragraph starts after a clearly short line that ends a sentence. */
export function ocrLinesToParagraphs(lines: string[]): string[] {
  const clean = lines.map((l) => l.trim()).filter(Boolean)
  if (!clean.length) return []
  const typical = [...clean].map((l) => l.length).sort((a, b) => a - b)[Math.floor(clean.length * 0.7)] ?? 0
  const paras: string[][] = [[]]
  clean.forEach((l, i) => {
    paras[paras.length - 1].push(l)
    const ends = /[.!?:"”’)]$/.test(l)
    if (ends && l.length < typical * 0.75 && i < clean.length - 1) paras.push([])
  })
  return paras.map(joinLines).filter(Boolean)
}

const ABBREV = /\b(?:Mr|Mrs|Ms|Dr|Prof|St|Sr|Jr|vs|etc|e\.g|i\.e|No)\.$/i

/** Sentences of a paragraph (keeps the original text; handles common abbreviations). */
export function splitSentences(paragraph: string): string[] {
  const out: string[] = []
  let start = 0
  const re = /[.!?]+["”’)]*(?=\s+["“‘(]?[A-Z0-9])/g
  let m: RegExpExecArray | null
  while ((m = re.exec(paragraph))) {
    const end = m.index + m[0].length
    const piece = paragraph.slice(start, end)
    if (ABBREV.test(piece.trim())) continue
    out.push(piece.trim())
    start = end
  }
  const rest = paragraph.slice(start).trim()
  if (rest) out.push(rest)
  return out.length ? out : [paragraph.trim()]
}

/** Lower-case words of a text (quotes and punctuation removed; "don't" stays one word). */
export function words(text: string): string[] {
  return (
    text
      .toLowerCase()
      .replace(/[’‘]/g, "'")
      .match(/[a-z0-9]+(?:'[a-z]+)?/g) ?? []
  )
}

function editDistance(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 2) return 3
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)])
  for (let j = 1; j <= b.length; j++) d[0][j] = j
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
  return d[a.length][b.length]
}

/** A word heard by speech recognition may be slightly off ("reluctanly"): close enough for longer words only. */
const close = (heard: string, written: string): boolean =>
  heard === written || (heard.length >= 4 && written.length >= 4 && editDistance(heard, written) <= (Math.max(heard.length, written.length) >= 8 ? 2 : 1))

export interface PassageRef {
  /** Page label as printed ("12"), or its position when no page has that label. */
  page?: string | null
  /** 1-based paragraph on that page. */
  paragraph?: number | null
  /** 1-based sentence in that paragraph. */
  sentence?: number | null
}

export interface PassageMatch {
  page: number
  pageLabel: string
  paragraph: number
  sentence: number
  sentenceText: string
  paragraphText: string
  /** The words as written in the book (original spelling and case). */
  matchText: string
  /** False when found only approximately (speech recognition may have misheard). */
  exact: boolean
}

export interface PassageSearch {
  matches: PassageMatch[]
  /** Why nothing was found, or what was unclear about the reference. */
  note: string | null
}

const MAX_MATCHES = 8

/** The page index for a spoken page label: exact label first, then position ("page 2" = second page). */
export function findPage(pages: BookPage[], label: string): number {
  const l = label.trim().toLowerCase()
  const i = pages.findIndex((p) => p.label.trim().toLowerCase() === l)
  if (i >= 0) return i
  const n = Number(l)
  return Number.isInteger(n) && n >= 1 && n <= pages.length ? n - 1 : -1
}

/** The text of `sentence` as written, for the matched words (keeps the book's spelling and punctuation). */
function originalSpan(sentence: string, from: number, to: number): string {
  const re = /[A-Za-z0-9]+(?:['’][A-Za-z]+)?/g
  const spans: [number, number][] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(sentence))) spans.push([m.index, m.index + m[0].length])
  if (!spans[from] || !spans[to]) return sentence
  return sentence.slice(spans[from][0], spans[to][1])
}

/**
 * Finds what the learner named in the prepared passage.
 *  - With a page / paragraph / sentence reference, the search stays inside it (the sentence itself is
 *    returned when no words are given).
 *  - Words are matched exactly first; if that finds nothing, approximately (misheard words), marked exact: false.
 *  - A long query (a quoted sentence or its beginning) also matches the sentence that contains most of its words.
 */
export function findInPassage(pages: BookPage[], query: string, ref: PassageRef = {}): PassageSearch {
  let pageIdx: number[] = pages.map((_, i) => i)
  if (ref.page != null && String(ref.page).trim()) {
    const p = findPage(pages, String(ref.page))
    if (p < 0) return { matches: [], note: `There is no page ${ref.page} in this passage (pages: ${pages.map((x) => x.label).join(', ')}).` }
    pageIdx = [p]
  }
  const scope: { page: number; paragraph: number; sentence: number; text: string; para: string }[] = []
  for (const p of pageIdx) {
    const paras = pages[p].paragraphs
    let paraIdx = paras.map((_, i) => i)
    if (ref.paragraph != null) {
      if (ref.paragraph < 1 || ref.paragraph > paras.length) return { matches: [], note: `Page ${pages[p].label} has ${paras.length} paragraph${paras.length === 1 ? '' : 's'}.` }
      paraIdx = [ref.paragraph - 1]
    }
    for (const q of paraIdx) {
      const sents = splitSentences(paras[q])
      let sIdx = sents.map((_, i) => i)
      if (ref.sentence != null && ref.paragraph != null) {
        if (ref.sentence < 1 || ref.sentence > sents.length) return { matches: [], note: `That paragraph has ${sents.length} sentence${sents.length === 1 ? '' : 's'}.` }
        sIdx = [ref.sentence - 1]
      }
      for (const s of sIdx) scope.push({ page: p, paragraph: q, sentence: s, text: sents[s], para: paras[q] })
    }
  }
  const make = (x: (typeof scope)[number], matchText: string, exact: boolean): PassageMatch => ({
    page: x.page,
    pageLabel: pages[x.page].label,
    paragraph: x.paragraph,
    sentence: x.sentence,
    sentenceText: x.text,
    paragraphText: x.para,
    matchText,
    exact
  })

  const q = words(query)
  // A reference alone ("page 12, paragraph 3, second sentence") names the sentence (or paragraph) itself.
  if (!q.length) {
    if (ref.paragraph == null) return { matches: [], note: 'Say the word or sentence, or a paragraph number.' }
    if (ref.sentence == null) {
      const first = scope[0]
      return first ? { matches: [{ ...make(first, first.para, true), sentence: -1, sentenceText: first.para }], note: null } : { matches: [], note: null }
    }
    return { matches: scope.slice(0, 1).map((x) => make(x, x.text, true)), note: null }
  }

  const search = (approx: boolean): PassageMatch[] => {
    const found: PassageMatch[] = []
    for (const x of scope) {
      const w = words(x.text)
      for (let i = 0; i + q.length <= w.length; i++) {
        if (q.every((t, k) => (approx ? close(t, w[i + k]) : t === w[i + k]))) {
          found.push(make(x, originalSpan(x.text, i, i + q.length - 1), !approx))
          break
        }
      }
      if (found.length >= MAX_MATCHES) break
    }
    return found
  }
  let matches = search(false)
  if (!matches.length) matches = search(true)
  // A quoted sentence (or its beginning) that wasn't heard word for word: the sentence with most of its words.
  if (!matches.length && q.length >= 4) {
    const scored = scope
      .map((x) => {
        const w = words(x.text)
        const hit = q.filter((t) => w.some((v) => close(t, v))).length / q.length
        return { x, hit }
      })
      .filter((s) => s.hit >= 0.7)
      .sort((a, b) => b.hit - a.hit)
    matches = scored.slice(0, 3).map((s) => make(s.x, s.x.text, false))
  }
  return { matches, note: matches.length ? null : `"${query.trim()}" is not in the prepared passage.` }
}

const ORDINALS: Record<string, number> = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10 }
const num = (s: string): number | null => (/^\d+$/.test(s) ? Number(s) : (ORDINALS[s.toLowerCase()] ?? null))

/**
 * A typed or spoken request about the book → the words to find and the place it names:
 * "page 68, what does inevitable mean?" → { query: "inevitable", ref: { page: "68" } };
 * "I am reading page 12 paragraph 3, explain the second sentence" → { query: "", ref: { page: "12", paragraph: 3, sentence: 2 } }.
 * Quoted words are taken as they are.
 */
export function parseBookRequest(text: string): { query: string; ref: PassageRef } {
  const ref: PassageRef = {}
  let t = ` ${text.replace(/[“”]/g, '"').replace(/[‘’]/g, "'")} `
  const page = t.match(/\bpage\s+(?:number\s+)?([0-9]+[a-z]?|[ivxlc]+)\b/i)
  if (page) ref.page = page[1]
  const para = t.match(/\b(?:paragraph|para)\s+(\d+|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)\b/i) ?? t.match(/\b(\d+(?:st|nd|rd|th)?|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)\s+paragraph\b/i)
  if (para) ref.paragraph = num(para[1].replace(/^(\d+)(?:st|nd|rd|th)$/, '$1'))
  const sent = t.match(/\bsentence\s+(\d+|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)\b/i) ?? t.match(/\b(\d+(?:st|nd|rd|th)?|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)\s+sentence\b/i)
  if (sent) ref.sentence = num(sent[1].replace(/^(\d+)(?:st|nd|rd|th)$/, '$1'))
  const quoted = t.match(/"([^"]+)"/) ?? t.match(/\s'([^']{2,})'\s/)
  if (quoted) return { query: quoted[1].trim(), ref }
  t = t
    .replace(/\b(?:i am|i'm|im)\s+(?:reading|on)\b/gi, ' ')
    .replace(/\bpage\s+(?:number\s+)?([0-9]+[a-z]?|[ivxlc]+)\b/gi, ' ')
    .replace(/\b(?:paragraph|para)\s+\w+\b|\b\w+\s+paragraph\b/gi, ' ')
    .replace(/\bsentence\s+\w+\b|\b\w+\s+sentence\b/gi, ' ')
    .replace(/\b(?:hey\s+)?jarvis\b/gi, ' ')
    .replace(/\b(?:the sentence (?:beginning|starting) with|starting with|beginning with)\b/gi, ' ')
    .replace(/[,.?!:;]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  // Only the command words around the target go ("on the other hand" keeps its "on").
  const LEAD = /^(?:please|can you|could you|tell me|explain|what does|what is|what's|whats|the meaning of|meaning of|(?:the\s+)?(?:word|phrase|expression|idiom))\s+/i
  const TRAIL = /\s+(?:mean|means|please|in this passage|in the passage|on this page|in this book|here)$/i
  for (let prev = ''; prev !== t; ) {
    prev = t
    t = t.replace(LEAD, '').replace(TRAIL, '').trim()
  }
  return { query: /^(?:the|a|an|this|that|it)$/i.test(t) ? '' : t, ref }
}
