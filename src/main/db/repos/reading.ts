import { randomUUID } from 'node:crypto'
import type { ArticleBlock } from '@shared/articles'
import { BOOK_PREFIX, type BookPage, type ReadingSession, type ReadingSessionInput, type ReadingTarget } from '@shared/reading'
import type { Db } from '../index'

interface Row {
  id: number
  article_id: number
  url: string
  name: string
  book_title: string
  author: string
  edition: string
  pages_json: string
  last_page: number
  last_paragraph: number
  history_json: string
  created_at: string
  updated_at: string
}

const SELECT = `SELECT r.*, a.url FROM reading_sessions r JOIN articles a ON a.id = r.article_id`
const HISTORY_MAX = 30

function toSession(r: Row): ReadingSession {
  return {
    id: r.id,
    articleId: r.article_id,
    url: r.url,
    name: r.name,
    bookTitle: r.book_title,
    author: r.author,
    edition: r.edition,
    pages: JSON.parse(r.pages_json) as BookPage[],
    lastPage: r.last_page,
    lastParagraph: r.last_paragraph,
    history: JSON.parse(r.history_json) as ReadingTarget[],
    createdAt: r.created_at,
    updatedAt: r.updated_at
  }
}

/** The passage as article text (a heading per page), so the Articles history can show it too. */
function toBlocks(pages: BookPage[]): ArticleBlock[] {
  return pages.flatMap((p) => [{ type: 'h' as const, level: 3, text: `Page ${p.label}` }, ...p.paragraphs.map((t) => ({ type: 'p' as const, text: t }))])
}

function cleanPages(pages: BookPage[]): BookPage[] {
  return pages
    .map((p, i) => ({ label: (p.label ?? '').trim() || String(i + 1), paragraphs: (p.paragraphs ?? []).map((t) => t.replace(/\s+/g, ' ').trim()).filter(Boolean), image: p.image ?? null }))
    .filter((p) => p.paragraphs.length)
}

/** Most recently used first. */
export function listReadingSessions(db: Db): ReadingSession[] {
  return (db.prepare(`${SELECT} ORDER BY r.updated_at DESC, r.id DESC`).all() as unknown as Row[]).map(toSession)
}

export function getReadingSession(db: Db, id: number): ReadingSession | null {
  const row = db.prepare(`${SELECT} WHERE r.id = ?`).get(id) as Row | undefined
  return row ? toSession(row) : null
}

/** Creates or updates a prepared passage. Its Articles entry is created once and kept in step with the text. */
export function saveReadingSession(db: Db, input: ReadingSessionInput): ReadingSession {
  const pages = cleanPages(input.pages)
  if (!pages.length) throw new Error('The passage is empty. Paste text or read the page photos first.')
  const name = input.name.trim() || input.bookTitle.trim() || `Reading ${new Date().toLocaleDateString()}`
  const title = input.bookTitle.trim() ? `${input.bookTitle.trim()} (pages ${pages[0].label}${pages.length > 1 ? `–${pages[pages.length - 1].label}` : ''})` : name
  const blocks = JSON.stringify(toBlocks(pages))
  const existing = input.id ? getReadingSession(db, input.id) : null
  if (existing) {
    db.prepare(`UPDATE articles SET title = ?, blocks_json = ?, byline = ?, last_opened_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`).run(
      title,
      blocks,
      input.author.trim() || null,
      existing.articleId
    )
    db.prepare(
      `UPDATE reading_sessions SET name = ?, book_title = ?, author = ?, edition = ?, pages_json = ?,
         last_page = MIN(last_page, ?), last_paragraph = 0, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`
    ).run(name, input.bookTitle.trim(), input.author.trim(), input.edition.trim(), JSON.stringify(pages), pages.length - 1, existing.id)
    return getReadingSession(db, existing.id)!
  }
  const url = `${BOOK_PREFIX}${randomUUID()}`
  const art = db.prepare('INSERT INTO articles (url, title, domain, byline, blocks_json) VALUES (?, ?, ?, ?, ?)').run(url, title, 'Book', input.author.trim() || null, blocks)
  const res = db
    .prepare('INSERT INTO reading_sessions (article_id, name, book_title, author, edition, pages_json) VALUES (?, ?, ?, ?, ?, ?)')
    .run(Number(art.lastInsertRowid), name, input.bookTitle.trim(), input.author.trim(), input.edition.trim(), JSON.stringify(pages))
  return getReadingSession(db, Number(res.lastInsertRowid))!
}

/** Where the reader is (page / paragraph). Also marks the session as the most recent one. */
export function setReadingPosition(db: Db, id: number, page: number, paragraph: number): void {
  db.prepare(`UPDATE reading_sessions SET last_page = ?, last_paragraph = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`).run(
    Math.max(0, Math.floor(page)),
    Math.max(0, Math.floor(paragraph)),
    id
  )
}

/** Remembers an explained word / sentence (most recent first; the same one moves to the top). */
export function addReadingTarget(db: Db, id: number, target: Omit<ReadingTarget, 'at'>): ReadingTarget[] {
  const s = getReadingSession(db, id)
  if (!s) throw new Error('Reading session not found.')
  const t: ReadingTarget = { ...target, text: target.text.trim().slice(0, 300), at: new Date().toISOString() }
  const same = (x: ReadingTarget): boolean => x.text.toLowerCase() === t.text.toLowerCase() && x.page === t.page && x.paragraph === t.paragraph
  const history = [t, ...s.history.filter((x) => !same(x))].slice(0, HISTORY_MAX)
  db.prepare('UPDATE reading_sessions SET history_json = ? WHERE id = ?').run(JSON.stringify(history), id)
  return history
}

/** Deletes the prepared passage (words already saved to Notes stay; they keep their sentence). */
export function deleteReadingSession(db: Db, id: number): void {
  const s = getReadingSession(db, id)
  if (!s) return
  db.prepare('DELETE FROM reading_sessions WHERE id = ?').run(id)
  // The Articles entry goes too, unless saved words still point to it.
  const used = db.prepare('SELECT 1 FROM notes WHERE article_id = ? LIMIT 1').get(s.articleId)
  if (!used) db.prepare('DELETE FROM articles WHERE id = ?').run(s.articleId)
}
