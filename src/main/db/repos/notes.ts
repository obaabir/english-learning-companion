import { randomUUID } from 'node:crypto'
import { initialTarget } from '@shared/vocab'
import { noteDedupeKey, sourceTypeOf, type NewNoteInput, type Note, type NoteData, type NoteFilter, type NoteKind, type SourceType } from '@shared/types'
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
  article_id?: number | null
  uid?: string | null
  source_type?: SourceType | null
  source_url?: string | null
  ielts_ref?: string | null
  target?: string | null
  collection?: 'regular' | 'book' | null
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
  articleId: r.article_id ?? null,
  uid: r.uid ?? undefined,
  sourceType: r.source_type ?? undefined,
  sourceUrl: r.source_url ?? null,
  ieltsRef: r.ielts_ref ?? null,
  target: r.target ?? null,
  collection: r.collection ?? 'regular',
  syncStatus: r.gdoc_synced_at ? 'synced' : r.gdoc_error ? 'failed' : 'pending',
  createdAt: r.created_at
})

/** Source address: the article's URL, or the YouTube link (movies are local files). */
function sourceUrlFor(db: Db, input: NewNoteInput): string | null {
  if (input.articleId) {
    const a = db.prepare('SELECT url FROM articles WHERE id = ?').get(input.articleId) as { url: string } | undefined
    if (a && /^https?:\/\//.test(a.url)) return a.url
  }
  return input.mediaPath && /^https?:\/\//.test(input.mediaPath) ? input.mediaPath : null
}

/** An already-saved record that is the same item (same text, type, sentence and source), if any. */
export function findDuplicateNote(db: Db, input: NewNoteInput): Note | null {
  const key = noteDedupeKey({ ...input, text: input.text.trim() })
  const row = db.prepare('SELECT * FROM notes WHERE dedupe_key = ? ORDER BY id LIMIT 1').get(key) as NoteRow | undefined
  return row ? toNote(row) : null
}

export function insertNote(db: Db, input: NewNoteInput, data: NoteData | null): Note {
  // Your own Bangla meaning (e.g. from an imported list) is the start of the item's analysis.
  const seeded: NoteData | null =
    data ?? (input.meaningBn?.trim() ? { meaning_bn: input.meaningBn.trim(), meaning_en: '', vocabulary: [], idioms_phrasal: [], grammar: [], examples: [] } : null)
  const res = db
    .prepare(
      `INSERT INTO notes (kind, text, context_sentence, explanation_md, data_json, media_path, media_title, timestamp_sec, prompt_id, article_id,
         uid, source_type, source_url, ielts_ref, dedupe_key, target, collection)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      input.kind,
      input.text.trim(),
      input.contextSentence ?? null,
      input.explanationMd ?? null,
      seeded ? JSON.stringify(seeded) : null,
      input.mediaPath ?? null,
      input.mediaTitle ?? null,
      input.timestampSec ?? null,
      input.promptId ?? null,
      input.articleId ?? null,
      randomUUID(),
      sourceTypeOf(input),
      sourceUrlFor(db, input),
      input.ieltsRef ?? null,
      noteDedupeKey({ ...input, text: input.text.trim() }),
      // Words, phrases, idioms and short patterns are their own target; a sentence gets one from its analysis.
      initialTarget({ kind: input.kind, text: input.text, data: seeded }),
      input.collection ?? 'regular'
    )
  return getNote(db, Number(res.lastInsertRowid))!
}

/** Sets the word/phrase to learn (the flashcard front). */
export function setNoteTarget(db: Db, id: number, target: string | null): void {
  db.prepare('UPDATE notes SET target = ? WHERE id = ?').run(target?.trim() || null, id)
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
  if (filter.collection) {
    where.push("COALESCE(collection, 'regular') = ?")
    params.push(filter.collection)
  }
  if (filter.articleId) {
    where.push('article_id = ?')
    params.push(filter.articleId)
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
    "UPDATE notes SET gdoc_id = ?, gdoc_synced_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), gdoc_error = NULL, gdoc_attempt_at = NULL WHERE id = ?"
  ).run(docId, id)
}

/** keepAttempt: the append may have reached Google (e.g. the connection dropped), so check before retrying. */
export function markNoteSyncError(db: Db, id: number, error: string, keepAttempt = false): void {
  db.prepare(`UPDATE notes SET gdoc_error = ?${keepAttempt ? '' : ', gdoc_attempt_at = NULL'} WHERE id = ?`).run(error, id)
}

/** Recorded just before appending to a doc; cleared once the result is known. */
export function markNoteSyncAttempt(db: Db, id: number, docId: string): void {
  db.prepare("UPDATE notes SET gdoc_attempt_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), gdoc_id = ?, gdoc_synced_at = NULL WHERE id = ?").run(docId, id)
}

/** The doc of an append whose result is unknown, if any. */
export function noteSyncAttempt(db: Db, id: number): { docId: string } | null {
  const r = db.prepare('SELECT gdoc_attempt_at, gdoc_id FROM notes WHERE id = ?').get(id) as { gdoc_attempt_at: string | null; gdoc_id: string | null } | undefined
  return r?.gdoc_attempt_at && r.gdoc_id ? { docId: r.gdoc_id } : null
}

export function deleteNote(db: Db, id: number): void {
  db.prepare('DELETE FROM notes WHERE id = ?').run(id)
}
