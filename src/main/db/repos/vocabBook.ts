import { randomUUID } from 'node:crypto'
import { normTerm } from '@shared/vocab'
import {
  endOfDay,
  isVbMastered,
  mistakePriority,
  startOfDay,
  type VbAnswer,
  type VbBook,
  type VbDashboard,
  type VbDraft,
  type VbItem,
  type VbItemEdit,
  type VbMistake,
  type VbMode,
  type VbSession,
  type VbSource,
  type VbSourceKind
} from '@shared/vocabBook'
import { tx, type Db } from '../index'
import { introduce, reviewVb, type VbScheduleState } from '../../srs/vocabBookSchedule'

// ---- books

interface BookRow {
  id: number
  title: string
  daily_new: number
  created_at: string
  total: number
}
const toBook = (r: BookRow): VbBook => ({ id: r.id, title: r.title, dailyNew: r.daily_new, createdAt: r.created_at, total: r.total })

export function listBooks(db: Db): VbBook[] {
  return (db.prepare('SELECT b.*, (SELECT COUNT(*) FROM vb_items i WHERE i.book_id = b.id) AS total FROM vb_books b ORDER BY b.id').all() as unknown as BookRow[]).map(toBook)
}

export function getBook(db: Db, id: number): VbBook | null {
  const r = db.prepare('SELECT b.*, (SELECT COUNT(*) FROM vb_items i WHERE i.book_id = b.id) AS total FROM vb_books b WHERE b.id = ?').get(id) as BookRow | undefined
  return r ? toBook(r) : null
}

export function createBook(db: Db, title: string, dailyNew = 10): VbBook {
  const t = title.replace(/\s+/g, ' ').trim()
  if (!t) throw new Error('Give the book a name.')
  const res = db.prepare('INSERT INTO vb_books (title, daily_new) VALUES (?, ?)').run(t.slice(0, 120), clampDaily(dailyNew))
  return getBook(db, Number(res.lastInsertRowid))!
}

const clampDaily = (n: number): number => Math.max(1, Math.min(200, Math.round(Number(n) || 10)))

export function updateBook(db: Db, id: number, patch: { title?: string; dailyNew?: number }): VbBook {
  if (patch.title !== undefined) {
    const t = patch.title.replace(/\s+/g, ' ').trim()
    if (!t) throw new Error('Give the book a name.')
    db.prepare('UPDATE vb_books SET title = ? WHERE id = ?').run(t.slice(0, 120), id)
  }
  if (patch.dailyNew !== undefined) db.prepare('UPDATE vb_books SET daily_new = ? WHERE id = ?').run(clampDaily(patch.dailyNew), id)
  const b = getBook(db, id)
  if (!b) throw new Error('Book not found.')
  return b
}

// ---- sources

interface SourceRow {
  id: number
  book_id: number
  kind: VbSourceKind
  title: string | null
  text: string | null
  image_file: string | null
  page_ref: string | null
  extraction: string | null
  created_at: string
  item_count?: number
}
const toSource = (r: SourceRow): VbSource => ({
  id: r.id,
  bookId: r.book_id,
  kind: r.kind,
  title: r.title,
  text: r.text,
  imageFile: r.image_file,
  pageRef: r.page_ref,
  extraction: r.extraction,
  createdAt: r.created_at,
  itemCount: r.item_count
})

export function listSources(db: Db, bookId: number): VbSource[] {
  return (
    db
      .prepare('SELECT s.*, (SELECT COUNT(*) FROM vb_items i WHERE i.source_id = s.id) AS item_count FROM vb_sources s WHERE s.book_id = ? ORDER BY s.id DESC')
      .all(bookId) as unknown as SourceRow[]
  ).map(toSource)
}

export function getSource(db: Db, id: number): VbSource | null {
  const r = db.prepare('SELECT * FROM vb_sources WHERE id = ?').get(id) as SourceRow | undefined
  return r ? toSource(r) : null
}

// ---- items

