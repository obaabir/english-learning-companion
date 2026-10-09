import type { NewNoteInput, Note, NoteData, NoteFilter, NoteKind } from '@shared/types'
import type { Db } from '../index'

interface NoteRow {
  id: number
  kind: NoteKind
  text: string
  context_sentence: string | null
  explanation_md: string | null
  data_json: string | null
  media_path: string | null
  media_title: string | null
  timestamp_sec: number | null
  prompt_id: number | null
  gdoc_id: string | null
  gdoc_synced_at: string | null
  gdoc_error: string | null
  user_note: string | null
  created_at: string
}

const toNote = (r: NoteRow): Note => ({
  id: r.id,
  kind: r.kind,
  text: r.text,
  contextSentence: r.context_sentence,
  explanationMd: r.explanation_md,
  data: r.data_json ? (JSON.parse(r.data_json) as NoteData) : null,
  mediaPath: r.media_path,
  mediaTitle: r.media_title,
  timestampSec: r.timestamp_sec,
  promptId: r.prompt_id,
  gdocId: r.gdoc_id,
  gdocSyncedAt: r.gdoc_synced_at,
  gdocError: r.gdoc_error,
  userNote: r.user_note,
  createdAt: r.created_at
})

export function insertNote(db: Db, input: NewNoteInput, data: NoteData | null): Note {
  const res = db
    .prepare(
      `INSERT INTO notes (kind, text, context_sentence, explanation_md, data_json, media_path, media_title, timestamp_sec, prompt_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      input.kind,
      input.text.trim(),
      input.contextSentence ?? null,
      input.explanationMd ?? null,
      data ? JSON.stringify(data) : null,
      input.mediaPath ?? null,
      input.mediaTitle ?? null,
      input.timestampSec ?? null,
      input.promptId ?? null
    )
  return getNote(db, Number(res.lastInsertRowid))!
}

export function getNote(db: Db, id: number): Note | null {
  const row = db.prepare('SELECT * FROM notes WHERE id = ?').get(id) as NoteRow | undefined
  return row ? toNote(row) : null
}

export function listNotes(db: Db, filter: NoteFilter = {}): Note[] {
  const where: string[] = []
  const params: (string | number)[] = []
  if (filter.kinds?.length) {
    where.push(`kind IN (${filter.kinds.map(() => '?').join(',')})`)
    params.push(...filter.kinds)
  }
  if (filter.search?.trim()) {
    const like = `%${filter.search.trim().replace(/[%_\\]/g, (c) => '\\' + c)}%`
    where.push("(text LIKE ? ESCAPE '\\' OR context_sentence LIKE ? ESCAPE '\\' OR data_json LIKE ? ESCAPE '\\')")
    params.push(like, like, like)
  }
  if (filter.mediaPath) {
    where.push('media_path = ?')
    params.push(filter.mediaPath)
  } else if (filter.mediaTitle) {
    where.push('media_title = ?')
    params.push(filter.mediaTitle)
  }
  const sql = `SELECT * FROM notes ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY created_at DESC, id DESC`
  return (db.prepare(sql).all(...params) as unknown as NoteRow[]).map(toNote)
}

export function listMediaTitles(db: Db): string[] {
  const rows = db
    .prepare('SELECT DISTINCT media_title FROM notes WHERE media_title IS NOT NULL ORDER BY media_title')
    .all() as { media_title: string }[]
  return rows.map((r) => r.media_title)
}

/** Movies that have saved notes, most recently used first. The file path is the movie's identity. */
export function listNoteMovies(db: Db): { mediaPath: string; mediaTitle: string; noteCount: number }[] {
  const rows = db
    .prepare(
      `SELECT media_path, MAX(media_title) AS media_title, COUNT(*) AS n
       FROM notes WHERE media_path IS NOT NULL AND media_path != ''
       GROUP BY media_path ORDER BY MAX(created_at) DESC`
    )
    .all() as { media_path: string; media_title: string | null; n: number }[]
  return rows.map((r) => ({ mediaPath: r.media_path, mediaTitle: r.media_title ?? r.media_path, noteCount: r.n }))
}

/** A movie's notes that are not yet in the given Google Doc, oldest first. */
export function movieNoteIdsNotInDoc(db: Db, mediaPath: string, docId: string): number[] {
  const rows = db
    .prepare(
      `SELECT id FROM notes WHERE media_path = ?
       AND (gdoc_synced_at IS NULL OR gdoc_id IS NULL OR gdoc_id != ?)
       ORDER BY created_at, id`
    )
    .all(mediaPath, docId) as { id: number }[]
  return rows.map((r) => r.id)
}

export function updateUserNote(db: Db, id: number, userNote: string): void {
  db.prepare('UPDATE notes SET user_note = ? WHERE id = ?').run(userNote.trim() || null, id)
}

export function updateNoteData(db: Db, id: number, data: NoteData | null): void {
  db.prepare('UPDATE notes SET data_json = ? WHERE id = ?').run(data ? JSON.stringify(data) : null, id)
}

export function updateNoteKind(db: Db, id: number, kind: NoteKind): void {
  db.prepare('UPDATE notes SET kind = ? WHERE id = ?').run(kind, id)
}

export function markNoteSynced(db: Db, id: number, docId: string): void {
  db.prepare(
    "UPDATE notes SET gdoc_id = ?, gdoc_synced_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), gdoc_error = NULL WHERE id = ?"
  ).run(docId, id)
}

export function markNoteSyncError(db: Db, id: number, error: string): void {
  db.prepare('UPDATE notes SET gdoc_error = ? WHERE id = ?').run(error, id)
}

export function deleteNote(db: Db, id: number): void {
  db.prepare('DELETE FROM notes WHERE id = ?').run(id)
}
