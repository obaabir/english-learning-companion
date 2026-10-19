import { describe, expect, it } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { openDatabase } from '../src/main/db'
import { SCHEMA_VERSION } from '../src/main/db/migrations'
import { findDuplicateNote, getNote, insertNote, listNotes } from '../src/main/db/repos/notes'
import { recordArticle } from '../src/main/db/repos/articles'
import { getFlashcard } from '../src/main/db/repos/flashcards'
import { listDocTargets, setDocTarget } from '../src/main/db/repos/settings'
import { createNoteSync } from '../src/main/notesSync'
import { noteToDocEntry, type DocEntry } from '../src/main/google/docs'
import { GoogleError } from '../src/main/google/GoogleService'
import { docCategoryForNote, noteDedupeKey, type NewNoteInput } from '../src/shared/types'

/** A fake Google Docs: keeps what was appended per doc, can fail or lose the answer. */
function fakeDocs() {
  const docs = new Map<string, string[]>()
  let mode: 'ok' | 'fail' | 'lost' | 'lost-after-write' = 'ok'
  const append = async (docId: string, entry: DocEntry): Promise<void> => {
    if (mode === 'fail') throw new Error('Google refused access: quota')
    if (mode === 'lost') throw new GoogleError('Could not reach Google Docs (timeout).', true)
    const text = [entry.title, ...entry.fields.map((f) => `${f.label}: ${f.value}`)].join('\n')
    docs.set(docId, [...(docs.get(docId) ?? []), text])
    if (mode === 'lost-after-write') throw new GoogleError('Could not reach Google Docs (connection reset).', true)
  }
  const contains = async (docId: string, text: string): Promise<boolean> => (docs.get(docId) ?? []).some((t) => t.includes(text))
  return { docs, append, contains, setMode: (m: typeof mode) => (mode = m) }
}

describe('learning records', () => {
  it('every record gets a stable id, its source and a sync status', () => {
    const db = openDatabase(':memory:')
    const art = recordArticle(db, { url: 'https://bbc.com/a', title: 'A' })
    const a = insertNote(db, { kind: 'word', text: 'resilient', articleId: art.id, contextSentence: 'It proved resilient.' }, null)
    const m = insertNote(db, { kind: 'sentence', text: 'I should have known.', mediaPath: 'C:/m/HP.mkv', mediaTitle: 'HP', timestampSec: 61 }, null)
    const y = insertNote(db, { kind: 'phrasal', text: 'give up', mediaPath: 'https://youtu.be/x' }, null)
    const e = insertNote(db, { kind: 'ielts_error', text: 'FALSE vs NOT GIVEN', ieltsRef: 'Cambridge 15 · Test 2 · Q7' }, null)
    expect(new Set([a.uid, m.uid, y.uid, e.uid]).size).toBe(4)
    expect(a.uid).toMatch(/^[0-9a-f-]{36}$/)
    expect([a.sourceType, m.sourceType, y.sourceType, e.sourceType]).toEqual(['article', 'movie', 'youtube', 'ielts'])
    expect(a.sourceUrl).toBe('https://bbc.com/a')
    expect(y.sourceUrl).toBe('https://youtu.be/x')
    expect(e.ieltsRef).toBe('Cambridge 15 · Test 2 · Q7')
    expect(a.syncStatus).toBe('pending')
    expect(getNote(db, a.id)!.uid).toBe(a.uid) // stable
  })

  it('assigns each item to the right Google Docs category', () => {
    const c = (n: Partial<NewNoteInput> & { kind: NewNoteInput['kind'] }) => docCategoryForNote(n)
    expect(c({ kind: 'word', articleId: 1 })).toBe('article_vocab')
    expect(c({ kind: 'collocation', articleId: 1 })).toBe('article_vocab')
    expect(c({ kind: 'word', mediaPath: 'C:/m.mkv' })).toBe('movie_vocab')
    expect(c({ kind: 'sentence', mediaPath: 'https://youtu.be/x' })).toBe('movie_vocab')
    expect(c({ kind: 'idiom', articleId: 1 })).toBe('idioms')
    expect(c({ kind: 'phrasal' })).toBe('idioms')
    expect(c({ kind: 'structure', mediaPath: 'C:/m.mkv' })).toBe('structures')
    expect(c({ kind: 'grammar' })).toBe('grammar')
    expect(c({ kind: 'general' })).toBe('general')
    expect(c({ kind: 'word' })).toBe('general')
    expect(c({ kind: 'ielts_error', ieltsRef: 'Q1' })).toBe('ielts')
  })

  it('does not save the same item twice, but keeps different meanings/contexts apart', () => {
    const db = openDatabase(':memory:')
    const base = { kind: 'word' as const, text: 'bank', contextSentence: 'We sat on the river bank.', mediaPath: 'C:/m.mkv' }
    insertNote(db, base, null)
    expect(findDuplicateNote(db, { ...base, text: '  Bank ', contextSentence: 'We sat on the river bank' })).not.toBeNull()
    expect(findDuplicateNote(db, { ...base, contextSentence: 'I need to go to the bank to get cash.' })).toBeNull() // different meaning
    expect(findDuplicateNote(db, { ...base, mediaPath: 'C:/other.mkv' })).toBeNull() // different source
    expect(findDuplicateNote(db, { ...base, kind: 'idiom' })).toBeNull() // different category
    expect(noteDedupeKey({ kind: 'word', text: 'Run!' })).toBe(noteDedupeKey({ kind: 'word', text: 'run' }))
  })
})

