import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDatabase } from '../src/main/db'
import { listNotes } from '../src/main/db/repos/notes'
import { listFlashcards, insertFlashcard } from '../src/main/db/repos/flashcards'
import { insertNote } from '../src/main/db/repos/notes'
import { listDocTargets } from '../src/main/db/repos/settings'
import {
  applyEnrichment,
  createBook,
  dashboard,
  editItem,
  getItem,
  importItems,
  listItems,
  listMistakes,
  mistakeReview,
  recordAnswer,
  sessionFor,
  updateBook
} from '../src/main/db/repos/vocabBook'
import { createVocabBook, vbDocEntry, windowsOcr } from '../src/main/vocabBook/service'
import { blankSentence, buildTasks, draftsFromOcrLines, isVbMastered, markDuplicates, parseWordList, pickDistractors, sentenceWith, vbStatus, type VbAnswer } from '../src/shared/vocabBook'

const DAY = 86_400_000
const at = (base: Date, days: number, hours = 0): Date => new Date(base.getTime() + days * DAY + hours * 3_600_000)
const T0 = new Date('2026-10-20T09:00:00')

describe('reading lists, OCR lines and passages', () => {
  it('pasted / typed lists: numbering and bullets removed, optional meaning, order kept', () => {
    expect(parseWordList('1. abundant | প্রচুর\n2) set off - রওনা হওয়া\n• in the long run: শেষ পর্যন্ত\n\nfrugal')).toEqual([
      { term: 'abundant', meaningBn: 'প্রচুর' },
      { term: 'set off', meaningBn: 'রওনা হওয়া' },
      { term: 'in the long run', meaningBn: 'শেষ পর্যন্ত' },
      { term: 'frugal' }
    ])
  })

  it('OCR lines: the page heading becomes the page reference; every word is marked to check', () => {
    const r = draftsFromOcrLines(['Unit 7 - Page 42', '1. abundant', '2. benevolent', '3. candid'])
    expect(r.pageRef).toBe('Unit 7 - Page 42')
    expect(r.drafts.map((d) => [d.term, d.uncertain])).toEqual([
      ['abundant', true],
      ['benevolent', true],
      ['candid', true]
    ])
  })

  it('duplicates (already in the book, or repeated in the list) are marked', () => {
    expect(markDuplicates([{ term: 'Candid' }, { term: 'frugal' }, { term: 'frugal' }], [{ term: 'candid', seq: 3 }]).map((d) => d.duplicateOf)).toEqual([3, null, 0])
  })

  it('a word keeps the sentence of the passage it came from; blanks work with simple word forms', () => {
    const story = 'The village was poor. Yet the old farmer was remarkably frugal. He saved every coin.'
    expect(sentenceWith(story, 'frugal')).toBe('Yet the old farmer was remarkably frugal.')
    expect(blankSentence('She set off early and arrived late.', 'set off')).toBe('She _____ early and arrived late.')
    expect(blankSentence('He worked diligently.', 'diligent')).toBeNull() // another word, not a form of it
  })
})