interface ItemRow {
  id: number
  uid: string
  book_id: number
  source_id: number | null
  seq: number
  term: string
  original_term: string
  meaning_bn: string
  definition_en: string
  pos: string
  context: string
  example: string
  example_bn: string
  synonyms_json: string
  collocations_json: string
  page_ref: string | null
  enriched: number
  enrich_error: string | null
  introduced_at: string | null
  step: number
  interval_days: number
  ease: number
  reps: number
  lapses: number
  due: string | null
  last_reviewed_at: string | null
  last_rating: number | null
  mistakes: number
  open_mistakes: number
  sentence_mistakes: number
  gdoc_synced_at: string | null
  gdoc_error: string | null
  created_at: string
}

const ITEM_SELECT = `SELECT i.*,
  (SELECT COUNT(*) FROM vb_mistakes m WHERE m.item_id = i.id AND m.corrected_at IS NULL) AS open_mistakes,
  (SELECT COUNT(*) FROM vb_mistakes m WHERE m.item_id = i.id AND m.mode = 'sentence') AS sentence_mistakes
  FROM vb_items i`

const list = (s: string): string[] => {
  try {
    const v = JSON.parse(s) as unknown
    return Array.isArray(v) ? v.map(String).filter(Boolean) : []
  } catch {
    return []
  }
}

const toItem = (r: ItemRow): VbItem => ({
  id: r.id,
  uid: r.uid,
  bookId: r.book_id,
  sourceId: r.source_id,
  seq: r.seq,
  term: r.term,
  originalTerm: r.original_term,
  meaningBn: r.meaning_bn,
  definitionEn: r.definition_en,
  pos: r.pos,
  context: r.context,
  example: r.example,
  exampleBn: r.example_bn,
  synonyms: list(r.synonyms_json),
  collocations: list(r.collocations_json),
  pageRef: r.page_ref,
  enriched: !!r.enriched,
  enrichError: r.enrich_error,
  introducedAt: r.introduced_at,
  step: r.step,
  intervalDays: r.interval_days,
  ease: r.ease,
  reps: r.reps,
  lapses: r.lapses,
  due: r.due,
  lastReviewedAt: r.last_reviewed_at,
  lastRating: r.last_rating,
  mistakes: r.mistakes,
  openMistakes: r.open_mistakes,
  sentenceMistakes: r.sentence_mistakes,
  gdocSyncedAt: r.gdoc_synced_at,
  gdocError: r.gdoc_error,
  createdAt: r.created_at
})

export function listItems(db: Db, bookId: number): VbItem[] {
  return (db.prepare(`${ITEM_SELECT} WHERE i.book_id = ? ORDER BY i.seq`).all(bookId) as unknown as ItemRow[]).map(toItem)
}

export function getItem(db: Db, id: number): VbItem | null {
  const r = db.prepare(`${ITEM_SELECT} WHERE i.id = ?`).get(id) as ItemRow | undefined
  return r ? toItem(r) : null
}

/** Terms already in the book with their numbers (to mark duplicates before importing). */
export function bookTerms(db: Db, bookId: number): { term: string; seq: number }[] {
  return db.prepare('SELECT term, seq FROM vb_items WHERE book_id = ? ORDER BY seq').all(bookId) as { term: string; seq: number }[]
}

export interface ImportInput {
  bookId: number
  kind: VbSourceKind
  title?: string | null
  text?: string | null
  imageFile?: string | null
  pageRef?: string | null
  extraction?: string | null
  drafts: VbDraft[]
  /** Import a word even if it is already in the book (e.g. a different meaning). */
  allowDuplicates?: boolean
}

/**
 * Adds reviewed words to a book, numbered after the last one in the order given. The source (picture,
 * story, passage, list) is kept with them. A word already in the book is skipped unless allowed.
 */
