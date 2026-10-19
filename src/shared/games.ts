import type { Note, NoteKind } from './types'
import { IDIOM_TERM_KINDS, isTargetLike, normTerm, originalSentence, targetMeaning, TERM_KINDS } from './vocab'

/** The ten practice modes, all built from the learner's own saved notes. */
export type GameMode = 'vocab-match' | 'meaning-match' | 'ordering' | 'blanks' | 'choose' | 'idiom' | 'grammar' | 'error' | 'write' | 'context'

export const GAME_MODES: { mode: GameMode; title: string; description: string; ai?: boolean }[] = [
  { mode: 'vocab-match', title: 'Vocabulary matching', description: 'Match your saved words with their Bangla meanings.' },
  { mode: 'meaning-match', title: 'Word to meaning', description: 'Pick the English meaning of a saved word.' },
  { mode: 'ordering', title: 'Sentence ordering', description: 'Put the words of a saved sentence back in order.' },
  { mode: 'blanks', title: 'Fill in the blanks', description: 'Complete a saved sentence with the missing word.' },
  { mode: 'choose', title: 'Choose the correct sentence', description: 'Find your saved sentence among AI-made wrong versions.', ai: true },
  { mode: 'idiom', title: 'Idiom completion', description: 'Complete your saved idioms and phrasal verbs.' },
  { mode: 'grammar', title: 'Grammar identification', description: 'Which grammar structure does this sentence use?' },
  { mode: 'error', title: 'Error correction', description: 'Correct an AI-made wrong version of a saved sentence.', ai: true },
  { mode: 'write', title: 'Write your own sentence', description: 'Use a saved word, idiom or structure in your own sentence.', ai: true },
  { mode: 'context', title: 'Context quiz', description: 'What does the word mean in its original sentence?' }
]

export const VOCAB_KINDS: NoteKind[] = ['word', 'phrase', 'collocation']
export const IDIOM_KINDS: NoteKind[] = ['idiom', 'phrasal']
/** Small words that may be offered as extra choices (the rest always comes from the learner's notes). */
const BASIC_PARTICLES = ['up', 'out', 'off', 'on', 'in', 'down', 'away', 'over', 'back', 'through']
const BASIC_PATTERNS = [
  'Present simple',
  'Past simple',
  'Present perfect',
  'Passive voice',
  'Conditional (if-clause)',
  'Relative clause',
  'Modal verb (can / should / must)',
  'Comparative'
]

/**
 * The vocabulary view of the learning collection, for the vocabulary games: each item becomes its
 * word/phrase to learn (the same target its flashcard shows) with that word's meaning and the original
 * sentence as context. So a phrasal verb found inside a saved movie line is practised too. The same
 * word with the same meaning appears once.
 */
export function asVocabNotes(notes: Note[]): Note[] {
  const seen = new Set<string>()
  const out: Note[] = []
  for (const n of notes) {
    if (!TERM_KINDS.includes(n.kind) && n.kind !== 'sentence') continue
    const term = (n.target ?? (TERM_KINDS.includes(n.kind) ? n.text : null))?.trim()
    if (!term || !isTargetLike(term)) continue
    const m = targetMeaning({ ...n, target: term })
    const key = `${normTerm(term)}|${normTerm(m.bn)}`
    if (seen.has(key)) continue
    seen.add(key)
    const fromIdioms = (n.data?.idioms_phrasal ?? []).some((t) => normTerm(t.term) === normTerm(term))
    const kind: NoteKind = TERM_KINDS.includes(n.kind) ? n.kind : fromIdioms || IDIOM_TERM_KINDS.includes(n.kind) ? 'idiom' : words(term).length > 1 ? 'phrase' : 'word'
    out.push({
      ...n,
      kind,
      text: term,
      contextSentence: originalSentence(n),
      data: n.data ? { ...n.data, meaning_bn: m.bn, meaning_en: m.en } : null
    })
  }
  return out
}