describe('Google Docs sync', () => {
  const setup = () => {
    const db = openDatabase(':memory:')
    const g = fakeDocs()
    const sync = createNoteSync(db, g.append, g.contains)
    return { db, g, sync }
  }

  it('sends each category to its own chosen doc, with the required details', async () => {
    const { db, g, sync } = setup()
    setDocTarget(db, { category: 'article_vocab', docId: 'doc-art', title: 'Article Vocabulary' })
    setDocTarget(db, { category: 'idioms', docId: 'doc-idioms', title: 'Idioms' })
    setDocTarget(db, { category: 'movie_vocab', docId: 'doc-movie', title: 'Movie Vocabulary' })
    const art = recordArticle(db, { url: 'https://bbc.com/a', title: 'Markets' })
    const w = insertNote(db, { kind: 'word', text: 'resilient', articleId: art.id, mediaTitle: 'Markets', contextSentence: 'It proved resilient.' }, null)
    const i = insertNote(db, { kind: 'idiom', text: 'in the long run', articleId: art.id }, null)
    const s = insertNote(db, { kind: 'sentence', text: 'I should have known.', mediaPath: 'C:/m.mkv', mediaTitle: 'HP', timestampSec: 61 }, null)
    for (const n of [w, i, s]) expect((await sync.syncNote(n.id)).syncStatus).toBe('synced')
    expect(g.docs.get('doc-art')).toHaveLength(1)
    expect(g.docs.get('doc-idioms')).toHaveLength(1)
    expect(g.docs.get('doc-movie')![0]).toContain('Timestamp: 00:01:01')
    const entry = g.docs.get('doc-art')![0]
    for (const k of ['resilient', 'Category: Article Vocabulary', 'Source: Markets', 'Source URL: https://bbc.com/a', 'Sentence: It proved resilient.', `Record ID: elc-${w.uid}`]) expect(entry).toContain(k)
    expect(entry).toMatch(/Saved: \d{4}-\d{2}-\d{2}/)
  })

  it('changing a destination sends new items to the new doc', async () => {
    const { db, g, sync } = setup()
    setDocTarget(db, { category: 'grammar', docId: 'doc-1', title: 'Grammar' })
    await sync.syncNote(insertNote(db, { kind: 'grammar', text: 'would rather + verb' }, null).id)
    setDocTarget(db, { category: 'grammar', docId: 'doc-2', title: 'Grammar 2' })
    await sync.syncNote(insertNote(db, { kind: 'grammar', text: 'had better + verb' }, null).id)
    expect([g.docs.get('doc-1')?.length, g.docs.get('doc-2')?.length]).toEqual([1, 1])
    expect(listDocTargets(db).find((t) => t.category === 'grammar')?.docId).toBe('doc-2')
  })

  it('a failure is recorded (never shown as success), the record stays in the app, and retry sends it once', async () => {
    const { db, g, sync } = setup()
    setDocTarget(db, { category: 'general', docId: 'doc-g', title: 'General' })
    const n = insertNote(db, { kind: 'general', text: 'Watch S01E04' }, null)
    g.setMode('fail')
    const failed = await sync.syncNote(n.id)
    expect(failed.syncStatus).toBe('failed')
    expect(failed.gdocSyncedAt).toBeNull()
    expect(failed.gdocError).toContain('quota')
    expect(listNotes(db)).toHaveLength(1)
    expect(sync.overview().failed.map((f) => f.text)).toEqual(['Watch S01E04'])
    g.setMode('ok')
    expect(await sync.syncPending()).toEqual({ added: 1, error: null })
    expect(await sync.syncPending()).toEqual({ added: 0, error: null })
    expect(g.docs.get('doc-g')).toHaveLength(1)
    const o = sync.overview().categories.find((c) => c.category === 'general')!
    expect([o.synced, o.pending, o.failed]).toEqual([1, 0, 0])
  })

  it('no duplicate in the doc when the answer was lost after Google wrote it', async () => {
    const { db, g, sync } = setup()
    setDocTarget(db, { category: 'grammar', docId: 'doc-x', title: 'Grammar' })
    const n = insertNote(db, { kind: 'grammar', text: 'used to + verb' }, null)
    g.setMode('lost-after-write')
    expect((await sync.syncNote(n.id)).syncStatus).toBe('failed')
    g.setMode('ok')
    expect((await sync.syncNote(n.id)).syncStatus).toBe('synced') // found in the doc: not appended again
    expect(g.docs.get('doc-x')).toHaveLength(1)
  })

  it('retries when the answer was lost before Google wrote anything', async () => {
    const { db, g, sync } = setup()
    setDocTarget(db, { category: 'grammar', docId: 'doc-y', title: 'Grammar' })
    const n = insertNote(db, { kind: 'grammar', text: 'be used to + -ing' }, null)
    g.setMode('lost')
    await sync.syncNote(n.id)
    g.setMode('ok')
    await sync.syncNote(n.id)
    expect(g.docs.get('doc-y')).toHaveLength(1)
  })

  it('two saves at the same moment append once', async () => {
    const { db, g, sync } = setup()
    setDocTarget(db, { category: 'structures', docId: 'doc-s', title: 'Structures' })
    const n = insertNote(db, { kind: 'structure', text: 'The reason why … is that …' }, null)
    await Promise.all([sync.syncNote(n.id), sync.syncNote(n.id), sync.syncPending()])
    expect(g.docs.get('doc-s')).toHaveLength(1)
  })

  it('a category with no doc chosen asks for one and keeps the record waiting', async () => {
    const { db, sync } = setup()
    const n = await sync.syncNote(insertNote(db, { kind: 'idiom', text: 'call it a day' }, null).id)
    expect(n.gdocError).toContain('Idioms and Expressions')
    expect(n.gdocSyncedAt).toBeNull()
  })

  it('doc entries show the saved date of the record', () => {
    const entry = noteToDocEntry({ ...insertNote(openDatabase(':memory:'), { kind: 'word', text: 'x' }, null), createdAt: '2026-01-02T03:04:05.000Z' })
    expect(entry.fields.find((f) => f.label === 'Saved')?.value).toBe('2026-01-02')
  })
})