export function importItems(db: Db, input: ImportInput): { source: VbSource | null; added: VbItem[]; skipped: string[] } {
  if (!getBook(db, input.bookId)) throw new Error('Book not found.')
  return tx(db, () => {
    const src = db
      .prepare('INSERT INTO vb_sources (book_id, kind, title, text, image_file, page_ref, extraction) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(input.bookId, input.kind, input.title?.trim() || null, input.text?.trim() || null, input.imageFile ?? null, input.pageRef?.trim() || null, input.extraction ?? null)
    const sourceId = Number(src.lastInsertRowid)
    const have = new Set(bookTerms(db, input.bookId).map((t) => normTerm(t.term)))
    let seq = (db.prepare('SELECT COALESCE(MAX(seq), 0) AS m FROM vb_items WHERE book_id = ?').get(input.bookId) as { m: number }).m
    const ins = db.prepare(
      'INSERT INTO vb_items (uid, book_id, source_id, seq, term, original_term, meaning_bn, context, page_ref) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    )
    const added: number[] = []
    const skipped: string[] = []
    for (const d of input.drafts) {
      const term = d.term.replace(/\s+/g, ' ').trim().slice(0, 120)
      if (!term) continue
      const key = normTerm(term)
      if (have.has(key) && !input.allowDuplicates) {
        skipped.push(term)
        continue
      }
      have.add(key)
      seq++
      const r = ins.run(randomUUID(), input.bookId, sourceId, seq, term, term, d.meaningBn?.trim() ?? '', d.context?.trim() ?? '', input.pageRef?.trim() || null)
      added.push(Number(r.lastInsertRowid))
    }
    if (!added.length) {
      db.prepare('DELETE FROM vb_sources WHERE id = ?').run(sourceId)
      return { source: null, added: [], skipped }
    }
    return { source: getSource(db, sourceId), added: added.map((id) => getItem(db, id)!), skipped }
  })
}

export interface Enrichment {
  meaningBn?: string
  definitionEn?: string
  pos?: string
  context?: string
  example?: string
  exampleBn?: string
  synonyms?: string[]
  collocations?: string[]
}

/** Fills in meaning etc. Never overwrites what you wrote yourself (a meaning you supplied stays). */
export function applyEnrichment(db: Db, id: number, e: Enrichment): void {
  const cur = getItem(db, id)
  if (!cur) return
  const keep = (mine: string, theirs?: string): string => (mine.trim() ? mine : (theirs ?? '').trim())
  db.prepare(
    `UPDATE vb_items SET meaning_bn = ?, definition_en = ?, pos = ?, context = ?, example = ?, example_bn = ?, synonyms_json = ?, collocations_json = ?, enriched = 1, enrich_error = NULL WHERE id = ?`
  ).run(
    keep(cur.meaningBn, e.meaningBn),
    keep(cur.definitionEn, e.definitionEn),
    keep(cur.pos, e.pos),
    keep(cur.context, e.context),
    keep(cur.example, e.example),
    keep(cur.exampleBn, e.exampleBn),
    JSON.stringify(cur.synonyms.length ? cur.synonyms : (e.synonyms ?? []).slice(0, 6)),
    JSON.stringify(cur.collocations.length ? cur.collocations : (e.collocations ?? []).slice(0, 6)),
    id
  )
}

export function markEnrichError(db: Db, id: number, error: string): void {
  db.prepare('UPDATE vb_items SET enrich_error = ? WHERE id = ?').run(error.slice(0, 300), id)
}

/** Your edit of an item (the English word on the card front, meanings, example …). The learning order never changes. */
export function editItem(db: Db, edit: VbItemEdit): VbItem {
  const cur = getItem(db, edit.id)
  if (!cur) throw new Error('Word not found.')
  const text = (v: string | undefined, fallback: string, max = 2000): string => (v === undefined ? fallback : v.replace(/[ \t]+/g, ' ').trim().slice(0, max))
  const term = text(edit.term, cur.term, 120)
  if (!term) throw new Error('The English word or phrase cannot be empty.')
  const arr = (v: string[] | undefined, fallback: string[]): string => JSON.stringify((v ?? fallback).map((s) => s.trim()).filter(Boolean).slice(0, 10))
  db.prepare(
    `UPDATE vb_items SET term = ?, meaning_bn = ?, definition_en = ?, pos = ?, context = ?, example = ?, example_bn = ?, synonyms_json = ?, collocations_json = ? WHERE id = ?`
  ).run(
    term,
    text(edit.meaningBn, cur.meaningBn),
    text(edit.definitionEn, cur.definitionEn),
    text(edit.pos, cur.pos, 40),
    text(edit.context, cur.context),
    text(edit.example, cur.example),
    text(edit.exampleBn, cur.exampleBn),
    arr(edit.synonyms, cur.synonyms),
    arr(edit.collocations, cur.collocations),
    edit.id
  )
  return getItem(db, edit.id)!
}

// ---- learning

const scheduleOf = (i: VbItem): VbScheduleState => ({
  step: i.step,
  intervalDays: i.intervalDays,
  ease: i.ease,
  reps: i.reps,
  lapses: i.lapses,
  due: i.due,
  introducedAt: i.introducedAt,
  lastReviewedAt: i.lastReviewedAt,
  lastRating: i.lastRating
})

const introducedToday = (db: Db, bookId: number, now: Date): number =>
  (db.prepare('SELECT COUNT(*) AS n FROM vb_items WHERE book_id = ? AND introduced_at >= ?').get(bookId, startOfDay(now).toISOString()) as { n: number }).n

/**
 * Today's session: the next new words in order (your daily number minus those already learned
 * today) and every word due for revision today.
 */
export function sessionFor(db: Db, bookId: number, now = new Date(), opts: { newCount?: number } = {}): VbSession {
  const book = getBook(db, bookId)
  if (!book) throw new Error('Book not found.')
  const items = listItems(db, bookId)
  const want = opts.newCount ?? Math.max(0, book.dailyNew - introducedToday(db, bookId, now))
  const newItems = items.filter((i) => !i.introducedAt).slice(0, Math.max(0, want))
  const end = endOfDay(now)
  const reviewItems = items.filter((i) => i.introducedAt && i.due && new Date(i.due) <= end).sort((a, b) => a.due!.localeCompare(b.due!))
  return { newItems, reviewItems, pool: items }
}

/** Mistake Review: the words you get wrong most (see mistakePriority), hardest first. */
export function mistakeReview(db: Db, bookId: number, limit = 20, now = new Date()): VbItem[] {
  return listItems(db, bookId)
    .map((i) => ({ i, p: mistakePriority(i, now) }))
    .filter((x) => x.p > 0)
    .sort((a, b) => b.p - a.p || a.i.seq - b.i.seq)
    .slice(0, limit)
    .map((x) => x.i)
}

/**
 * Records one answer: the review log, the schedule (new words start their Day 1 → 4 → 7 ladder;
 * practice repeats in the same session don't move the schedule), and — when wrong — the next
 * numbered mistake. A correct answer marks earlier mistakes as followed by a correct answer; they
 * are never deleted.
 */
export function recordAnswer(db: Db, a: VbAnswer, now = new Date()): { item: VbItem; mistakeNumber: number | null } {
  return tx(db, () => {
    const item = getItem(db, a.itemId)
    if (!item) throw new Error('Word not found.')
    const iso = now.toISOString()
    // A wrong answer can't be rated as remembered.
    const rating = (a.correct ? a.rating : Math.min(a.rating, 2)) as 1 | 2 | 3 | 4
    let s = scheduleOf(item)
    if (!item.introducedAt) {
      s = introduce(s, now)
      s = { ...s, reps: 1, lastReviewedAt: iso, lastRating: rating, lapses: s.lapses + (a.correct ? 0 : 1) }
    } else if (a.kind !== 'retry') {
      s = reviewVb(s, rating, now)
    }
    db.prepare(
      'UPDATE vb_items SET introduced_at = ?, step = ?, interval_days = ?, ease = ?, reps = ?, lapses = ?, due = ?, last_reviewed_at = ?, last_rating = ? WHERE id = ?'
    ).run(s.introducedAt, s.step, s.intervalDays, s.ease, s.reps, s.lapses, s.due, s.lastReviewedAt, s.lastRating, item.id)
    db.prepare('INSERT INTO vb_reviews (item_id, kind, mode, correct, rating, reviewed_at) VALUES (?, ?, ?, ?, ?, ?)').run(item.id, a.kind, a.mode, a.correct ? 1 : 0, rating, iso)
    let mistakeNumber: number | null = null
    if (!a.correct) {
      mistakeNumber = item.mistakes + 1
      db.prepare('UPDATE vb_items SET mistakes = ? WHERE id = ?').run(mistakeNumber, item.id)
      db.prepare('INSERT INTO vb_mistakes (item_id, number, mode, question, answer, correct, error_type, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
        item.id,
        mistakeNumber,
        a.mode,
        a.question.slice(0, 1000),
        a.answer.slice(0, 1000) || '(no answer)',
        a.correctAnswer.slice(0, 1000),
        a.errorType || 'wrong_meaning',
        iso
      )
    } else {
      db.prepare('UPDATE vb_mistakes SET corrected_at = ? WHERE item_id = ? AND corrected_at IS NULL').run(iso, item.id)
    }
    return { item: getItem(db, item.id)!, mistakeNumber }
  })
}

interface MistakeRow {
  id: number
  item_id: number
  term: string
  number: number
  mode: VbMode
  question: string
  answer: string
  correct: string
  error_type: string
  created_at: string
  corrected_at: string | null
}
const toMistake = (r: MistakeRow): VbMistake => ({
  id: r.id,
  itemId: r.item_id,
  term: r.term,
  number: r.number,
  mode: r.mode,
  question: r.question,
  answer: r.answer,
  correct: r.correct,
  errorType: r.error_type,
  createdAt: r.created_at,
  correctedAt: r.corrected_at
})

/** The full mistake history of a book (or of one word), newest first. */
export function listMistakes(db: Db, bookId: number, itemId?: number): VbMistake[] {
  const rows = db
    .prepare(
      `SELECT m.*, i.term FROM vb_mistakes m JOIN vb_items i ON i.id = m.item_id WHERE i.book_id = ? ${itemId ? 'AND m.item_id = ?' : ''} ORDER BY m.created_at DESC, m.id DESC LIMIT 500`
    )
    .all(...(itemId ? [bookId, itemId] : [bookId])) as unknown as MistakeRow[]
  return rows.map(toMistake)
}

export function dashboard(db: Db, bookId: number, now = new Date()): VbDashboard {
  const book = getBook(db, bookId)
  if (!book) throw new Error('Book not found.')
  const items = listItems(db, bookId)
  const dayStart = startOfDay(now).toISOString()
  const end = endOfDay(now)
  const newToday = introducedToday(db, bookId, now)
  const newLeft = items.filter((i) => !i.introducedAt).length
  const count = (sql: string): number => (db.prepare(sql).get(bookId, dayStart) as { n: number }).n
  return {
    bookId,
    total: items.length,
    dailyNew: book.dailyNew,
    newToday,
    remainingNewToday: Math.min(newLeft, Math.max(0, book.dailyNew - newToday)),
    newLeft,
    reviewsToday: count(`SELECT COUNT(*) AS n FROM vb_reviews r JOIN vb_items i ON i.id = r.item_id WHERE i.book_id = ? AND r.reviewed_at >= ? AND r.kind IN ('review', 'mistake')`),
    dueNow: items.filter((i) => i.introducedAt && i.due && new Date(i.due) <= end).length,
    mistakesToday: count('SELECT COUNT(*) AS n FROM vb_mistakes m JOIN vb_items i ON i.id = m.item_id WHERE i.book_id = ? AND m.created_at >= ?'),
    mistakesTotal: items.reduce((s, i) => s + i.mistakes, 0),
    frequent: items
      .filter((i) => i.mistakes >= 2)
      .sort((a, b) => b.mistakes - a.mistakes || a.seq - b.seq)
      .slice(0, 8)
      .map((i) => ({ id: i.id, term: i.term, mistakes: i.mistakes, seq: i.seq })),
    mastered: items.filter((i) => isVbMastered(i)).length,
    learning: items.filter((i) => i.introducedAt && !isVbMastered(i)).length,
    nextSeq: items.find((i) => !i.introducedAt)?.seq ?? null
  }
}

// ---- Google Docs (a copy; the database stays the source of truth)

export function markVbSynced(db: Db, id: number, docId: string): void {
  db.prepare("UPDATE vb_items SET gdoc_id = ?, gdoc_synced_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), gdoc_error = NULL WHERE id = ?").run(docId, id)
}
export function markVbSyncError(db: Db, id: number, error: string): void {
  db.prepare('UPDATE vb_items SET gdoc_error = ? WHERE id = ?').run(error.slice(0, 300), id)
}
export function itemsNotInDoc(db: Db, bookId: number | null, docId: string): number[] {
  return (
    db
      .prepare(`SELECT id FROM vb_items WHERE (gdoc_synced_at IS NULL OR gdoc_id IS NOT ?) ${bookId ? 'AND book_id = ?' : ''} ORDER BY book_id, seq`)
      .all(...(bookId ? [docId, bookId] : [docId])) as { id: number }[]
  ).map((r) => r.id)
}
