import { describe, expect, it } from 'vitest'
import { openDatabase } from '../src/main/db'
import { insertNote } from '../src/main/db/repos/notes'
import { flashcardStats, getFlashcard, insertFlashcard, listDueFlashcards, noteIdsWithoutFlashcards, reviewFlashcard, revisionDashboard } from '../src/main/db/repos/flashcards'
import { isMastered, newRevision, reviewRevision, type RevisionState } from '../src/main/srs/revision'
import {
  buildBlanks,
  buildContextQuestions,
  buildGrammarQuestions,
  buildIdiomTasks,
  buildMatching,
  buildMeaningQuestions,
  buildOrdering,
  checkOrdering,
  checkText,
  diffWords,
  sourceSentences
} from '../src/shared/games'
import type { Note, NoteData, ReviewRating } from '../src/shared/types'

const DAY = 86_400_000
const t0 = new Date('2026-10-01T09:00:00Z')
const days = (s: RevisionState, from: Date): number => Math.round((new Date(s.due).getTime() - from.getTime()) / DAY)
/** Reviews on each due date with the given ratings; returns the day numbers (Day 1 = save day). */
function run(ratings: ReviewRating[]): { dayNumbers: number[]; state: RevisionState } {
  let s = newRevision(t0)
  const dayNumbers = [1]
  for (const r of ratings) {
    const at = new Date(s.due)
    s = reviewRevision(s, r, at)
    dayNumbers.push(Math.round((new Date(s.due).getTime() - t0.getTime()) / DAY) + 1)
  }
  return { dayNumbers, state: s }
}

describe('revision schedule', () => {
  it('default ladder: Day 1 → Day 3 → Day 7, then gaps grow', () => {
    const { dayNumbers } = run([3, 3, 3, 3])
    expect(dayNumbers).toEqual([1, 3, 7, 15, 31])
  })

  it('Again brings the item back in 10 minutes and restarts the ladder; it then grows more slowly', () => {
    const s1 = reviewRevision(newRevision(t0), 1, t0)
    expect(new Date(s1.due).getTime() - t0.getTime()).toBe(10 * 60_000)
    expect([s1.step, s1.lapses]).toEqual([0, 1])
    const remembered = run([3, 3, 3, 3]).state
    const forgotten = run([1, 3, 1, 3, 3, 3, 3]).state
    expect(forgotten.intervalDays).toBeLessThan(remembered.intervalDays)
  })

  it('Difficult gives a short gap without moving up; Easy jumps further', () => {
    const s = newRevision(t0)
    expect(days(reviewRevision(s, 2, t0), t0)).toBe(1)
    expect(reviewRevision(s, 2, t0).step).toBe(0)
    expect(days(reviewRevision(s, 4, t0), t0)).toBeGreaterThan(days(reviewRevision(s, 3, t0), t0))
  })

  it('items remembered again and again become mastered', () => {
    expect(isMastered(run([3, 3, 3, 3]).state)).toBe(false)
    expect(isMastered(run([3, 3, 3, 3, 3]).state)).toBe(true)
  })
})

describe('flashcards from saved items + dashboard', () => {
  it('cards come only from learning items; new cards are due today; review reschedules', () => {
    const db = openDatabase(':memory:')
    const data: NoteData = { meaning_bn: 'হাল ছেড়ে দেওয়া', meaning_en: 'stop trying', vocabulary: [], idioms_phrasal: [], grammar: [{ pattern: 'Imperative', explanation: 'order' }], examples: [{ en: 'Never give up.', bn: 'কখনো হাল ছেড়ো না।' }] }
    const n = insertNote(db, { kind: 'phrasal', text: 'give up', contextSentence: "Don't give up now.", mediaTitle: 'Rocky', timestampSec: 90 }, data)
    insertNote(db, { kind: 'general', text: 'Watch again' }, null)
    insertNote(db, { kind: 'ielts_error', text: 'NG vs F', ieltsRef: 'Q1' }, null)
    expect(noteIdsWithoutFlashcards(db)).toEqual([n.id])
    const now = new Date()
    const card = insertFlashcard(db, n.id, 'give up', { meaning_bn: data.meaning_bn, meaning_en: data.meaning_en, example: '', example_bn: '', note: '' }, now)
    expect(card.source).toMatchObject({ kind: 'phrasal', contextSentence: "Don't give up now.", mediaTitle: 'Rocky', timestampSec: 90, examples: data.examples })
    expect(flashcardStats(db, now).due).toBe(1)
    expect(revisionDashboard(db, now).counts).toMatchObject({ dueToday: 1, overdue: 0, recent: 1, total: 1 })

    const reviewed = reviewFlashcard(db, card.id, 3, now)
    expect(Math.round((new Date(reviewed.due).getTime() - now.getTime()) / DAY)).toBe(2) // Day 3
    expect(listDueFlashcards(db, 50, now)).toHaveLength(0)
    expect(revisionDashboard(db, now).counts.upcoming).toBe(1)

    // Forgotten twice → "Frequently forgotten"; overdue when its date passed.
    reviewFlashcard(db, card.id, 1, now)
    reviewFlashcard(db, card.id, 1, now)
    expect(getFlashcard(db, card.id)!.lapses).toBe(2)
    expect(revisionDashboard(db, now).counts.forgotten).toBe(1)
    expect(revisionDashboard(db, new Date(now.getTime() + 3 * DAY)).counts.overdue).toBe(1)
  })
})

