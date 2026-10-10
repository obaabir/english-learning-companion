// Flash Sentence Practice: pure logic (no React, no storage).
import { FSP_ERROR_TYPES, type FspCardType, type FspCheckResult, type FspError, type FspErrorType } from '@shared/fsp'

export interface FspCard {
  /** Lower-case term. */
  id: string
  term: string
  type: FspCardType
  meaningBn: string
  example: string
  /** Example written by AI (the doc had none). */
  aiExample?: boolean
}

export interface FspCardState {
  /** Successful climbs so far (index into FSP_RUNGS). */
  box: number
  due: string
  seen: number
}

/** Correct → back in 3, 7, 14, 30 days; wrong → 1 day. */
export const FSP_RUNGS = [3, 7, 14, 30]

/* ------------------------------ Dates ------------------------------ */

export function fspToday(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function fspAddDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number)
  return fspToday(new Date(y, m - 1, d + n))
}

/* --------------------------- Doc import ---------------------------- */

const cleanTerm = (s: string): string =>
  s
    .replace(/^\s*(?:[-*•–]|\d+[.)])\s*/, '')
    .replace(/^["“]|["”]$/g, '')
    .trim()

function toType(raw: string, term: string): FspCardType {
  const t = raw.trim().toLowerCase()
  if (t.startsWith('w')) return 'word'
  if (t.startsWith('i')) return 'idiom'
  if (t.startsWith('p')) return 'phrase'
  return term.trim().includes(' ') ? 'phrase' : 'word'
}

/** Lines like "term | type | Bangla meaning | example sentence". Other lines are skipped. */
export function parseDocText(text: string): FspCard[] {
  const out = new Map<string, FspCard>()
  for (const line of text.split(/\r?\n/)) {
    if (!line.includes('|')) continue
    const parts = line.split('|').map((p) => p.trim())
    const term = cleanTerm(parts[0] ?? '')
    if (!term || /^term$/i.test(term) || /^-+$/.test(term)) continue
    const id = term.toLowerCase()
    out.set(id, {
      id,
      term,
      type: toType(parts[1] ?? '', term),
      meaningBn: parts[2] ?? '',
      example: parts.slice(3).join(' | ').trim()
    })
  }
  return [...out.values()]
}

/** Merges new cards into the old list (same term → updated, keeping an AI example if the doc still has none). */
export function mergeCards(old: FspCard[], incoming: FspCard[]): { cards: FspCard[]; added: number; updated: number } {
  const map = new Map(old.map((c) => [c.id, c]))
  let added = 0
  let updated = 0
  for (const c of incoming) {
    const prev = map.get(c.id)
    if (!prev) added++
    else updated++
    map.set(c.id, prev && !c.example && prev.example ? { ...c, example: prev.example, aiExample: prev.aiExample } : c)
  }
  return { cards: [...map.values()], added, updated }
}

/* ------------------------- Words and forms ------------------------- */

