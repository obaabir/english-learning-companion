import { domainOf, SENTENCE_KINDS, VOCAB_KINDS, type Article, type ArticleBlock, type ArticleDetail, type ArticleInput } from '@shared/articles'
import type { Db } from '../index'

interface ArticleRow {
  id: number
  url: string
  title: string
  domain: string
  site_name: string | null
  byline: string | null
  excerpt: string | null
  blocks_json: string | null
  personal_note: string | null
  first_opened_at: string
  last_opened_at: string
  vocab_count: number
  sentence_count: number
  other_count: number
}

const inList = (kinds: string[]): string => kinds.map((k) => `'${k}'`).join(',')

const SELECT = `
  SELECT a.*,
    (SELECT COUNT(*) FROM notes n WHERE n.article_id = a.id AND n.kind IN (${inList(VOCAB_KINDS)})) AS vocab_count,
    (SELECT COUNT(*) FROM notes n WHERE n.article_id = a.id AND n.kind IN (${inList(SENTENCE_KINDS)})) AS sentence_count,
    (SELECT COUNT(*) FROM notes n WHERE n.article_id = a.id AND n.kind NOT IN (${inList([...VOCAB_KINDS, ...SENTENCE_KINDS])})) AS other_count
  FROM articles a`

const toArticle = (r: ArticleRow): Article => ({
  id: r.id,
  url: r.url,
  title: r.title,
  domain: r.domain,
  siteName: r.site_name,
  byline: r.byline,
  excerpt: r.excerpt,
  personalNote: r.personal_note,
  firstOpenedAt: r.first_opened_at,
  lastOpenedAt: r.last_opened_at,
  hasSnapshot: !!r.blocks_json,
  vocabCount: r.vocab_count,
  sentenceCount: r.sentence_count,
  otherCount: r.other_count
})

const textLength = (blocks: ArticleBlock[] | null | undefined): number => (blocks ?? []).reduce((n, b) => n + b.text.length, 0)

/** Keeps a stored copy small enough for SQLite and the UI: about 300k characters. */
function capBlocks(blocks: ArticleBlock[]): ArticleBlock[] {
  const out: ArticleBlock[] = []
  let total = 0
  for (const b of blocks) {
    const text = b.text.trim().slice(0, 20_000)
    if (!text) continue
    total += text.length
    if (total > 300_000 || out.length >= 3000) break
    out.push({ ...b, text })
  }
  return out
}

/**
 * Opening an article: adds it to the history, or updates its last-opened time. The stored copy of
 * the original text is replaced only by a longer one, so a later, failed load never wipes it.
 */
export function recordArticle(db: Db, input: ArticleInput): Article {
  const url = input.url.trim()
  if (!url) throw new Error('The article has no address.')
  const title = input.title.trim() || domainOf(url)
  const existing = db.prepare('SELECT id, blocks_json FROM articles WHERE url = ?').get(url) as { id: number; blocks_json: string | null } | undefined
  const blocks = input.blocks?.length ? capBlocks(input.blocks) : null
  if (!existing) {
    const res = db
      .prepare('INSERT INTO articles (url, title, domain, site_name, byline, excerpt, blocks_json) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(url, title, domainOf(url), input.siteName ?? null, input.byline ?? null, input.excerpt ?? null, blocks ? JSON.stringify(blocks) : null)
    return getArticle(db, Number(res.lastInsertRowid))!
  }
  const stored = existing.blocks_json ? (JSON.parse(existing.blocks_json) as ArticleBlock[]) : null
  const better = blocks && textLength(blocks) > textLength(stored)
  db.prepare(
    `UPDATE articles SET last_opened_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
       title = CASE WHEN ? THEN ? ELSE title END,
       site_name = COALESCE(?, site_name), byline = COALESCE(?, byline), excerpt = COALESCE(?, excerpt),
       blocks_json = CASE WHEN ? THEN ? ELSE blocks_json END
     WHERE id = ?`
  ).run(better ? 1 : 0, title, input.siteName ?? null, input.byline ?? null, input.excerpt ?? null, better ? 1 : 0, better ? JSON.stringify(blocks) : null, existing.id)
  return getArticle(db, existing.id)!
}

export function getArticle(db: Db, id: number): Article | null {
  const row = db.prepare(`${SELECT} WHERE a.id = ?`).get(id) as ArticleRow | undefined
  return row ? toArticle(row) : null
}

export function getArticleDetail(db: Db, id: number): ArticleDetail | null {
  const row = db.prepare(`${SELECT} WHERE a.id = ?`).get(id) as ArticleRow | undefined
  if (!row) return null
  return { ...toArticle(row), blocks: row.blocks_json ? (JSON.parse(row.blocks_json) as ArticleBlock[]) : [] }
}

/** Oldest first (the history groups them as Day 1, Day 2, …). */
export function listArticles(db: Db): Article[] {
  return (db.prepare(`${SELECT} ORDER BY a.first_opened_at, a.id`).all() as unknown as ArticleRow[]).map(toArticle)
}

export function setArticleNote(db: Db, id: number, note: string): Article {
  db.prepare('UPDATE articles SET personal_note = ? WHERE id = ?').run(note.trim() ? note : null, id)
  const a = getArticle(db, id)
  if (!a) throw new Error('Article not found.')
  return a
}
