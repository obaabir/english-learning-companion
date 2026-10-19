import { normTerm, targetMeaning } from '@shared/vocab'
import {
  FLASHCARD_KINDS,
  type Flashcard,
  type FlashcardBack,
  type FlashcardEdit,
  type FlashcardStats,
  type NoteData,
  type NoteKind,
  type ReviewRating,
  type RevisionDashboard
} from '@shared/types'
import { tx, type Db } from '../index'
import { endOfDay, isFrequentlyForgotten, isMastered, newRevision, reviewRevision, startOfDay, type RevisionState } from '../../srs/revision'

interface FlashcardRow {
  id: number
  note_id: number
  front: string
  back_json: string
  due: string
  state: number
  reps: number
  lapses: number
  created_at: string
  srs_step: number
  interval_days: number
  ease: number
  last_reviewed_at: string | null
  last_rating: ReviewRating | null
  // From the saved note (original context and source).
  n_kind: NoteKind | null
  n_context: string | null
  n_media_title: string | null
  n_source_url: string | null
  n_timestamp: number | null
  n_data: string | null
  n_target: string | null
  n_text: string | null
}

const SELECT = `
  SELECT f.*, n.kind AS n_kind, n.context_sentence AS n_context, n.media_title AS n_media_title,
         n.source_url AS n_source_url, n.timestamp_sec AS n_timestamp, n.data_json AS n_data,
         n.target AS n_target, n.text AS n_text
  FROM flashcards f LEFT JOIN notes n ON n.id = f.note_id`

/** Regular cards only: the Vocabulary Book (a later feature) keeps its own deck. */
const REGULAR = `COALESCE(n.collection, 'regular') = 'regular'`

const toFlashcard = (r: FlashcardRow): Flashcard => {
  const data = r.n_data ? (JSON.parse(r.n_data) as NoteData) : null
  return {
    id: r.id,
    noteId: r.note_id,
    // The front is the item's target word/phrase (its designated field), never the whole sentence.
    front: r.n_target?.trim() || r.front,
    needsTarget: !!r.n_kind && !r.n_target?.trim(),
    back: JSON.parse(r.back_json) as FlashcardBack,
    due: r.due,
    state: r.state,
    reps: r.reps,
    lapses: r.lapses,
    createdAt: r.created_at,
    step: r.srs_step,
    intervalDays: r.interval_days,
    ease: r.ease,
    lastReviewedAt: r.last_reviewed_at,
    lastRating: r.last_rating,
    mastered: isMastered({ intervalDays: r.interval_days, lastRating: r.last_rating }),
    source: r.n_kind
      ? {
          kind: r.n_kind,
          contextSentence: r.n_context,
          mediaTitle: r.n_media_title,
          sourceUrl: r.n_source_url,
          timestampSec: r.n_timestamp,
          examples: data?.examples ?? [],
          grammar: data?.grammar ?? [],
          text: r.n_text ?? undefined,
          sentenceMeaningBn: r.n_kind === 'sentence' || r.n_kind === 'structure' ? (data?.meaning_bn ?? null) : null
        }
      : undefined
  }
}

const stateOf = (s: RevisionState): number => (s.reps === 0 ? 0 : s.step < 3 ? 1 : 2)

export function insertFlashcard(db: Db, noteId: number, front: string, back: FlashcardBack, now = new Date()): Flashcard {
  // New cards are due on Day 1 (today).
  const s = newRevision(now)
  const res = db
    .prepare(
      `INSERT INTO flashcards (note_id, front, back_json, card_json, due, state, reps, lapses, srs_step, interval_days, ease)
       VALUES (?, ?, ?, '{}', ?, 0, 0, 0, ?, ?, ?)`
    )
    .run(noteId, front, JSON.stringify(back), s.due, s.step, s.intervalDays, s.ease)
  return getFlashcard(db, Number(res.lastInsertRowid))!
}

