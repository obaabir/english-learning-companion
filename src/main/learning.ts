import { FLASHCARD_KINDS, type Note } from '@shared/types'
import { initialTarget, normTerm, targetMeaning } from '@shared/vocab'
import type { Db } from './db'
import { getNote, setNoteTarget } from './db/repos/notes'
import { findEquivalentCard, flashcardForNote, insertFlashcard } from './db/repos/flashcards'

/**
 * Makes sure a saved item has its word/phrase to learn (target) and its regular flashcard — made from
 * the item itself, so anything saved anywhere is in flashcards and games without being copied anywhere.
 * The same word with the same meaning already on a card is not added twice. Returns the item.
 */
export function ensureTargetAndCard(db: Db, id: number): Note | null {
  let note = getNote(db, id)
  if (!note) return null
  if (!note.target) {
    const t = initialTarget(note)
    if (t) {
      setNoteTarget(db, id, t)
      note = getNote(db, id)!
    }
  }
  const target = note.target
  if ((note.collection ?? 'regular') !== 'regular' || !FLASHCARD_KINDS.includes(note.kind) || !target) return note
  if (flashcardForNote(db, id)) return note
  const m = targetMeaning(note)
  if (findEquivalentCard(db, target, m.bn)) return note
  const term = [...(note.data?.idioms_phrasal ?? []), ...(note.data?.vocabulary ?? [])].find((t) => normTerm(t.term) === normTerm(target))
  const ex = note.data?.examples?.[0]
  insertFlashcard(db, id, target, {
    meaning_bn: m.bn,
    meaning_en: m.en,
    example: ex?.en ?? '',
    example_bn: ex?.bn ?? '',
    note: term?.note ?? note.data?.grammar?.[0]?.explanation ?? ''
  })
  return note
}

/**
 * An item with its flashcard (revision status), as the app lists it. The same word with the same
 * meaning saved again (e.g. from another film) shares the card made earlier.
 */
export function withFlashcard(db: Db, n: Note): Note {
  const own = flashcardForNote(db, n.id)
  const shared =
    !own && n.target && (n.collection ?? 'regular') === 'regular' && FLASHCARD_KINDS.includes(n.kind) ? findEquivalentCard(db, n.target, targetMeaning(n).bn) : null
  const c = own ?? shared
  return {
    ...n,
    flashcard: c ? { id: c.id, due: c.due, reps: c.reps, lapses: c.lapses, intervalDays: c.intervalDays ?? 0, mastered: !!c.mastered, ...(shared ? { shared: true } : {}) } : null
  }
}