export function fspNormalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[’‘`]/g, "'")
    .replace(/n't\b/g, ' not')
    .replace(/'(m|re|ve|ll|d)\b/g, ' $1')
    .replace(/'s\b/g, " 's")
    .replace(/[-–—/]/g, ' ')
    .replace(/[^a-z0-9'\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const CONTRACTED: Record<string, string> = { m: 'am', re: 'are', ve: 'have', ll: 'will', d: 'would' }

export function fspTokens(s: string): string[] {
  return fspNormalize(s)
    .split(' ')
    .map((t) => (t === "'s" ? t : t.replace(/^'+|'+$/g, '')))
    .map((t) => CONTRACTED[t] ?? t)
    .filter(Boolean)
}

export const wordCount = (s: string): number => s.trim().split(/\s+/).filter((w) => /[a-z0-9]/i.test(w)).length

// Irregular forms (base: other forms).
const IRREGULAR: Record<string, string> = {
  be: "am is are was were been being 's",
  have: "has had having 's",
  do: 'does did done doing',
  go: 'goes went gone going',
  break: 'broke broken',
  get: 'got gotten',
  make: 'made',
  take: 'took taken',
  come: 'came',
  see: 'saw seen',
  know: 'knew known',
  give: 'gave given',
  find: 'found',
  think: 'thought',
  tell: 'told',
  become: 'became',
  leave: 'left',
  feel: 'felt',
  bring: 'brought',
  begin: 'began begun',
  keep: 'kept',
  hold: 'held',
  write: 'wrote written',
  stand: 'stood',
  hear: 'heard',
  mean: 'meant',
  meet: 'met',
  run: 'ran',
  pay: 'paid',
  sit: 'sat',
  speak: 'spoke spoken',
  lie: 'lay lain lied',
  lead: 'led',
  grow: 'grew grown',
  lose: 'lost',
  fall: 'fell fallen',
  send: 'sent',
  build: 'built',
  understand: 'understood',
  draw: 'drew drawn',
  spend: 'spent',
  rise: 'rose risen',
  drive: 'drove driven',
  buy: 'bought',
  wear: 'wore worn',
  choose: 'chose chosen',
  seek: 'sought',
  throw: 'threw thrown',
  catch: 'caught',
  deal: 'dealt',
  win: 'won',
  forget: 'forgot forgotten',
  sell: 'sold',
  fight: 'fought',
  teach: 'taught',
  eat: 'ate eaten',
  sleep: 'slept',
  say: 'said',
  bite: 'bit bitten',
  blow: 'blew blown',
  fly: 'flew flown',
  hide: 'hid hidden',
  ride: 'rode ridden',
  ring: 'rang rung',
  sing: 'sang sung',
  swim: 'swam swum',
  drink: 'drank drunk',
  shake: 'shook shaken',
  steal: 'stole stolen',
  wake: 'woke woken',
  feed: 'fed',
  light: 'lit',
  shoot: 'shot',
  stick: 'stuck',
  strike: 'struck',
  swing: 'swung',
  tear: 'tore torn',
  bear: 'bore born borne',
  beat: 'beaten',
  bend: 'bent',
  bind: 'bound',
  bleed: 'bled',
  burn: 'burnt',
  dig: 'dug',
  dream: 'dreamt',
  forgive: 'forgave forgiven',
  freeze: 'froze frozen',
  hang: 'hung',
  lay: 'laid',
  lend: 'lent',
  mistake: 'mistook mistaken',
  overcome: 'overcame',
  shine: 'shone',
  sink: 'sank sunk',
  slide: 'slid',
  spin: 'spun',
  spring: 'sprang sprung',
  sweep: 'swept',
  weep: 'wept',
  wind: 'wound',
  withdraw: 'withdrew withdrawn',
  show: 'shown',
  can: 'could',
  will: 'would',
  child: 'children',
  man: 'men',
  woman: 'women',
  person: 'people',
  foot: 'feet',
  tooth: 'teeth',
  mouse: 'mice',
  good: 'better best',
  bad: 'worse worst'
}

const IRREGULAR_FORMS = new Map<string, string[]>()
const BASE_OF = new Map<string, string>()
for (const [base, forms] of Object.entries(IRREGULAR)) {
  const list = forms.split(' ')
  IRREGULAR_FORMS.set(base, list)
  for (const f of list) if (f !== "'s") BASE_OF.set(f, base)
}

const VOWEL = /[aeiou]/
const isCvc = (w: string): boolean => w.length >= 3 && w.length <= 5 && !VOWEL.test(w.at(-1)!) && !/[wxy]/.test(w.at(-1)!) && VOWEL.test(w.at(-2)!) && !VOWEL.test(w.at(-3)!)

/** All ordinary forms of a word: go → goes, went, gone, going; try → tries, tried, trying. */
export function wordForms(word: string): Set<string> {
  const base = BASE_OF.get(word) ?? word
  const out = new Set<string>([word, base, ...(IRREGULAR_FORMS.get(base) ?? [])])
  const w = base
  if (w.length < 2) return out
  out.add(w + 's')
  out.add(w + 'es')
  out.add(w + 'ed')
  out.add(w + 'ing')
  out.add(w + 'er')
  out.add(w + 'est')
  out.add(w + 'ly')
  if (w.endsWith('e')) {
    out.add(w + 'd')
    out.add(w + 'r')
    out.add(w + 'st')
    if (!w.endsWith('ee')) out.add(w.slice(0, -1) + 'ing')
  }
  if (w.endsWith('ie')) out.add(w.slice(0, -2) + 'ying')
  if (/[^aeiou]y$/.test(w)) {
    const stem = w.slice(0, -1)
    out.add(stem + 'ies')
    out.add(stem + 'ied')
    out.add(stem + 'ier')
    out.add(stem + 'iest')
    out.add(stem + 'ily')
  }
  if (w.endsWith('f')) out.add(w.slice(0, -1) + 'ves')
  if (w.endsWith('fe')) out.add(w.slice(0, -2) + 'ves')
  if (isCvc(w)) {
    const last = w.at(-1)!
    out.add(w + last + 'ed')
    out.add(w + last + 'ing')
    out.add(w + last + 'er')
  }
  return out
}

const POSSESSIVE = new Set(['my', 'your', 'his', 'her', 'its', 'our', 'their', "one's", "someone's", "somebody's"])
const REFLEXIVE = new Set(['myself', 'yourself', 'himself', 'herself', 'itself', 'ourselves', 'yourselves', 'themselves', 'oneself'])
const SLOT = new Set(['someone', 'somebody', 'something', 'sb', 'sth', 'smb', 'smth', 'one', 'somewhere', 'x', 'y'])
const MAX_GAP = 2
const MAX_SLOT = 4

type TermTok = { kind: 'word'; forms: Set<string> } | { kind: 'poss' } | { kind: 'refl' } | { kind: 'slot' }

function termPattern(term: string): TermTok[] {
  const toks = fspTokens(term.replace(/[()[\]]/g, ' '))
  if (toks.length > 1 && toks[0] === 'to') toks.shift()
  const pat: TermTok[] = []
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i]
    // "someone 's" → a possessive slot
    if (SLOT.has(t) && toks[i + 1] === "'s") {
      pat.push({ kind: 'poss' })
      i++
    } else if (POSSESSIVE.has(t)) pat.push({ kind: 'poss' })
    else if (REFLEXIVE.has(t)) pat.push({ kind: 'refl' })
    else if (SLOT.has(t)) pat.push({ kind: 'slot' })
    else if (t !== "'s") pat.push({ kind: 'word', forms: wordForms(t) })
  }
  return pat
}

function matchFrom(pat: TermTok[], pi: number, st: string[], si: number, first: boolean): boolean {
  if (pi >= pat.length) return true
  const p = pat[pi]
  const gaps = first ? 0 : MAX_GAP
  for (let g = 0; g <= gaps && si + g <= st.length; g++) {
    const at = si + g
    if (p.kind === 'slot') {
      for (let n = 0; n <= MAX_SLOT && at + n <= st.length; n++) if (matchFrom(pat, pi + 1, st, at + n, n === 0 && first)) return true
      continue
    }
    if (at >= st.length) break
    const tok = st[at]
    if (p.kind === 'word' && p.forms.has(tok) && matchFrom(pat, pi + 1, st, at + 1, false)) return true
    if (p.kind === 'refl' && REFLEXIVE.has(tok) && matchFrom(pat, pi + 1, st, at + 1, false)) return true
    if (p.kind === 'poss') {
      if (POSSESSIVE.has(tok) && matchFrom(pat, pi + 1, st, at + 1, false)) return true
      if (st[at + 1] === "'s" && matchFrom(pat, pi + 1, st, at + 2, false)) return true
    }
  }
  return false
}

/** Does the sentence use the term, allowing normal forms (go/went/going; broke the ice; figure it out)? */
export function usesTerm(sentence: string, term: string): boolean {
  const pat = termPattern(term)
  if (!pat.some((p) => p.kind === 'word')) return true
  const st = fspTokens(sentence)
  for (let i = 0; i < st.length; i++) if (matchFrom(pat, 0, st, i, true)) return true
  return false
}

/** Share of the sentence copied from the example (the term's own words don't count). */
export function copyRatio(sentence: string, example: string, term: string): number {
  if (!example.trim()) return 0
  const a = fspNormalize(sentence)
  const b = fspNormalize(example)
  if (a && a === b) return 1
  const termWords = new Set<string>()
  for (const t of fspTokens(term)) for (const f of wordForms(t)) termWords.add(f)
  const mine = fspTokens(sentence).filter((t) => !termWords.has(t))
  const theirs = fspTokens(example).filter((t) => !termWords.has(t))
  if (!mine.length || !theirs.length) return 0
  const pool = new Map<string, number>()
  for (const t of theirs) pool.set(t, (pool.get(t) ?? 0) + 1)
  let common = 0
  for (const t of mine) {
    const n = pool.get(t) ?? 0
    if (n > 0) {
      common++
      pool.set(t, n - 1)
    }
  }
  const ofMine = mine.length >= 3 ? common / mine.length : 0
  const ofTheirs = theirs.length >= 3 ? common / theirs.length : 0
  return Math.max(ofMine, ofTheirs)
}

export const MIN_WORDS = 4
export const COPY_LIMIT = 0.7

/** Instant local checks before any AI call. reason is null when the sentence may be sent. */
export function localCheck(sentence: string, card: FspCard): { ok: boolean; reason: string | null } {
  if (!sentence.trim()) return { ok: false, reason: null }
  if (!usesTerm(sentence, card.term)) return { ok: false, reason: `Use “${card.term}” in your sentence (any form is fine).` }
  if (copyRatio(sentence, card.example, card.term) >= COPY_LIMIT) return { ok: false, reason: 'Make your own sentence.' }
  if (wordCount(sentence) < MIN_WORDS) return { ok: false, reason: `Write at least ${MIN_WORDS} words.` }
  return { ok: true, reason: null }
}

/* ------------------------- Levels and hints ------------------------ */

export interface FspLevel {
  n: number
  name: string
  ask: string
  frame: (term: string) => string
}

export const FSP_LEVELS: FspLevel[] = [
  { n: 1, name: 'Simple sentence', ask: 'Write a simple sentence.', frame: (t) => `Subject + ${t} + …` },
  { n: 2, name: 'Add an adverb', ask: 'Add an adverb of time, place or manner (yesterday, at home, slowly…).', frame: (t) => `Subject + ${t} + … + yesterday / at home / quickly` },
  { n: 3, name: 'Relative clause', ask: 'Use a relative clause with who / which / that.', frame: (t) => `The person who … + ${t} + …` },
  { n: 4, name: 'Question or negative', ask: 'Make it a question or a negative.', frame: (t) => `Did you ${t} …?   /   I didn't ${t} …` },
  { n: 5, name: 'Noun clause', ask: 'Use a noun clause (that / what / whether…).', frame: (t) => `I think that + subject + ${t} + …` }
]