describe('a book: words in order, daily limit, sessions', () => {
  it('numbers words in the order supplied, continues after earlier imports, skips repeats', () => {
    const db = openDatabase(':memory:')
    const b = createBook(db, 'Word Power')
    importItems(db, { bookId: b.id, kind: 'pasted', drafts: parseWordList('abundant\nbenevolent\ncandid') })
    const r = importItems(db, { bookId: b.id, kind: 'manual', drafts: [{ term: 'diligent' }, { term: 'Candid' }, { term: 'eloquent' }] })
    expect(r.skipped).toEqual(['Candid'])
    expect(listItems(db, b.id).map((i) => `${i.seq}:${i.term}`)).toEqual(['1:abundant', '2:benevolent', '3:candid', '4:diligent', '5:eloquent'])
  })

  it('daily session: the next N new words in order + every revision due; a learned word is never new again', () => {
    const db = openDatabase(':memory:')
    const b = createBook(db, 'B', 10)
    importItems(db, { bookId: b.id, kind: 'pasted', drafts: Array.from({ length: 25 }, (_, i) => ({ term: `word${i + 1}` })) })
    let s = sessionFor(db, b.id, T0)
    expect(s.newItems.map((i) => i.seq)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    expect(s.reviewItems).toHaveLength(0)
    // Learn 4 today; the rest of today's target is the next 6.
    for (const it of s.newItems.slice(0, 4)) recordAnswer(db, ans(it.id, 'new', true, 3), T0)
    s = sessionFor(db, b.id, at(T0, 0, 2))
    expect(s.newItems.map((i) => i.seq)).toEqual([5, 6, 7, 8, 9, 10])
    expect(dashboard(db, b.id, at(T0, 0, 2))).toMatchObject({ newToday: 4, remainingNewToday: 6, dueNow: 0, nextSeq: 5 })
    // 5 per day from now on.
    updateBook(db, b.id, { dailyNew: 5 })
    expect(sessionFor(db, b.id, at(T0, 0, 2)).newItems).toHaveLength(1)
    // Tomorrow: 5 new (from word 5) + the 4 learned yesterday are due (Day 1).
    s = sessionFor(db, b.id, at(T0, 1))
    expect(s.newItems.map((i) => i.seq)).toEqual([5, 6, 7, 8, 9])
    expect(s.reviewItems.map((i) => i.seq)).toEqual([1, 2, 3, 4])
  })
})

const ans = (itemId: number, kind: VbAnswer['kind'], correct: boolean, rating: 1 | 2 | 3 | 4, extra: Partial<VbAnswer> = {}): VbAnswer => ({
  itemId,
  kind,
  mode: 'mcq',
  correct,
  rating,
  question: 'What does “frugal” mean?',
  answer: correct ? 'মিতব্যয়ী' : 'উদার',
  correctAnswer: 'মিতব্যয়ী',
  errorType: 'wrong_meaning',
  ...extra
})

describe('revision schedule: Day 1, Day 4, Day 7 after the learning day', () => {
  it('remembered each time: reviews on Day 1, 4, 7, then longer gaps', () => {
    const db = openDatabase(':memory:')
    const b = createBook(db, 'B')
    const [it] = importItems(db, { bookId: b.id, kind: 'manual', drafts: [{ term: 'frugal' }] }).added
    const days = (iso: string | null): number => Math.round((new Date(iso!).getTime() - T0.getTime()) / DAY)
    let r = recordAnswer(db, ans(it.id, 'new', true, 3), T0).item
    expect(days(r.due)).toBe(1)
    r = recordAnswer(db, ans(it.id, 'review', true, 3), at(T0, 1)).item
    expect(days(r.due)).toBe(4)
    r = recordAnswer(db, ans(it.id, 'review', true, 3), at(T0, 4)).item
    expect(days(r.due)).toBe(7)
    r = recordAnswer(db, ans(it.id, 'review', true, 3), at(T0, 7)).item
    expect(days(r.due)).toBe(21)
    // Reviewed a day late: Day 4 is still counted from the learning day (not pushed to day 5 + 3).
    const [late] = importItems(db, { bookId: b.id, kind: 'manual', drafts: [{ term: 'candid' }] }).added
    recordAnswer(db, ans(late.id, 'new', true, 3), T0)
    expect(days(recordAnswer(db, ans(late.id, 'review', true, 3), at(T0, 2)).item.due)).toBe(4)
  })

  it('forgotten → back in 10 minutes and the ladder restarts; Hard → tomorrow; Easy → skips ahead', () => {
    const db = openDatabase(':memory:')
    const b = createBook(db, 'B')
    const [a, h, e] = importItems(db, { bookId: b.id, kind: 'manual', drafts: [{ term: 'a1' }, { term: 'h1' }, { term: 'e1' }] }).added
    for (const it of [a, h, e]) recordAnswer(db, ans(it.id, 'new', true, 3), T0)
    const again = recordAnswer(db, ans(a.id, 'review', false, 3), at(T0, 1)).item // wrong can't be "Good"
    expect([again.lastRating, again.lapses, again.step, (new Date(again.due!).getTime() - at(T0, 1).getTime()) / 60000]).toEqual([2, 0, 0, 1440])
    const forgot = recordAnswer(db, ans(a.id, 'review', false, 1), at(T0, 2)).item
    expect([forgot.lapses, forgot.step, (new Date(forgot.due!).getTime() - at(T0, 2).getTime()) / 60000]).toEqual([1, 0, 10])
    const hard = recordAnswer(db, ans(h.id, 'review', true, 2), at(T0, 1)).item
    expect(Math.round((new Date(hard.due!).getTime() - at(T0, 1).getTime()) / DAY)).toBe(1)
    const easy = recordAnswer(db, ans(e.id, 'review', true, 4), at(T0, 1)).item
    expect(Math.round((new Date(easy.due!).getTime() - T0.getTime()) / DAY)).toBe(7)
  })

  it('practice repeats in the same session do not move the schedule', () => {
    const db = openDatabase(':memory:')
    const b = createBook(db, 'B')
    const [it] = importItems(db, { bookId: b.id, kind: 'manual', drafts: [{ term: 'frugal' }] }).added
    const due = recordAnswer(db, ans(it.id, 'new', false, 1), T0).item.due
    expect(recordAnswer(db, ans(it.id, 'retry', true, 3), at(T0, 0, 0.1)).item.due).toBe(due)
  })
})

describe('mistakes: numbered, kept, and brought back', () => {
  it('Mistake 1, 2, 3 with question, answer, correct answer, type and date; a later correct answer keeps the history', () => {
    const db = openDatabase(':memory:')
    const b = createBook(db, 'B')
    const [it, other] = importItems(db, { bookId: b.id, kind: 'manual', drafts: [{ term: 'frugal' }, { term: 'candid' }] }).added
    expect(recordAnswer(db, ans(it.id, 'new', false, 1), T0).mistakeNumber).toBe(1)
    expect(recordAnswer(db, ans(it.id, 'retry', false, 1, { mode: 'context', errorType: 'wrong_context' }), at(T0, 0, 0.1)).mistakeNumber).toBe(2)
    expect(recordAnswer(db, ans(it.id, 'review', false, 1, { mode: 'sentence', errorType: 'sentence_usage', answer: 'I frugal money.' }), at(T0, 1)).mistakeNumber).toBe(3)
    let m = listMistakes(db, b.id, it.id)
    expect(m.map((x) => [x.number, x.mode, x.errorType, !!x.correctedAt])).toEqual([
      [3, 'sentence', 'sentence_usage', false],
      [2, 'context', 'wrong_context', false],
      [1, 'mcq', 'wrong_meaning', false]
    ])
    expect(m[0]).toMatchObject({ question: 'What does “frugal” mean?', answer: 'I frugal money.', correct: 'মিতব্যয়ী', term: 'frugal' })
    expect(vbStatus(getItem(db, it.id)!, at(T0, 1))).toBe('struggling')
    // Mistake Review: this word first.
    recordAnswer(db, ans(other.id, 'new', true, 3), T0)
    expect(mistakeReview(db, b.id, 20, at(T0, 1)).map((i) => i.term)).toEqual(['frugal'])
    // Answered correctly later: history stays, count stays, marked as corrected.
    const after = recordAnswer(db, ans(it.id, 'mistake', true, 3), at(T0, 1, 1)).item
    m = listMistakes(db, b.id, it.id)
    expect([after.mistakes, after.openMistakes, m.length, m.every((x) => !!x.correctedAt)]).toEqual([3, 0, 3, true])
    // Still prioritised in Mistake Review (many mistakes), and not mastered while it keeps failing.
    expect(mistakeReview(db, b.id, 20, at(T0, 1, 1)).map((i) => i.term)).toEqual(['frugal'])
    expect(dashboard(db, b.id, at(T0, 1, 1)).frequent).toEqual([{ id: it.id, term: 'frugal', mistakes: 3, seq: 1 }])
    expect(isVbMastered({ introducedAt: 'x', intervalDays: 30, lastRating: 3, openMistakes: 1 })).toBe(false)
  })
})

describe('separate from regular learning', () => {
  it('book words never appear in Notes / regular flashcards, and regular cards never in a book', () => {
    const db = openDatabase(':memory:')
    const n = insertNote(db, { kind: 'word', text: 'resilient' }, null)
    insertFlashcard(db, n.id, 'resilient', { meaning_bn: '', meaning_en: '', example: '', example_bn: '', note: '' })
    const b = createBook(db, 'B')
    importItems(db, { bookId: b.id, kind: 'manual', drafts: [{ term: 'frugal' }] })
    expect(listNotes(db).map((x) => x.text)).toEqual(['resilient'])
    expect(listFlashcards(db).map((c) => c.front)).toEqual(['resilient'])
    expect(listItems(db, b.id).map((i) => i.term)).toEqual(['frugal'])
  })
})

describe('the deck: front = the word only; edits and meanings', () => {
  it('meaning is filled in without overwriting yours; editing the word keeps its number and original', () => {
    const db = openDatabase(':memory:')
    const b = createBook(db, 'B')
    const [it] = importItems(db, { bookId: b.id, kind: 'passage', text: 'He was frugal.', drafts: [{ term: 'frugal', meaningBn: 'মিতব্যয়ী', context: 'He was frugal.' }] }).added
    applyEnrichment(db, it.id, { meaningBn: 'কৃপণ', definitionEn: 'careful with money', pos: 'adjective', example: 'She is frugal with food.', exampleBn: 'সে খাবারে মিতব্যয়ী।', synonyms: ['thrifty'], collocations: ['frugal lifestyle'] })
    const e = editItem(db, { id: it.id, term: 'frugal (adj.)' })
    expect([e.term, e.originalTerm, e.seq, e.meaningBn, e.definitionEn, e.synonyms, e.context]).toEqual(['frugal (adj.)', 'frugal', 1, 'মিতব্যয়ী', 'careful with money', ['thrifty'], 'He was frugal.'])
    expect(() => editItem(db, { id: it.id, term: '  ' })).toThrow(/empty/)
  })

  it('session tasks: chosen modes in turn; matching groups words; meaning modes need a meaning', () => {
    const items = [1, 2, 3, 4, 5, 6].map((id) => ({ id, term: `w${id}`, meaningBn: id === 6 ? '' : `m${id}`, definitionEn: '', context: id === 1 ? 'A w1 here.' : '', example: '' }))
    const tasks = buildTasks(
      items.map((item) => ({ item, kind: 'new' as const })),
      ['mcq', 'context', 'matching'],
      items
    )
    expect(tasks.flatMap((t) => t.itemIds).sort()).toEqual([1, 2, 3, 4, 5, 6]) // every word exactly once
    expect(tasks.map((t) => t.itemIds[0])).toEqual([1, 2, 4, 6]) // a matching group sits where its first word is: order kept
    expect(tasks.find((t) => t.itemIds.includes(6))?.mode).toBe('flashcard') // no meaning yet
    expect(tasks.find((t) => t.itemIds.includes(1))?.mode).toBe('mcq')
    expect(tasks.find((t) => t.mode === 'matching')!.itemIds.length).toBeGreaterThanOrEqual(2)
    expect(pickDistractors(items[0], items, 3, (i) => i.meaningBn)).toHaveLength(3)
  })
})

describe('Google Docs: a separate destination, the app stays the source of truth', () => {
  it('entries go only to the Vocabulary Book doc, in order, never twice', async () => {
    const db = openDatabase(':memory:')
    const b = createBook(db, 'Word Power')
    importItems(db, { bookId: b.id, kind: 'book_page', title: 'p42.jpg', pageRef: 'Unit 7 · page 42', drafts: [{ term: 'abundant' }, { term: 'candid' }] })
    const appended: { docId: string; title: string; fields: string[] }[] = []
    const vb = createVocabBook(db, {
      gemini: { configured: false } as never,
      google: {
        connected: true,
        appendEntry: async (docId, e) => void appended.push({ docId, title: e.title, fields: e.fields.map((f) => `${f.label}: ${f.value}`) }),
        docContains: async () => false,
        createDoc: async (title) => ({ id: 'doc-vb', title })
      },
      imagesDir: mkdtempSync(join(tmpdir(), 'vb-'))
    })
    expect((await vb.syncBook(b.id)).error).toMatch(/Choose a Google Doc/)
    vb.setDoc({ id: 'doc-vb', title: 'Vocabulary Book Notes' })
    expect(await vb.syncBook(b.id)).toEqual({ added: 2, error: null })
    expect(await vb.syncBook(b.id)).toEqual({ added: 0, error: null })
    expect(appended.map((a) => [a.docId, a.title])).toEqual([
      ['doc-vb', '1. abundant'],
      ['doc-vb', '2. candid']
    ])
    expect(appended[0].fields).toContain('Book: Word Power · word 1')
    expect(appended[0].fields.some((f) => f.startsWith('Source: Picture of a vocabulary book page · p42.jpg · Unit 7 · page 42'))).toBe(true)
    // The regular categories' docs are not touched.
    expect(listDocTargets(db)).toEqual([])
    expect(vbDocEntry(listItems(db, b.id)[0], 'Word Power', null).fields.at(-1)?.value).toMatch(/^elc-vb-/)
  })
})

describe('pictures: reviewed before import; uncertain words marked; Gemini, then offline OCR', () => {
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

  it('Gemini vision: order kept, uncertain marked, incomplete page said clearly, picture saved', async () => {
    const db = openDatabase(':memory:')
    const b = createBook(db, 'B')
    const dir = mkdtempSync(join(tmpdir(), 'vb-'))
    const vb = createVocabBook(db, {
      gemini: {
        configured: true,
        vocabFromImage: async () => ({
          items: [
            { term: 'abundant', meaning_bn: '', context: '', uncertain: false, note: '' },
            { term: 'benev0lent', meaning_bn: '', context: '', uncertain: true, note: 'blurry' }
          ],
          page_ref: 'Page 42',
          complete: false,
          warning: 'The bottom of the page is cut off.'
        })
      } as never,
      google: { connected: false } as never,
      imagesDir: dir
    })
    const r = await vb.extractImage({ bookId: b.id, imageBase64: png, mimeType: 'image/png' })
    expect(r).toMatchObject({ engine: 'gemini', complete: false, warning: 'The bottom of the page is cut off.', pageRef: 'Page 42' })
    expect(r.drafts.map((d) => [d.term, !!d.uncertain])).toEqual([
      ['abundant', false],
      ['benev0lent', true]
    ])
    expect(existsSync(join(dir, r.imageFile!))).toBe(true)
    // Nothing is saved as vocabulary until you import the (corrected) list.
    expect(listItems(db, b.id)).toHaveLength(0)
    await expect(vb.extractImage({ bookId: b.id, imageBase64: png, mimeType: 'application/pdf' })).rejects.toThrow(/PNG/)
  })

  it('Gemini fails → Windows OCR is used and says so; nothing found → not claimed as read', async () => {
    const db = openDatabase(':memory:')
    const b = createBook(db, 'B')
    const vb = createVocabBook(db, {
      gemini: { configured: true, vocabFromImage: async () => Promise.reject(new Error('quota exceeded')) } as never,
      google: { connected: false } as never,
      imagesDir: mkdtempSync(join(tmpdir(), 'vb-')),
      ocr: async () => ['Lesson 3', 'frugal', 'candid']
    })
    const r = await vb.extractImage({ bookId: b.id, imageBase64: png, mimeType: 'image/png' })
    expect(r).toMatchObject({ engine: 'windows-ocr', complete: false, pageRef: 'Lesson 3' })
    expect(r.warning).toMatch(/Gemini could not read the picture \(quota exceeded\)/)
    expect(r.drafts.every((d) => d.uncertain)).toBe(true)
    const empty = createVocabBook(db, { gemini: { configured: false } as never, google: { connected: false } as never, imagesDir: mkdtempSync(join(tmpdir(), 'vb-')), ocr: async () => [] })
    const r2 = await empty.extractImage({ bookId: b.id, imageBase64: png, mimeType: 'image/png' })
    expect([r2.drafts.length, r2.complete, r2.warning]).toEqual([0, false, 'Read with Windows OCR (offline). No words were found.'])
  })

  it.runIf(process.platform === 'win32')('real Windows OCR (offline) reads a printed word list in order', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'vb-ocr-'))
    const file = join(dir, 'page.png')
    execFileSync('powershell.exe', [
      '-NoProfile',
      '-Command',
      `Add-Type -AssemblyName System.Drawing; $b = New-Object System.Drawing.Bitmap 700, 420; $g = [System.Drawing.Graphics]::FromImage($b); $g.Clear([System.Drawing.Color]::White); $f = New-Object System.Drawing.Font 'Arial', 26; ` +
        `$i = 0; foreach ($w in @('Page 12', '1. abundant', '2. candid', '3. frugal', '4. set off')) { $g.DrawString($w, $f, [System.Drawing.Brushes]::Black, 40, 30 + $i * 70); $i++ }; $g.Dispose(); $b.Save('${file}'); $b.Dispose()`
    ])
    const lines = await windowsOcr(file)
    const { drafts, pageRef } = draftsFromOcrLines(lines)
    expect(pageRef).toBe('Page 12')
    expect(drafts.map((d) => d.term)).toEqual(['abundant', 'candid', 'frugal', 'set off'])
    expect(readdirSync(dir)).toContain('page.png')
    expect(readFileSync(file).length).toBeGreaterThan(100)
  }, 60_000)
})