export type Rand = () => number

export function shuffle<T>(items: T[], rand: Rand = Math.random): T[] {
  const a = [...items]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

export const norm = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[“”"‘’'`]/g, "'")
    .replace(/[.,!?;:()…]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

export const words = (s: string): string[] => s.trim().split(/\s+/).filter(Boolean)

/** A sentence from the learner's notes: original text with where it came from. */
export interface SourceSentence {
  noteId: number
  text: string
  source: string | null
  note: Note
}

/** Original sentences in the notes (saved sentences/structures and the sentences items were saved from). */
export function sourceSentences(notes: Note[]): SourceSentence[] {
  const seen = new Set<string>()
  const out: SourceSentence[] = []
  const add = (text: string | null, note: Note): void => {
    const t = text?.replace(/\s+/g, ' ').trim()
    if (!t) return
    const n = words(t).length
    if (n < 4 || n > 22 || seen.has(norm(t))) return
    seen.add(norm(t))
    out.push({ noteId: note.id, text: t, source: note.mediaTitle, note })
  }
  for (const n of notes) if (n.kind === 'sentence' || n.kind === 'structure') add(n.text, n)
  for (const n of notes) add(n.contextSentence, n)
  return out
}

/** What the learner's note says about an item (for "why" explanations). */
export function noteExplanation(note: Note): { meaningBn: string; meaningEn: string; grammar: string[] } {
  return {
    meaningBn: note.data?.meaning_bn ?? '',
    meaningEn: note.data?.meaning_en ?? '',
    grammar: (note.data?.grammar ?? []).map((g) => `${g.pattern} — ${g.explanation}`)
  }
}

// ---- 1. Vocabulary matching (word ↔ Bangla meaning)
export interface MatchPair {
  id: number
  left: string
  right: string
}
export function buildMatching(notes: Note[], count = 5, rand: Rand = Math.random): MatchPair[] {
  const usable = notes.filter((n) => [...VOCAB_KINDS, ...IDIOM_KINDS].includes(n.kind) && n.data?.meaning_bn?.trim())
  const uniqueMeaning = new Map<string, Note>()
  for (const n of usable) if (!uniqueMeaning.has(n.data!.meaning_bn.trim())) uniqueMeaning.set(n.data!.meaning_bn.trim(), n)
  return shuffle([...uniqueMeaning.values()], rand)
    .slice(0, count)
    .map((n) => ({ id: n.id, left: n.text, right: n.data!.meaning_bn.trim() }))
}

// ---- multiple choice (word → English meaning; context quiz; grammar identification)
export interface ChoiceQuestion {
  noteId: number
  prompt: string
  /** The original sentence shown with the question, if any. */
  sentence: string | null
  /** Word to highlight inside the sentence. */
  highlight: string | null
  options: string[]
  answer: number
}

function choiceFrom(noteId: number, prompt: string, correct: string, pool: string[], rand: Rand, extra: string[] = [], sentence: string | null = null, highlight: string | null = null): ChoiceQuestion | null {
  const others = shuffle([...new Set(pool.filter((p) => norm(p) !== norm(correct)))], rand)
  const fill = shuffle(extra.filter((p) => norm(p) !== norm(correct) && !others.some((o) => norm(o) === norm(p))), rand)
  const wrong = [...others, ...fill].slice(0, 3)
  if (wrong.length < 3) return null
  const options = shuffle([correct, ...wrong], rand)
  return { noteId, prompt, sentence, highlight, options, answer: options.indexOf(correct) }
}

export function buildMeaningQuestions(notes: Note[], count = 5, rand: Rand = Math.random): ChoiceQuestion[] {
  const usable = notes.filter((n) => [...VOCAB_KINDS, ...IDIOM_KINDS].includes(n.kind) && n.data?.meaning_en?.trim())
  const pool = usable.map((n) => n.data!.meaning_en.trim())
  return shuffle(usable, rand)
    .map((n) => choiceFrom(n.id, `What does “${n.text}” mean?`, n.data!.meaning_en.trim(), pool, rand))
    .filter((q): q is ChoiceQuestion => !!q)
    .slice(0, count)
}

/** 10. What does the word mean in its original sentence (Bangla meanings as choices). */
export function buildContextQuestions(notes: Note[], count = 5, rand: Rand = Math.random): ChoiceQuestion[] {
  const withMeaning = notes.filter((n) => [...VOCAB_KINDS, ...IDIOM_KINDS].includes(n.kind) && n.data?.meaning_bn?.trim())
  const pool = withMeaning.map((n) => n.data!.meaning_bn.trim())
  return shuffle(
    withMeaning.filter((n) => n.contextSentence && norm(n.contextSentence).includes(norm(n.text))),
    rand
  )
    .map((n) => choiceFrom(n.id, `What does “${n.text}” mean in this sentence?`, n.data!.meaning_bn.trim(), pool, rand, [], n.contextSentence, n.text))
    .filter((q): q is ChoiceQuestion => !!q)
    .slice(0, count)
}

/** 7. Which grammar structure does the sentence use (from the grammar saved with each note). */
export function buildGrammarQuestions(notes: Note[], count = 5, rand: Rand = Math.random): ChoiceQuestion[] {
  const withGrammar = notes.filter((n) => n.data?.grammar?.length && (n.contextSentence || words(n.text).length >= 4))
  const pool = withGrammar.flatMap((n) => n.data!.grammar.map((g) => g.pattern.trim()))
  return shuffle(withGrammar, rand)
    .map((n) => {
      const sentence = words(n.text).length >= 4 ? n.text : n.contextSentence!
      return choiceFrom(n.id, 'Which grammar structure does this sentence use?', n.data!.grammar[0].pattern.trim(), pool, rand, BASIC_PATTERNS, sentence)
    })
    .filter((q): q is ChoiceQuestion => !!q)
    .slice(0, count)
}

// ---- 3. Sentence ordering
export interface OrderingTask {
  noteId: number
  correct: string[]
  /** Shuffled tiles; ids keep repeated words apart. */
  tiles: { id: number; word: string }[]
  source: SourceSentence
}
export function buildOrdering(s: SourceSentence, rand: Rand = Math.random): OrderingTask {
  const correct = words(s.text)
  let tiles = correct.map((word, id) => ({ id, word }))
  for (let i = 0; i < 5; i++) {
    tiles = shuffle(tiles, rand)
    if (tiles.some((t, k) => t.id !== k)) break
  }
  return { noteId: s.noteId, correct, tiles, source: s }
}

/** Each position: right word in the right place (green) or not. */
export function checkOrdering(answer: string[], correct: string[]): { correct: boolean; parts: boolean[] } {
  const parts = correct.map((w, i) => answer[i] !== undefined && norm(answer[i]) === norm(w))
  return { correct: answer.length === correct.length && parts.every(Boolean), parts }
}

// ---- 4. Fill in the blanks / 6. Idiom completion
export interface BlankTask {
  noteId: number
  before: string
  after: string
  answer: string
  options: string[]
  /** Shown when there is no original sentence (e.g. just the idiom). */
  hint: string | null
  sentenceIsOriginal: boolean
}

function blankIn(sentence: string, target: string): { before: string; after: string; found: string } | null {
  const i = sentence.toLowerCase().indexOf(target.toLowerCase())
  if (i < 0) return null
  return { before: sentence.slice(0, i), after: sentence.slice(i + target.length), found: sentence.slice(i, i + target.length) }
}

export function buildBlanks(notes: Note[], count = 5, rand: Rand = Math.random): BlankTask[] {
  const vocab = notes.filter((n) => VOCAB_KINDS.includes(n.kind))
  const pool = vocab.map((n) => n.text.trim())
  const out: BlankTask[] = []
  for (const n of shuffle(vocab, rand)) {
    const b = n.contextSentence ? blankIn(n.contextSentence, n.text.trim()) : null
    if (!b) continue
    const others = shuffle(pool.filter((p) => norm(p) !== norm(b.found)), rand).slice(0, 3)
    if (others.length < 1) continue
    out.push({ noteId: n.id, before: b.before, after: b.after, answer: b.found, options: shuffle([b.found, ...others], rand), hint: n.data?.meaning_bn ?? null, sentenceIsOriginal: true })
    if (out.length >= count) break
  }
  return out
}

/** The last word of each idiom / phrasal verb is hidden (in its original sentence when saved with one). */
export function buildIdiomTasks(notes: Note[], count = 5, rand: Rand = Math.random): BlankTask[] {
  const idioms = notes.filter((n) => IDIOM_KINDS.includes(n.kind) && words(n.text).length >= 2)
  const lastWords = idioms.map((n) => words(n.text).at(-1)!.replace(/[.,!?]+$/, ''))
  const out: BlankTask[] = []
  for (const n of shuffle(idioms, rand)) {
    const parts = words(n.text)
    const answer = parts.at(-1)!.replace(/[.,!?]+$/, '')
    const inSentence = n.contextSentence ? blankIn(n.contextSentence, n.text.trim()) : null
    const options = shuffle([answer, ...shuffle(lastWords.filter((w) => norm(w) !== norm(answer)), rand).slice(0, 3)], rand)
    for (const p of BASIC_PARTICLES) if (options.length < 4 && !options.some((o) => norm(o) === p)) options.push(p)
    if (inSentence) {
      const shown = inSentence.found.slice(0, inSentence.found.toLowerCase().lastIndexOf(answer.toLowerCase()))
      out.push({ noteId: n.id, before: inSentence.before + shown, after: inSentence.after, answer, options: shuffle(options, rand), hint: n.data?.meaning_bn ?? null, sentenceIsOriginal: true })
    } else {
      out.push({ noteId: n.id, before: parts.slice(0, -1).join(' ') + ' ', after: '', answer, options: shuffle(options, rand), hint: n.data?.meaning_bn ?? null, sentenceIsOriginal: false })
    }
    if (out.length >= count) break
  }
  return out
}

export function checkText(answer: string, expected: string): boolean {
  return norm(answer) === norm(expected)
}

/**
 * Word-by-word comparison of the learner's sentence with the correct one: each word of the answer is
 * marked right or wrong, plus the correct words that are missing.
 */
export function diffWords(answer: string, expected: string): { words: { word: string; ok: boolean }[]; missing: string[]; correct: boolean } {
  const a = words(answer)
  const e = words(expected)
  const A = a.map(norm)
  const E = e.map(norm)
  const dp = Array.from({ length: a.length + 1 }, () => new Array<number>(e.length + 1).fill(0))
  for (let i = a.length - 1; i >= 0; i--) for (let j = e.length - 1; j >= 0; j--) dp[i][j] = A[i] === E[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
  const ok = new Array<boolean>(a.length).fill(false)
  const used = new Array<boolean>(e.length).fill(false)
  for (let i = 0, j = 0; i < a.length && j < e.length; ) {
    if (A[i] === E[j]) {
      ok[i] = true
      used[j] = true
      i++
      j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) i++
    else j++
  }
  return { words: a.map((word, i) => ({ word, ok: ok[i] })), missing: e.filter((_, j) => !used[j]), correct: checkText(answer, expected) }
}

/** Items for "Write your own sentence": saved words, idioms, phrasal verbs, collocations and structures. */
export function writingTargets(notes: Note[]): Note[] {
  return notes.filter((n) => [...VOCAB_KINDS, ...IDIOM_KINDS, 'structure', 'grammar'].includes(n.kind) && words(n.text).length <= 12)
}