export function getFlashcard(db: Db, id: number): Flashcard | null {
  const row = db.prepare(`${SELECT} WHERE f.id = ?`).get(id) as FlashcardRow | undefined
  return row ? toFlashcard(row) : null
}

export function listFlashcards(db: Db): Flashcard[] {
  return (db.prepare(`${SELECT} WHERE ${REGULAR} ORDER BY f.due`).all() as unknown as FlashcardRow[]).map(toFlashcard)
}

/** Cards due any time today (including overdue ones), oldest due first. */
export function listDueFlashcards(db: Db, limit = 50, now = new Date()): Flashcard[] {
  return (
    db.prepare(`${SELECT} WHERE f.due <= ? AND ${REGULAR} ORDER BY f.due LIMIT ?`).all(endOfDay(now).toISOString(), limit) as unknown as FlashcardRow[]
  ).map(toFlashcard)
}

/** Saved items that should have a flashcard but don't yet. */
export function noteIdsWithoutFlashcards(db: Db): number[] {
  const rows = db
    .prepare(
      `SELECT id, kind, text, target, data_json FROM notes WHERE kind IN (${FLASHCARD_KINDS.map(() => '?').join(',')})
       AND COALESCE(collection, 'regular') = 'regular'
       AND id NOT IN (SELECT note_id FROM flashcards) ORDER BY id`
    )
    .all(...FLASHCARD_KINDS) as { id: number; kind: NoteKind; text: string; target: string | null; data_json: string | null }[]
  // The same word with the same meaning saved again (e.g. from another film) is already on a card.
  return rows
    .filter((r) => {
      if (!r.target) return true
      const data = r.data_json ? (JSON.parse(r.data_json) as NoteData) : null
      return !findEquivalentCard(db, r.target, targetMeaning({ kind: r.kind, text: r.text, target: r.target, data }).bn)
    })
    .map((r) => r.id)
}

export function flashcardStats(db: Db, now = new Date()): FlashcardStats {
  const total = (db.prepare(`SELECT COUNT(*) AS n FROM flashcards f LEFT JOIN notes n ON n.id = f.note_id WHERE ${REGULAR}`).get() as { n: number }).n
  const due = (db.prepare(`SELECT COUNT(*) AS n FROM flashcards f LEFT JOIN notes n ON n.id = f.note_id WHERE f.due <= ? AND ${REGULAR}`).get(endOfDay(now).toISOString()) as {
    n: number
  }).n
  return { total, due, notesWithoutCards: noteIdsWithoutFlashcards(db).length }
}

export function reviewFlashcard(db: Db, id: number, rating: ReviewRating, now = new Date()): Flashcard {
  return tx(db, () => {
    const card = getFlashcard(db, id)
    if (!card) throw new Error('Flashcard not found.')
    const next = reviewRevision(
      {
        step: card.step ?? 0,
        intervalDays: card.intervalDays ?? 0,
        ease: card.ease ?? 1,
        reps: card.reps,
        lapses: card.lapses,
        due: card.due,
        lastReviewedAt: card.lastReviewedAt ?? null,
        lastRating: card.lastRating ?? null
      },
      rating,
      now
    )
    db.prepare(
      `UPDATE flashcards SET due = ?, state = ?, reps = ?, lapses = ?, srs_step = ?, interval_days = ?, ease = ?,
         last_reviewed_at = ?, last_rating = ? WHERE id = ?`
    ).run(next.due, stateOf(next), next.reps, next.lapses, next.step, next.intervalDays, next.ease, next.lastReviewedAt, next.lastRating, id)
    db.prepare('INSERT INTO flashcard_reviews (flashcard_id, rating, reviewed_at) VALUES (?, ?, ?)').run(id, rating, now.toISOString())
    return getFlashcard(db, id)!
  })
}

/**
 * Edits a card. The English front is the item's target word/phrase, so it is saved on the item too
 * (one record, no copies drifting apart); the back is changed only for the fields given. The item's
 * original text, sentence and source are never changed.
 */