export const FSP_CONTEXTS = ['your family', 'Dhaka', 'your exams', 'a friend', 'your studies or work', 'food you like', 'a rainy day', 'your phone']

/** Auto level: 3 correct sentences in a row raise the level (max 5). */
export function nextAutoLevel(level: number, streak: number): { level: number; streak: number } {
  if (streak >= 3 && level < 5) return { level: level + 1, streak: 0 }
  return { level, streak }
}

/* ---------------------------- Schedule ----------------------------- */

export function scheduleCard(prev: FspCardState | undefined, correctFirstTry: boolean, today: string): FspCardState {
  const seen = (prev?.seen ?? 0) + 1
  if (!correctFirstTry) return { box: 0, due: fspAddDays(today, 1), seen }
  const box = prev?.box ?? 0
  return { box: box + 1, due: fspAddDays(today, FSP_RUNGS[Math.min(box, FSP_RUNGS.length - 1)]), seen }
}

/** Due cards first (oldest due first), then new cards in import order. */
export function dueCards(cards: FspCard[], states: Record<string, FspCardState>, today: string, filter: FspCardType | 'all'): FspCard[] {
  const list = cards.filter((c) => filter === 'all' || c.type === filter)
  const due = list.filter((c) => states[c.id] && states[c.id].due <= today).sort((a, b) => states[a.id].due.localeCompare(states[b.id].due))
  const fresh = list.filter((c) => !states[c.id])
  return [...due, ...fresh]
}

