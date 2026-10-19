import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { Db } from './db'
import { migrate } from './db/migrations'

/**
 * Keeps the app's data in ONE place.
 *
 * When this app is started by another *packaged* Windows program (for example the Claude desktop app),
 * Windows silently redirects everything it saves under AppData\Roaming into that program's private
 * folder (…\AppData\Local\Packages\<program>\LocalCache\Roaming\…). The app then seems to "lose" words
 * and its Google sign-in, depending on how it was opened. This module:
 *  - notices when the app itself runs in such a private space (it then refuses to start, so nothing is
 *    saved in the wrong place), and
 *  - when started normally, finds such private copies, backs everything up, and adds what exists only
 *    there into the real data (never deleting or overwriting anything).
 */

const DB_FILE = 'english-companion.db'

/** The data folder relative to AppData\Roaming (null if it isn't under it, e.g. in tests). */
function roamingRelative(userData: string, env: NodeJS.ProcessEnv): string | null {
  const roaming = env.APPDATA
  if (!roaming) return null
  const rel = relative(roaming, userData)
  return rel && !rel.startsWith('..') && !rel.includes(':') ? rel : null
}

function packageCacheDirs(env: NodeJS.ProcessEnv, rel: string): string[] {
  const local = env.LOCALAPPDATA
  if (!local) return []
  const packages = join(local, 'Packages')
  if (!existsSync(packages)) return []
  const out: string[] = []
  for (const name of readdirSync(packages)) {
    const dir = join(packages, name, 'LocalCache', 'Roaming', rel)
    if (existsSync(dir)) out.push(dir)
  }
  return out
}

/** True when Windows is redirecting this app's saves into another program's private folder. */
export function runningInPrivateSpace(userData: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const rel = roamingRelative(userData, env)
  if (!rel) return false
  const probe = `.elc-space-probe-${process.pid}-${Date.now()}`
  try {
    mkdirSync(userData, { recursive: true })
    writeFileSync(join(userData, probe), 'probe')
    return packageCacheDirs(env, rel).some((dir) => existsSync(join(dir, probe)))
  } catch {
    return false
  } finally {
    try {
      unlinkSync(join(userData, probe))
    } catch {
      // already gone
    }
  }
}

/** Private copies of the database made while the app ran inside another program (not yet merged). */
export function findPrivateCopies(userData: string, env: NodeJS.ProcessEnv = process.env): string[] {
  const rel = roamingRelative(userData, env)
  if (!rel) return []
  return packageCacheDirs(env, rel).filter((dir) => existsSync(join(dir, DB_FILE)))
}

const sideFiles = (file: string): string[] => [file, `${file}-wal`, `${file}-shm`].filter((f) => existsSync(f))

/** Copies the real database files and every private copy into userData\backups\<time>. Returns the folder. */
export function backupBeforeMerge(userData: string, privateDirs: string[], now = new Date()): string {
  const dir = join(userData, 'backups', `before-merge-${now.toISOString().replace(/[:.]/g, '-')}`)
  mkdirSync(dir, { recursive: true })
  for (const f of sideFiles(join(userData, DB_FILE))) copyFileSync(f, join(dir, `real-${f.split(/[\\/]/).pop()}`))
  privateDirs.forEach((p, i) => {
    for (const f of sideFiles(join(p, DB_FILE))) copyFileSync(f, join(dir, `private${i + 1}-${f.split(/[\\/]/).pop()}`))
  })
  writeFileSync(join(dir, 'README.txt'), `Backup made before adding words saved in another program's private folder.\nPrivate folders:\n${privateDirs.join('\n')}\n`)
  return dir
}

export interface MergeReport {
  notes: number
  flashcards: number
  articles: number
  chats: number
  vocabBookWords: number
  vocabBooks: number
  prompts: number
  settings: number
  /** Secrets (API key, Google sign-in) that could be read from the private copy. */
  secretsCopied: string[]
  /** Secrets present there but encrypted with that copy's own key (can't be read here). */
  secretsUnreadable: string[]
  googleBackupSaved: boolean
}

type Row = Record<string, unknown>
const cols = (db: DatabaseSync | Db, table: string): string[] => (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name)
const hasTable = (db: DatabaseSync | Db, t: string): boolean => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name = ?").get(t)

/** Inserts `row` into `table` using the columns both databases have (id left out); returns the new id. */
function insertRow(db: Db, table: string, row: Row, override: Row = {}): number {
  const target = new Set(cols(db, table))
  const data: Row = { ...row, ...override }
  delete data.id
  const keys = Object.keys(data).filter((k) => target.has(k))
  const res = db.prepare(`INSERT INTO ${table} (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`).run(...(keys.map((k) => data[k]) as never[]))
  return Number(res.lastInsertRowid)
}