const note = (id: number, kind: Note['kind'], text: string, extra: Partial<Note> = {}): Note => ({
  id,
  kind,
  text,
  contextSentence: null,
  explanationMd: null,
  data: null,
  mediaPath: null,
  mediaTitle: 'Film',
  timestampSec: null,
  promptId: null,
  gdocId: null,
  gdocSyncedAt: null,
  gdocError: null,
  userNote: null,
  createdAt: '2026-10-01T00:00:00Z',
  ...extra
})
const d = (bn: string, en: string, grammar: string[] = []): NoteData => ({ meaning_bn: bn, meaning_en: en, vocabulary: [], idioms_phrasal: [], grammar: grammar.map((p) => ({ pattern: p, explanation: 'x' })), examples: [] })
const NOTES: Note[] = [
  note(1, 'word', 'resilient', { contextSentence: 'The economy proved resilient this year.', data: d('সহনশীল', 'able to recover quickly') }),
  note(2, 'word', 'reluctant', { contextSentence: 'She was reluctant to leave the party.', data: d('অনিচ্ছুক', 'unwilling') }),
  note(3, 'word', 'thrive', { contextSentence: 'Small firms thrive in big cities.', data: d('উন্নতি করা', 'to grow well') }),
  note(4, 'collocation', 'make a decision', { contextSentence: 'We need to make a decision today.', data: d('সিদ্ধান্ত নেওয়া', 'to decide') }),
  note(5, 'phrasal', 'give up', { contextSentence: "Don't give up now.", data: d('হাল ছেড়ে দেওয়া', 'stop trying') }),
  note(6, 'idiom', 'call it a day', { data: d('কাজ শেষ করা', 'stop working') }),
  note(7, 'sentence', 'I would rather stay at home tonight.', { data: d('আমি আজ রাতে বরং বাড়িতে থাকব।', 'prefer', ['would rather + base verb']) }),
  note(8, 'sentence', 'If it rains, we will cancel the trip.', { data: d('বৃষ্টি হলে...', 'condition', ['First conditional']) })
]
const seeded = (): (() => number) => {
  let x = 42
  return () => ((x = (x * 16807) % 2147483647) / 2147483647)
}

describe('games from my own notes', () => {
  it('matching and meaning questions use saved meanings', () => {
    const pairs = buildMatching(NOTES, 5, seeded())
    expect(pairs).toHaveLength(5)
    for (const p of pairs) expect(NOTES.find((n) => n.id === p.id)!.data!.meaning_bn).toBe(p.right)
    const q = buildMeaningQuestions(NOTES, 3, seeded())[0]
    expect(q.options).toHaveLength(4)
    expect(q.options[q.answer]).toBe(NOTES.find((n) => n.id === q.noteId)!.data!.meaning_en)
  })

  it('sentence ordering: shuffled, and each correct position is reported (green)', () => {
    const s = sourceSentences(NOTES).find((x) => x.text.startsWith('I would rather'))!
    const task = buildOrdering(s, seeded())
    expect(task.tiles.map((t) => t.word).join(' ')).not.toBe(s.text)
    expect(checkOrdering(task.correct, task.correct)).toEqual({ correct: true, parts: task.correct.map(() => true) })
    const wrong = ['I', 'rather', 'would', 'stay', 'at', 'home', 'tonight.']
    const r = checkOrdering(wrong, task.correct)
    expect(r.correct).toBe(false)
    expect(r.parts).toEqual([true, false, false, true, true, true, true])
  })

  it('fill in the blanks and idiom completion come from original sentences', () => {
    const b = buildBlanks(NOTES, 5, seeded())
    expect(b.length).toBeGreaterThan(0)
    for (const t of b) {
      const n = NOTES.find((x) => x.id === t.noteId)!
      expect(t.before + t.answer + t.after).toBe(n.contextSentence)
      expect(t.options).toContain(t.answer)
    }
    expect(checkText(' Resilient ', 'resilient')).toBe(true)
    const idioms = buildIdiomTasks(NOTES, 5, seeded())
    const gu = idioms.find((t) => t.noteId === 5)!
    expect([gu.before, gu.answer, gu.after]).toEqual(["Don't give ", 'up', ' now.'])
    const day = idioms.find((t) => t.noteId === 6)!
    expect([day.before, day.answer, day.sentenceIsOriginal]).toEqual(['call it a ', 'day', false])
    expect(day.options).toHaveLength(4)
  })

  it('grammar identification and context quiz', () => {
    const g = buildGrammarQuestions(NOTES, 5, seeded())
    const q = g.find((x) => x.noteId === 8)!
    expect(q.options[q.answer]).toBe('First conditional')
    expect(q.options).toHaveLength(4)
    const c = buildContextQuestions(NOTES, 5, seeded())
    expect(c.every((x) => x.sentence && x.options[x.answer] === NOTES.find((n) => n.id === x.noteId)!.data!.meaning_bn)).toBe(true)
  })

  it('error correction feedback marks right and wrong words', () => {
    const r = diffWords('She go to school yesterday.', 'She went to school yesterday.')
    expect(r.correct).toBe(false)
    expect(r.words.map((w) => w.ok)).toEqual([true, false, true, true, true])
    expect(r.missing).toEqual(['went'])
    expect(diffWords('She went to school yesterday', 'She went to school yesterday.').correct).toBe(true)
  })
})