/* --------------------------- AI result ----------------------------- */

const str = (v: unknown): string => (typeof v === 'string' ? v : '')

/** Safe parse of the AI JSON. Throws if it doesn't look like a check result. */
export function sanitizeCheck(raw: unknown, sentence: string): FspCheckResult {
  if (!raw || typeof raw !== 'object') throw new Error('bad result')
  const r = raw as Record<string, unknown>
  if (r.status !== 'correct' && r.status !== 'wrong') throw new Error('bad status')
  const errors: FspError[] = (Array.isArray(r.errors) ? r.errors : [])
    .filter((e): e is Record<string, unknown> => !!e && typeof e === 'object')
    .map((e) => ({
      type: (FSP_ERROR_TYPES as string[]).includes(str(e.type)) ? (e.type as FspErrorType) : 'word_order',
      wrongText: str(e.wrongText),
      fix: str(e.fix),
      ruleBangla: str(e.ruleBangla)
    }))
  const usesTargetCorrectly = r.usesTargetCorrectly !== false
  if (!usesTargetCorrectly && !errors.some((e) => e.type === 'target_use')) {
    errors.push({ type: 'target_use', wrongText: '', fix: '', ruleBangla: str(r.optionalTip) || 'শব্দ/ফ্রেজটির অর্থ অনুযায়ী ব্যবহার করুন।' })
  }
  return {
    status: r.status === 'correct' && errors.length === 0 ? 'correct' : 'wrong',
    usesTargetCorrectly,
    challengeMet: r.challengeMet !== false,
    errors,
    corrected: str(r.corrected).trim() || sentence,
    optionalTip: str(r.optionalTip)
  }
}