export function editFlashcard(db: Db, edit: FlashcardEdit): Flashcard {
  return tx(db, () => {
    const card = getFlashcard(db, edit.id)
    if (!card) throw new Error('Flashcard not found.')
    if (edit.front !== undefined) {
      const front = edit.front.replace(/\s+/g, ' ').trim()
      if (!front) throw new Error('The English front cannot be empty.')
      if (front.length > 120) throw new Error('The front is too long — use the word or phrase only.')
      db.prepare('UPDATE notes SET target = ? WHERE id = ?').run(front, card.noteId)
      db.prepare('UPDATE flashcards SET front = ? WHERE id = ?').run(front, edit.id)
    }
    const patch: Partial<FlashcardBack> = {}
    if (edit.meaningBn !== undefined) patch.meaning_bn = edit.meaningBn.trim()
    if (edit.meaningEn !== undefined) patch.meaning_en = edit.meaningEn.trim()
    if (edit.example !== undefined) patch.example = edit.example.trim()
    if (edit.exampleBn !== undefined) patch.example_bn = edit.exampleBn.trim()
    if (Object.keys(patch).length) db.prepare('UPDATE flashcards SET back_json = ? WHERE id = ?').run(JSON.stringify({ ...card.back, ...patch }), edit.id)
    return getFlashcard(db, edit.id)!
  })
}

/**
 * A regular card for the same word/phrase with the same meaning (so a second one isn't made). The same
 * word with a different meaning is a different card.
 */
export function findEquivalentCard(db: Db, target: string, meaningBn: string): Flashcard | null {
  const t = normTerm(target)
  const m = normTerm(meaningBn)
  const rows = db.prepare(`${SELECT} WHERE ${REGULAR}`).all() as unknown as FlashcardRow[]
  for (const row of rows) {
    const c = toFlashcard(row)
    if (normTerm(c.front) !== t) continue
    const cm = normTerm(c.back.meaning_bn)
    if (!m || !cm || cm === m) return c
  }
  return null
}

export function flashcardForNote(db: Db, noteId: number): Flashcard | null {
  const row = db.prepare(`${SELECT} WHERE f.note_id = ? ORDER BY f.id LIMIT 1`).get(noteId) as FlashcardRow | undefined
  return row ? toFlashcard(row) : null
}

export function deleteFlashcard(db: Db, id: number): void {
  db.prepare('DELETE FROM flashcards WHERE id = ?').run(id)
}

/** The revision dashboard: each list is capped at `limit` cards; counts are complete. */
export function revisionDashboard(db: Db, now = new Date(), limit = 30): RevisionDashboard {
  const cards = listFlashcards(db)
  const today = startOfDay(now).getTime()
  const tonight = endOfDay(now).getTime()
  const week = tonight + 7 * 86_400_000
  const recentFrom = today - 7 * 86_400_000
  const at = (iso: string): number => new Date(iso.includes('T') ? iso : `${iso.replace(' ', 'T')}Z`).getTime()
  const overdue = cards.filter((c) => at(c.due) < today)
  const dueToday = cards.filter((c) => at(c.due) >= today && at(c.due) <= tonight)
  const upcoming = cards.filter((c) => at(c.due) > tonight && at(c.due) <= week)
  const recent = cards.filter((c) => at(c.createdAt) >= recentFrom).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  const forgotten = cards.filter((c) => isFrequentlyForgotten(c)).sort((a, b) => b.lapses - a.lapses)
  const mastered = cards.filter((c) => c.mastered)
  return {
    counts: {
      dueToday: dueToday.length,
      overdue: overdue.length,
      upcoming: upcoming.length,
      recent: recent.length,
      forgotten: forgotten.length,
      mastered: mastered.length,
      total: cards.length
    },
    dueToday: dueToday.slice(0, limit),
    overdue: overdue.slice(0, limit),
    upcoming: upcoming.slice(0, limit),
    recent: recent.slice(0, limit),
    forgotten: forgotten.slice(0, limit),
    mastered: mastered.slice(0, limit)
  }
}
