import { describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDatabase } from '../src/main/db'
import { insertNote, listNotes } from '../src/main/db/repos/notes'
import { insertFlashcard, listFlashcards, reviewFlashcard } from '../src/main/db/repos/flashcards'
import { recordArticle } from '../src/main/db/repos/articles'
import { createBook, importItems, listItems, listMistakes, recordAnswer } from '../src/main/db/repos/vocabBook'
import { getSetting, setSetting } from '../src/main/db/repos/settings'
import { backupBeforeMerge, copyPrivateImages, findPrivateCopies, markPrivateCopyMerged, mergePrivateCopy, runningInPrivateSpace } from '../src/main/dataSplit'

const back = { meaning_bn: '', meaning_en: '', example: '', example_bn: '', note: '' }
const raw = (s: string): string => `raw:${Buffer.from(s, 'utf8').toString('base64')}`
const decrypt = (stored: string): string | null => (stored.startsWith('raw:') ? Buffer.from(stored.slice(4), 'base64').toString('utf8') : null)

/** A Windows-like layout: AppData\Roaming\English Learning Companion + a program's private copy of it. */
function layout() {
  const root = mkdtempSync(join(tmpdir(), 'elc-split-'))
  const env = { APPDATA: join(root, 'Roaming'), LOCALAPPDATA: join(root, 'Local') } as NodeJS.ProcessEnv
  const userData = join(root, 'Roaming', 'English Learning Companion')
  const privateDir = join(root, 'Local', 'Packages', 'Claude_x', 'LocalCache', 'Roaming', 'English Learning Companion')
  mkdirSync(userData, { recursive: true })
  mkdirSync(privateDir, { recursive: true })
  return { env, userData, privateDir }
}