/** Splits the sentence into plain and wrong parts for highlighting. */
export function highlightParts(sentence: string, errors: FspError[]): { text: string; wrong: boolean }[] {
  const marks: [number, number][] = []
  const lower = sentence.toLowerCase()
  for (const e of errors) {
    const w = e.wrongText.trim().toLowerCase()
    if (!w) continue
    const i = lower.indexOf(w)
    if (i >= 0 && !marks.some(([a, b]) => i < b && i + w.length > a)) marks.push([i, i + w.length])
  }
  marks.sort((a, b) => a[0] - b[0])
  const out: { text: string; wrong: boolean }[] = []
  let at = 0
  for (const [a, b] of marks) {
    if (a > at) out.push({ text: sentence.slice(at, a), wrong: false })
    out.push({ text: sentence.slice(a, b), wrong: true })
    at = b
  }
  if (at < sentence.length) out.push({ text: sentence.slice(at), wrong: false })
  return out
}

/* --------------------------- Error Radar --------------------------- */

export const FSP_ERROR_LABEL: Record<FspErrorType, { en: string; bn: string }> = {
  word_order: { en: 'Word order', bn: 'শব্দের ক্রম' },
  subject_verb_agreement: { en: 'Subject–verb agreement', bn: 'কর্তা-ক্রিয়ার মিল' },
  tense: { en: 'Tense', bn: 'কাল (Tense)' },
  article: { en: 'Articles (a / an / the)', bn: 'Article' },
  preposition: { en: 'Prepositions', bn: 'Preposition' },
  noun_phrase: { en: 'Noun phrase', bn: 'Noun phrase' },
  noun_clause: { en: 'Noun clause', bn: 'Noun clause' },
  adverb: { en: 'Adverbs (time / place / manner)', bn: 'Adverb' },
  relative_clause: { en: 'Relative clause', bn: 'Relative clause' },
  target_use: { en: 'Using the target word/idiom', bn: 'শব্দ/ইডিয়মের সঠিক ব্যবহার' }
}

export interface FspErrorLog {
  type: FspErrorType
  date: string
  wrong: string
  fix: string
}

/** "Your top 3 mistakes this week". */
export function topMistakes(log: FspErrorLog[], today: string, n = 3): { type: FspErrorType; count: number }[] {
  const from = fspAddDays(today, -6)
  const counts = new Map<FspErrorType, number>()
  for (const e of log) if (e.date >= from && e.date <= today) counts.set(e.type, (counts.get(e.type) ?? 0) + 1)
  return [...counts.entries()]
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, n)
}

/** Lenient answer check for fix-it items (case, punctuation and spacing ignored). */
export const sameSentence = (a: string, b: string): boolean => fspTokens(a).join(' ') === fspTokens(b).join(' ')
