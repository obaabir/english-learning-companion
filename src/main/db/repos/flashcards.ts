import type { Flashcard, FlashcardBack, FlashcardStats, ReviewRating } from '@shared/types'
import { tx, type Db } from '../index'
import { newCard, reviewCard, type StoredCard } from '../../srs/fsrs'

interface FlashcardRow {
  id: number
  note_id: number
  front: string
  back_json: string
  card_json: string
  due: string
  state: number
  reps: number
  lapses: number
  created_at: string
}

const toFlashcard = (r: FlashcardRow): Flashcard => ({
  id: r.id,
  noteId: r.note_id,
  front: r.front,
  back: JSON.parse(r.back_json) as FlashcardBack,
  due: r.due,
  state: r.state,
  reps: r.reps,
  lapses: r.lapses,
  createdAt: r.created_at
})

export function insertFlashcard(db: Db, noteId: number, front: string, back: FlashcardBack, now = new Date()): Flashcard {
  const card = newCard(now)
  const res = db
    .prepare(
      `INSERT INTO flashcards (note_id, front, back_json, card_json, due, state, reps, lapses)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(noteId, front, JSON.stringify(back), JSON.stringify(card), card.due, card.state, card.reps, card.lapses)
  return getFlashcard(db, Number(res.lastInsertRowid))!
}

export function getFlashcard(db: Db, id: number): Flashcard | null {
  const row = db.prepare('SELECT * FROM flashcards WHERE id = ?').get(id) as FlashcardRow | undefined
  return row ? toFlashcard(row) : null
}

export function listFlashcards(db: Db): Flashcard[] {
  return (db.prepare('SELECT * FROM flashcards ORDER BY due').all() as unknown as FlashcardRow[]).map(toFlashcard)
}

export function listDueFlashcards(db: Db, limit = 50, now = new Date()): Flashcard[] {
  return (
    db.prepare('SELECT * FROM flashcards WHERE due <= ? ORDER BY due LIMIT ?').all(now.toISOString(), limit) as unknown as FlashcardRow[]
  ).map(toFlashcard)
}

export function noteIdsWithoutFlashcards(db: Db): number[] {
  const rows = db
    .prepare('SELECT id FROM notes WHERE id NOT IN (SELECT note_id FROM flashcards) ORDER BY id')
    .all() as { id: number }[]
  return rows.map((r) => r.id)
}

export function flashcardStats(db: Db, now = new Date()): FlashcardStats {
  const total = (db.prepare('SELECT COUNT(*) AS n FROM flashcards').get() as { n: number }).n
  const due = (db.prepare('SELECT COUNT(*) AS n FROM flashcards WHERE due <= ?').get(now.toISOString()) as { n: number }).n
  return { total, due, notesWithoutCards: noteIdsWithoutFlashcards(db).length }
}

export function reviewFlashcard(db: Db, id: number, rating: ReviewRating, now = new Date()): Flashcard {
  return tx(db, () => {
    const row = db.prepare('SELECT card_json FROM flashcards WHERE id = ?').get(id) as { card_json: string } | undefined
    if (!row) throw new Error('Flashcard not found.')
    const next = reviewCard(JSON.parse(row.card_json) as StoredCard, rating, now)
    db.prepare('UPDATE flashcards SET card_json = ?, due = ?, state = ?, reps = ?, lapses = ? WHERE id = ?').run(
      JSON.stringify(next),
      next.due,
      next.state,
      next.reps,
      next.lapses,
      id
    )
    db.prepare('INSERT INTO flashcard_reviews (flashcard_id, rating, reviewed_at) VALUES (?, ?, ?)').run(
      id,
      rating,
      now.toISOString()
    )
    return getFlashcard(db, id)!
  })
}

export function deleteFlashcard(db: Db, id: number): void {
  db.prepare('DELETE FROM flashcards WHERE id = ?').run(id)
}