describe('one place for the data', () => {
  it('a normal start is not inside a private space; private copies are found until merged', () => {
    const { env, userData, privateDir } = layout()
    expect(runningInPrivateSpace(userData, env)).toBe(false)
    expect(findPrivateCopies(userData, env)).toEqual([])
    openDatabase(join(privateDir, 'english-companion.db')).close()
    expect(findPrivateCopies(userData, env)).toEqual([privateDir])
    markPrivateCopyMerged(privateDir)
    expect(findPrivateCopies(userData, env)).toEqual([])
    expect(readdirSync(privateDir).some((f) => f.startsWith('english-companion.db.merged-'))).toBe(true)
    // Not under AppData (tests, harnesses): never checked.
    expect(runningInPrivateSpace(mkdtempSync(join(tmpdir(), 'x-')), env)).toBe(false)
  })

  it('merges what exists only in the private copy; nothing duplicated, nothing in the real data changed', () => {
    const { userData, privateDir } = layout()
    const realFile = join(userData, 'english-companion.db')
    const privFile = join(privateDir, 'english-companion.db')
    // The private copy: two notes shared with the real data (same IDs), plus new work.
    const priv = openDatabase(privFile)
    const shared = insertNote(priv, { kind: 'word', text: 'resilient' }, null)
    const art = recordArticle(priv, { url: 'https://bbc.com/a', title: 'A' })
    const onlyPriv = insertNote(priv, { kind: 'sentence', text: 'I suppose it is preferable to beheading.', mediaTitle: 'GOT', articleId: art.id }, null)
    const card = insertFlashcard(priv, onlyPriv.id, 'preferable', back)
    reviewFlashcard(priv, card.id, 3)
    priv.prepare("INSERT INTO chats (title, created_at) VALUES ('About beheading', '2026-10-20T01:00:00Z')").run()
    priv.prepare("INSERT INTO chat_messages (chat_id, role, content) VALUES (1, 'user', 'why?')").run()
    const book = createBook(priv, 'book 1')
    const [w] = importItems(priv, { bookId: book.id, kind: 'pasted', drafts: [{ term: 'Vulnerable' }] }).added
    recordAnswer(priv, { itemId: w.id, kind: 'new', mode: 'mcq', correct: false, rating: 1, question: 'q', answer: 'a', correctAnswer: 'c', errorType: 'wrong_meaning' })
    setSetting(priv, 'secret.geminiApiKey', raw('KEY-FROM-PRIVATE'))
    setSetting(priv, 'secret.googleRefreshToken', raw('TOKEN-PRIVATE'))
    setSetting(priv, 'secret.googleClientSecret', 'enc:AAAA') // encrypted with that copy's own key
    setSetting(priv, 'googleAccount', 'me@example.com')
    priv.close()
    mkdirSync(join(privateDir, 'vocab-book', 'images'), { recursive: true })
    writeFileSync(join(privateDir, 'vocab-book', 'images', '0b5f5d4c-1111-2222-3333-444455556666.png'), 'png')

    // The real data: the shared note (same ID) + its own new words, and its own Google sign-in.
    const db = openDatabase(realFile)
    db.prepare('INSERT INTO notes (kind, text, uid, dedupe_key, source_type, collection) VALUES (?, ?, ?, ?, ?, ?)').run('word', 'resilient', shared.uid!, null, 'other', 'regular')
    insertNote(db, { kind: 'phrasal', text: 'hop into' }, null)
    setSetting(db, 'secret.googleRefreshToken', raw('TOKEN-REAL'))

    const backup = backupBeforeMerge(userData, [privateDir])
    expect(readdirSync(backup)).toEqual(expect.arrayContaining(['real-english-companion.db', 'private1-english-companion.db', 'README.txt']))

    const r = mergePrivateCopy(db, privFile, decrypt, raw)
    expect(r).toMatchObject({ notes: 1, flashcards: 1, articles: 1, chats: 1, vocabBooks: 1, vocabBookWords: 1, googleBackupSaved: true })
    expect(r.secretsCopied).toEqual(['geminiApiKey'])
    expect(r.secretsUnreadable).toEqual(['googleClientSecret'])
    expect(listNotes(db).map((n) => n.text).sort()).toEqual(['I suppose it is preferable to beheading.', 'hop into', 'resilient'])
    const merged = listNotes(db).find((n) => n.text.startsWith('I suppose'))!
    expect(merged.articleId).toBe((db.prepare('SELECT id FROM articles WHERE url = ?').get('https://bbc.com/a') as { id: number }).id)
    const mc = listFlashcards(db).find((c) => c.noteId === merged.id)!
    expect([mc.front, mc.reps]).toEqual(['preferable', 1])
    expect((db.prepare('SELECT COUNT(*) AS n FROM flashcard_reviews WHERE flashcard_id = ?').get(mc.id) as { n: number }).n).toBe(1)
    expect((db.prepare('SELECT COUNT(*) AS n FROM chat_messages').get() as { n: number }).n).toBe(1)
    const vb = listItems(db, (db.prepare('SELECT id FROM vb_books').get() as { id: number }).id)
    expect([vb[0].term, vb[0].mistakes, listMistakes(db, vb[0].bookId).length]).toEqual(['Vulnerable', 1, 1])
    // The real Google sign-in stays; the other one is kept in reserve. Real settings are not overwritten.
    expect(decrypt(getSetting(db, 'secret.googleRefreshToken')!)).toBe('TOKEN-REAL')
    expect(decrypt(getSetting(db, 'secret.googleRefreshTokenBackup')!)).toBe('TOKEN-PRIVATE')
    expect(getSetting(db, 'googleAccount')).toBe('me@example.com')
    // Running the merge again adds nothing.
    expect(mergePrivateCopy(db, privFile, decrypt, raw)).toMatchObject({ notes: 0, flashcards: 0, articles: 0, chats: 0, vocabBooks: 0, vocabBookWords: 0 })
    expect(copyPrivateImages(privateDir, userData)).toBe(1)
    expect(existsSync(join(userData, 'vocab-book', 'images', '0b5f5d4c-1111-2222-3333-444455556666.png'))).toBe(true)
    db.close()
  })
})
