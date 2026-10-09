import type { DocCategory, DocTarget } from '@shared/types'
import type { Db } from '../index'

export function getSetting(db: Db, key: string): string | null {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined
  return row?.value ?? null
}

export function setSetting(db: Db, key: string, value: string | null): void {
  if (value === null) {
    db.prepare('DELETE FROM settings WHERE key = ?').run(key)
  } else {
    db.prepare(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
    ).run(key, value)
  }
}

export function listDocTargets(db: Db): DocTarget[] {
  const rows = db.prepare('SELECT category, doc_id, title FROM doc_targets').all() as {
    category: DocCategory
    doc_id: string
    title: string
  }[]
  return rows.map((r) => ({ category: r.category, docId: r.doc_id, title: r.title }))
}

export function getDocTarget(db: Db, category: DocCategory): DocTarget | null {
  return listDocTargets(db).find((t) => t.category === category) ?? null
}

export interface MovieDoc {
  mediaPath: string
  mediaTitle: string | null
  docId: string
  docTitle: string
}

export function getMovieDoc(db: Db, mediaPath: string): MovieDoc | null {
  const r = db.prepare('SELECT * FROM movie_docs WHERE media_path = ?').get(mediaPath) as
    | { media_path: string; media_title: string | null; doc_id: string; doc_title: string }
    | undefined
  return r ? { mediaPath: r.media_path, mediaTitle: r.media_title, docId: r.doc_id, docTitle: r.doc_title } : null
}

export function setMovieDoc(db: Db, doc: MovieDoc): void {
  db.prepare(
    `INSERT INTO movie_docs (media_path, media_title, doc_id, doc_title) VALUES (?, ?, ?, ?)
     ON CONFLICT(media_path) DO UPDATE SET media_title = excluded.media_title, doc_id = excluded.doc_id, doc_title = excluded.doc_title`
  ).run(doc.mediaPath, doc.mediaTitle, doc.docId, doc.docTitle)
}

export function setDocTarget(db: Db, target: DocTarget): void {
  db.prepare(
    `INSERT INTO doc_targets (category, doc_id, title) VALUES (?, ?, ?)
     ON CONFLICT(category) DO UPDATE SET doc_id = excluded.doc_id, title = excluded.title`
  ).run(target.category, target.docId, target.title)
}