describe('upgrading an existing database', () => {
  it('keeps old notes (gives them ids/sources) and keeps the old doc for every former category', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'elc-')), 'old.db')
    openDatabase(file).close()
    // Turn it back into the previous version's shape, with an old note and the old "movie" doc.
    const raw = new DatabaseSync(file)
    raw.exec(`
      DROP INDEX notes_uid; DROP INDEX notes_dedupe;
      ALTER TABLE notes DROP COLUMN uid; ALTER TABLE notes DROP COLUMN source_type; ALTER TABLE notes DROP COLUMN source_url;
      ALTER TABLE notes DROP COLUMN ielts_ref; ALTER TABLE notes DROP COLUMN dedupe_key; ALTER TABLE notes DROP COLUMN gdoc_attempt_at;
      ALTER TABLE flashcards DROP COLUMN srs_step; ALTER TABLE flashcards DROP COLUMN interval_days; ALTER TABLE flashcards DROP COLUMN ease;
      ALTER TABLE flashcards DROP COLUMN last_reviewed_at; ALTER TABLE flashcards DROP COLUMN last_rating;
      DROP INDEX notes_collection; ALTER TABLE notes DROP COLUMN target; ALTER TABLE notes DROP COLUMN collection;
      ALTER TABLE flashcards DROP COLUMN legacy_front; ALTER TABLE flashcards DROP COLUMN legacy_back_json;
      DROP TABLE vb_mistakes; DROP TABLE vb_reviews; DROP TABLE vb_items; DROP TABLE vb_sources; DROP TABLE vb_books;
      INSERT INTO notes (kind, text, media_path, media_title) VALUES ('word', 'stubborn', 'https://youtu.be/v', 'Video');
      INSERT INTO notes (kind, text, media_path, media_title) VALUES ('word', 'stubborn', 'https://youtu.be/v', 'Video');
      INSERT INTO doc_targets (category, doc_id, title) VALUES ('movie', 'doc-old', 'Vocabulary & Sentences');
      INSERT INTO doc_targets (category, doc_id, title) VALUES ('structures', 'doc-str', 'Structures');
      INSERT INTO flashcards (note_id, front, back_json, card_json, due, state, reps, lapses) VALUES (1, 'stubborn', '{"meaning_bn":"","meaning_en":"","example":"","example_bn":"","note":""}', '{}', '2026-11-01T00:00:00.000Z', 2, 2, 0);
      INSERT INTO flashcard_reviews (flashcard_id, rating, reviewed_at) VALUES (1, 3, '2026-10-20T00:00:00.000Z');
    `)
    // Back to before Phase 3 (the Phase 3, Phase 4, shared-vocabulary and Vocabulary Book migrations run again).
    raw.exec(`PRAGMA user_version = ${SCHEMA_VERSION - 4}`)
    raw.close()

    const db = openDatabase(file)
    const notes = listNotes(db)
    expect(notes).toHaveLength(2) // existing duplicates are kept, never deleted
    expect(notes.every((n) => n.uid && n.sourceType === 'youtube' && n.sourceUrl === 'https://youtu.be/v')).toBe(true)
    expect(findDuplicateNote(db, { kind: 'word', text: 'stubborn', mediaPath: 'https://youtu.be/v' })).not.toBeNull()
    const targets = Object.fromEntries(listDocTargets(db).map((t) => [t.category, t.docId]))
    expect(targets).toEqual({ movie_vocab: 'doc-old', article_vocab: 'doc-old', idioms: 'doc-old', grammar: 'doc-old', general: 'doc-old', structures: 'doc-str' })
    // Existing flashcards keep their next review and history, and get a place on the new ladder.
    const card = getFlashcard(db, 1)!
    expect([card.due, card.reps, card.step, card.intervalDays, card.lastRating]).toEqual(['2026-11-01T00:00:00.000Z', 2, 2, 4, 3])
    db.close()
  })
})
