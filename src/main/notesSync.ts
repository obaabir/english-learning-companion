import { DOC_CATEGORIES, docCategoryForKind, type Note } from '@shared/types'
import type { Db } from './db'
import { getMovieDoc, getDocTarget } from './db/repos/settings'
import { getNote, listNotes, markNoteSynced, markNoteSyncError, movieNoteIdsNotInDoc } from './db/repos/notes'
import { noteToDocEntry, type DocEntry } from './google/docs'

export type AppendEntry = (docId: string, entry: DocEntry) => Promise<void>

export interface MovieSyncResult {
  added: number
  alreadyThere: number
  failed: number
  error: string | null
}

/** Saving notes into Google Docs. appendEntry is the real Docs API in the app and a fake in tests. */
export function createNoteSync(db: Db, appendEntry: AppendEntry) {
  /** Where a note goes: its movie's own Google Doc if one is chosen, otherwise the category doc from Settings. */
  const docFor = (note: Note): { docId: string } | null => {
    const movieDoc = note.mediaPath ? getMovieDoc(db, note.mediaPath) : null
    if (movieDoc) return { docId: movieDoc.docId }
    const target = getDocTarget(db, docCategoryForKind(note.kind))
    return target ? { docId: target.docId } : null
  }

  /**
   * Appends a note to its Google Doc; records (rather than throws) failures.
   * A note already in that doc is not appended again, so repeated saves never duplicate it.
   */
  const syncNote = async (id: number): Promise<Note> => {
    const note = getNote(db, id)
    if (!note) throw new Error('Note not found.')
    const target = docFor(note)
    if (target && note.gdocSyncedAt && note.gdocId === target.docId) return note
    try {
      if (!target) {
        const label = DOC_CATEGORIES.find((c) => c.value === docCategoryForKind(note.kind))?.label
        throw new Error(
          note.mediaPath
            ? 'Choose a Google Doc for this movie in Notes (or a default doc in Settings → Google Docs).'
            : `Choose a Google Doc for "${label}" in Settings → Google Docs.`
        )
      }
      await appendEntry(target.docId, noteToDocEntry(note))
      markNoteSynced(db, id, target.docId)
    } catch (err) {
      markNoteSyncError(db, id, err instanceof Error ? err.message : String(err))
    }
    return getNote(db, id)!
  }

  /** Appends a movie's notes that are not yet in its Google Doc, oldest first. */
  const syncMovie = async (mediaPath: string): Promise<MovieSyncResult> => {
    const doc = getMovieDoc(db, mediaPath)
    if (!doc) throw new Error('Choose or create a Google Doc for this movie first.')
    const total = listNotes(db, { mediaPath }).length
    const ids = movieNoteIdsNotInDoc(db, mediaPath, doc.docId)
    let added = 0
    let failed = 0
    let error: string | null = null
    for (const id of ids) {
      const note = await syncNote(id)
      if (note.gdocSyncedAt && note.gdocId === doc.docId && !note.gdocError) {
        added++
      } else {
        failed++
        error = note.gdocError ?? error
        // Stop on the first failure (e.g. expired sign-in) instead of failing every note.
        break
      }
    }
    return { added, alreadyThere: total - ids.length, failed, error }
  }

  /**
   * Sends every note that isn't in Google Docs yet (oldest first), e.g. notes saved while
   * offline or before Google was connected. Notes with no destination doc are skipped;
   * it stops at the first failure so an expired sign-in doesn't mark every note as failed.
   */
  const syncPending = async (): Promise<{ added: number; error: string | null }> => {
    const ids = (db.prepare('SELECT id FROM notes WHERE gdoc_synced_at IS NULL ORDER BY created_at, id').all() as { id: number }[]).map((r) => r.id)
    let added = 0
    for (const id of ids) {
      const note = getNote(db, id)
      if (!note || !docFor(note)) continue
      const synced = await syncNote(id)
      if (synced.gdocError || !synced.gdocSyncedAt) return { added, error: synced.gdocError }
      added++
    }
    return { added, error: null }
  }

  return { syncNote, syncMovie, syncPending }
}