/**
 * Adds what exists only in the private copy (`privateDbFile`) into `db`: notes (by their unique ID) with
 * their flashcards and review history, articles (by address), chats, prompts (by name), Google Doc
 * choices, Vocabulary Book books / words (by unique ID) with reviews and mistakes, and missing
 * settings. Secrets are copied only if `decrypt` can read them. Nothing in `db` is changed or deleted.
 */
export function mergePrivateCopy(db: Db, privateDbFile: string, decrypt: (stored: string) => string | null, encrypt: (plain: string) => string): MergeReport {
  const report: MergeReport = { notes: 0, flashcards: 0, articles: 0, chats: 0, vocabBookWords: 0, vocabBooks: 0, prompts: 0, settings: 0, secretsCopied: [], secretsUnreadable: [], googleBackupSaved: false }
  // Work on a copy, brought to the same schema (the private file itself is never written).
  const tmp = mkdtempSync(join(tmpdir(), 'elc-merge-'))
  const copy = join(tmp, DB_FILE)
  for (const f of sideFiles(privateDbFile)) copyFileSync(f, join(tmp, `${DB_FILE}${f.slice(privateDbFile.length)}`))
  const src = new DatabaseSync(copy)
  try {
    migrate(src)
    db.exec('BEGIN')
    try {
      // Articles (by address).
      const articleMap = new Map<number, number>()
      if (hasTable(src, 'articles')) {
        for (const a of src.prepare('SELECT * FROM articles').all() as Row[]) {
          const have = db.prepare('SELECT id FROM articles WHERE url = ?').get(a.url as string) as { id: number } | undefined
          if (have) articleMap.set(a.id as number, have.id)
          else {
            articleMap.set(a.id as number, insertRow(db, 'articles', a))
            report.articles++
          }
        }
      }
      // Prompts (by name).
      const promptMap = new Map<number, number>()
      for (const p of src.prepare('SELECT * FROM prompts').all() as Row[]) {
        const have = db.prepare('SELECT id FROM prompts WHERE name = ?').get(p.name as string) as { id: number } | undefined
        if (have) promptMap.set(p.id as number, have.id)
        else {
          promptMap.set(p.id as number, insertRow(db, 'prompts', p, { is_default: 0 }))
          report.prompts++
        }
      }
      // Notes (by unique ID; the same item saved in both is recognised by its dedupe key too).
      const noteMap = new Map<number, number>()
      for (const n of src.prepare('SELECT * FROM notes ORDER BY id').all() as Row[]) {
        const have =
          (db.prepare('SELECT id FROM notes WHERE uid = ?').get(n.uid as string) as { id: number } | undefined) ??
          (n.dedupe_key ? (db.prepare('SELECT id FROM notes WHERE dedupe_key = ?').get(n.dedupe_key as string) as { id: number } | undefined) : undefined)
        if (have) continue
        const id = insertRow(db, 'notes', n, {
          article_id: n.article_id ? (articleMap.get(n.article_id as number) ?? null) : null,
          prompt_id: n.prompt_id ? (promptMap.get(n.prompt_id as number) ?? null) : null
        })
        noteMap.set(n.id as number, id)
        report.notes++
      }
      // Their flashcards and review history.
      for (const [oldNote, newNote] of noteMap) {
        for (const c of src.prepare('SELECT * FROM flashcards WHERE note_id = ?').all(oldNote) as Row[]) {
          const cid = insertRow(db, 'flashcards', c, { note_id: newNote })
          report.flashcards++
          for (const r of src.prepare('SELECT * FROM flashcard_reviews WHERE flashcard_id = ?').all(c.id as number) as Row[]) insertRow(db, 'flashcard_reviews', r, { flashcard_id: cid })
        }
      }
      // Chats with their messages (a chat is the same if title and start time match).
      for (const c of src.prepare('SELECT * FROM chats').all() as Row[]) {
        if (db.prepare('SELECT 1 FROM chats WHERE title = ? AND created_at = ?').get(c.title as string, c.created_at as string)) continue
        const cid = insertRow(db, 'chats', c, {
          ...(c.prompt_id !== undefined ? { prompt_id: c.prompt_id ? (promptMap.get(c.prompt_id as number) ?? null) : null } : {}),
          ...(c.note_id !== undefined ? { note_id: c.note_id ? (noteMap.get(c.note_id as number) ?? null) : null } : {})
        })
        for (const m of src.prepare('SELECT * FROM chat_messages WHERE chat_id = ? ORDER BY id').all(c.id as number) as Row[]) insertRow(db, 'chat_messages', m, { chat_id: cid })
        report.chats++
      }
      // Google Doc choices that the real data doesn't have yet.
      for (const t of src.prepare('SELECT * FROM doc_targets').all() as Row[]) {
        if (!db.prepare('SELECT 1 FROM doc_targets WHERE category = ?').get(t.category as string)) insertRow(db, 'doc_targets', t)
      }
      for (const m of src.prepare('SELECT * FROM movie_docs').all() as Row[]) {
        if (!db.prepare('SELECT 1 FROM movie_docs WHERE media_path = ?').get(m.media_path as string)) insertRow(db, 'movie_docs', m)
      }
      // Vocabulary Book: books (by name + start time), sources, words (by unique ID), reviews, mistakes.
      if (hasTable(src, 'vb_books')) {
        const bookMap = new Map<number, number>()
        for (const b of src.prepare('SELECT * FROM vb_books ORDER BY id').all() as Row[]) {
          const have = db.prepare('SELECT id FROM vb_books WHERE title = ? AND created_at = ?').get(b.title as string, b.created_at as string) as { id: number } | undefined
          if (have) bookMap.set(b.id as number, have.id)
          else {
            bookMap.set(b.id as number, insertRow(db, 'vb_books', b))
            report.vocabBooks++
          }
        }
        const sourceMap = new Map<number, number>()
        for (const s of src.prepare('SELECT * FROM vb_sources ORDER BY id').all() as Row[]) {
          const book = bookMap.get(s.book_id as number)!
          const have = db.prepare('SELECT id FROM vb_sources WHERE book_id = ? AND kind = ? AND created_at = ?').get(book, s.kind as string, s.created_at as string) as { id: number } | undefined
          sourceMap.set(s.id as number, have ? have.id : insertRow(db, 'vb_sources', s, { book_id: book }))
        }
        for (const it of src.prepare('SELECT * FROM vb_items ORDER BY book_id, seq').all() as Row[]) {
          if (db.prepare('SELECT 1 FROM vb_items WHERE uid = ?').get(it.uid as string)) continue
          const book = bookMap.get(it.book_id as number)!
          // Kept in its order, after the words the book already has.
          const seq = ((db.prepare('SELECT COALESCE(MAX(seq), 0) AS m FROM vb_items WHERE book_id = ?').get(book) as { m: number }).m ?? 0) + 1
          const iid = insertRow(db, 'vb_items', it, { book_id: book, source_id: it.source_id ? (sourceMap.get(it.source_id as number) ?? null) : null, seq })
          for (const r of src.prepare('SELECT * FROM vb_reviews WHERE item_id = ?').all(it.id as number) as Row[]) insertRow(db, 'vb_reviews', r, { item_id: iid })
          for (const m of src.prepare('SELECT * FROM vb_mistakes WHERE item_id = ?').all(it.id as number) as Row[]) insertRow(db, 'vb_mistakes', m, { item_id: iid })
          report.vocabBookWords++
        }
      }
      // Settings that are missing here; secrets only if they can be read.
      for (const s of src.prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[]) {
        const mine = db.prepare('SELECT value FROM settings WHERE key = ?').get(s.key) as { value: string } | undefined
        if (s.key.startsWith('secret.')) {
          const name = s.key.slice('secret.'.length)
          const plain = decrypt(s.value)
          if (plain === null) {
            report.secretsUnreadable.push(name)
            continue
          }
          if (!mine) {
            db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run(s.key, encrypt(plain))
            report.secretsCopied.push(name)
          } else if (name === 'googleRefreshToken' && decrypt(mine.value) !== plain) {
            // Two different Google sign-ins: keep the other one in reserve (used if this one was revoked).
            db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('secret.googleRefreshTokenBackup', encrypt(plain))
            report.googleBackupSaved = true
          }
          continue
        }
        if (!mine) {
          db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run(s.key, s.value)
          report.settings++
        }
      }
      db.exec('COMMIT')
    } catch (err) {
      db.exec('ROLLBACK')
      throw err
    }
  } finally {
    src.close()
    rmSync(tmp, { recursive: true, force: true })
  }
  return report
}

/** After a successful merge the private copy is renamed, so it is never added twice. */
export function markPrivateCopyMerged(privateDir: string, now = new Date()): void {
  const stamp = now.toISOString().replace(/[:.]/g, '-')
  for (const f of sideFiles(join(privateDir, DB_FILE))) renameSync(f, `${f}.merged-${stamp}`)
}

/** Copies Vocabulary Book pictures saved in the private copy that the real folder doesn't have. */
export function copyPrivateImages(privateDir: string, userData: string): number {
  const from = join(privateDir, 'vocab-book', 'images')
  if (!existsSync(from)) return 0
  const to = join(userData, 'vocab-book', 'images')
  mkdirSync(to, { recursive: true })
  let n = 0
  for (const f of readdirSync(from)) {
    if (!existsSync(join(to, f)) && statSync(join(from, f)).isFile()) {
      copyFileSync(join(from, f), join(to, f))
      n++
    }
  }
  return n
}
