import { describe, expect, it } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { openDatabase } from '../src/main/db'
import { SCHEMA_VERSION } from '../src/main/db/migrations'
import { getNote, insertNote, listNotes, updateNoteData } from '../src/main/db/repos/notes'
import { editFlashcard, getFlashcard, insertFlashcard, listFlashcards, noteIdsWithoutFlashcards } from '../src/main/db/repos/flashcards'
import { ensureTargetAndCard, withFlashcard } from '../src/main/learning'
import { noteToDocEntry } from '../src/main/google/docs'
import { asVocabNotes } from '../src/shared/games'
import { initialTarget, isTargetLike, targetMeaning } from '../src/shared/vocab'
import type { NoteData } from '../src/shared/types'

const data = (p: Partial<NoteData>): NoteData => ({ meaning_bn: '', meaning_en: '', vocabulary: [], idioms_phrasal: [], grammar: [], examples: [], ...p })
const MOVIE_LINE = "I'm just a junker, man. I was just checking stuff out."

describe('the word/phrase to learn (target)', () => {
  it('a word, phrase or idiom is its own target; a long sentence uses the key expression from its analysis', () => {
    expect(initialTarget({ kind: 'word', text: 'resilient' })).toBe('resilient')
    expect(initialTarget({ kind: 'idiom', text: 'break the ice' })).toBe('break the ice')
    expect(initialTarget({ kind: 'sentence', text: MOVIE_LINE })).toBeNull()
    expect(initialTarget({ kind: 'sentence', text: MOVIE_LINE, data: data({ target_term: 'check stuff out' }) })).toBe('check stuff out')
    expect(isTargetLike(MOVIE_LINE)).toBe(false)
    expect(isTargetLike('check something out')).toBe(true)
  })

  it('the meaning on the card is the meaning of the target, not of the whole sentence', () => {
    const d = data({ meaning_bn: 'পুরো বাক্যের অর্থ', target_term: 'check stuff out', target_meaning_bn: 'ঘুরে দেখা', target_meaning_en: 'to look around' })
    expect(targetMeaning({ kind: 'sentence', text: MOVIE_LINE, target: 'check stuff out', data: d })).toEqual({ bn: 'ঘুরে দেখা', en: 'to look around' })
  })
})

describe('one collection: items → flashcards', () => {
  it('a saved word gets its flashcard with the word on the front', () => {
    const db = openDatabase(':memory:')
    const n = insertNote(db, { kind: 'word', text: 'resilient', contextSentence: 'The city proved resilient.' }, data({ meaning_bn: 'সহনশীল' }))
    ensureTargetAndCard(db, n.id)
    const [card] = listFlashcards(db)
    expect(card.front).toBe('resilient')
    expect(card.back.meaning_bn).toBe('সহনশীল')
    expect(card.source?.contextSentence).toBe('The city proved resilient.')
    expect(withFlashcard(db, getNote(db, n.id)!).flashcard?.id).toBe(card.id)
  })

  it('a movie sentence: front = key expression, the sentence stays on the back; no card until there is a target', () => {
    const db = openDatabase(':memory:')
    const n = insertNote(db, { kind: 'sentence', text: MOVIE_LINE, mediaPath: 'C:/m/film.mkv', mediaTitle: 'Film', timestampSec: 30 }, null)
    ensureTargetAndCard(db, n.id)
    expect(listFlashcards(db)).toHaveLength(0) // not analysed yet: never a sentence-front card
    updateNoteData(db, n.id, data({ target_term: 'check stuff out', target_meaning_bn: 'ঘুরে দেখা' }))
    ensureTargetAndCard(db, n.id)
    const [card] = listFlashcards(db)
    expect(card.front).toBe('check stuff out')
    expect(card.back.meaning_bn).toBe('ঘুরে দেখা')
    expect(card.source?.text).toBe(MOVIE_LINE)
  })

  it('the same word with the same meaning is not carded twice; a different meaning is a separate card', () => {
    const db = openDatabase(':memory:')
    const a = insertNote(db, { kind: 'word', text: 'bank', articleId: null, contextSentence: 'I went to the bank.' }, data({ meaning_bn: 'ব্যাংক' }))
    const b = insertNote(db, { kind: 'word', text: 'Bank', contextSentence: 'Money is in the bank.', mediaTitle: 'Film' }, data({ meaning_bn: 'ব্যাংক' }))
    const c = insertNote(db, { kind: 'word', text: 'bank', contextSentence: 'We sat on the river bank.', mediaTitle: 'Other' }, data({ meaning_bn: 'নদীর তীর' }))
    for (const n of [a, b, c]) ensureTargetAndCard(db, n.id)
    expect(listFlashcards(db).map((x) => x.back.meaning_bn).sort()).toEqual(['ব্যাংক', 'নদীর তীর'].sort())
    // The second "bank" (same meaning) is covered by the first card: not offered again, shown as shared.
    expect(noteIdsWithoutFlashcards(db)).toEqual([])
    expect(withFlashcard(db, getNote(db, b.id)!).flashcard).toMatchObject({ shared: true })
    // The games see the two meanings, not three copies.
    expect(asVocabNotes(listNotes(db)).map((n) => n.data?.meaning_bn).sort()).toEqual(['ব্যাংক', 'নদীর তীর'].sort())
  })

  it('editing the front saves it on the item (one record) and keeps the original text, sentence and source', () => {
    const db = openDatabase(':memory:')
    const n = insertNote(db, { kind: 'sentence', text: MOVIE_LINE, mediaTitle: 'Film' }, data({ target_term: 'check stuff out', target_meaning_bn: 'ঘুরে দেখা' }))
    ensureTargetAndCard(db, n.id)
    const card = listFlashcards(db)[0]
    const edited = editFlashcard(db, { id: card.id, front: '  check  something out ', meaningBn: 'খুঁটিয়ে দেখা' })
    expect(edited.front).toBe('check something out')
    expect(edited.back.meaning_bn).toBe('খুঁটিয়ে দেখা')
    const after = getNote(db, n.id)!
    expect([after.target, after.text, after.mediaTitle]).toEqual(['check something out', MOVIE_LINE, 'Film'])
    expect(() => editFlashcard(db, { id: card.id, front: '   ' })).toThrow(/empty/)
    expect(getFlashcard(db, card.id)!.front).toBe('check something out') // a failed edit changes nothing
  })

  it('games use the same items: a sentence item appears as its target word', () => {
    const db = openDatabase(':memory:')
    insertNote(db, { kind: 'sentence', text: MOVIE_LINE }, data({ target_term: 'check stuff out', target_meaning_bn: 'ঘুরে দেখা' }))
    ensureTargetAndCard(db, 1)
    const [v] = asVocabNotes(listNotes(db))
    expect([v.text, v.data?.meaning_bn, v.contextSentence]).toEqual(['check stuff out', 'ঘুরে দেখা', MOVIE_LINE])
  })

  it('Vocabulary Book items stay separate (no regular flashcard, not in the regular list)', () => {
    const db = openDatabase(':memory:')
    const b = insertNote(db, { kind: 'word', text: 'serendipity', collection: 'book' }, data({ meaning_bn: 'সৌভাগ্যক্রমে' }))
    insertNote(db, { kind: 'word', text: 'serendipity' }, data({ meaning_bn: 'সৌভাগ্যক্রমে' }))
    ensureTargetAndCard(db, b.id)
    expect(listFlashcards(db)).toHaveLength(0)
    expect(listNotes(db, { collection: 'regular' }).map((n) => n.collection)).toEqual(['regular'])
    expect(noteIdsWithoutFlashcards(db)).not.toContain(b.id)
  })

  it('Google Docs shows the word to learn for a sentence item', () => {
    const db = openDatabase(':memory:')
    const n = insertNote(db, { kind: 'sentence', text: MOVIE_LINE }, data({ target_term: 'check stuff out' }))
    ensureTargetAndCard(db, n.id)
    expect(noteToDocEntry(getNote(db, n.id)!).fields.find((f) => f.label === 'Word to learn')?.value).toBe('check stuff out')
  })
})

describe('upgrading: existing cards', () => {
  it('a sentence-front card gets the key expression; the old front/back are kept; good cards are untouched', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'elc-')), 'old.db')
    openDatabase(file).close()
    const raw = new DatabaseSync(file)
    const d = JSON.stringify(data({ meaning_bn: 'পুরো বাক্য', target_term: 'check stuff out', target_meaning_bn: 'ঘুরে দেখা' }))
    raw.exec(`
      DROP INDEX notes_collection; ALTER TABLE notes DROP COLUMN target; ALTER TABLE notes DROP COLUMN collection;
      ALTER TABLE flashcards DROP COLUMN legacy_front; ALTER TABLE flashcards DROP COLUMN legacy_back_json;
      DROP TABLE vb_mistakes; DROP TABLE vb_reviews; DROP TABLE vb_items; DROP TABLE vb_sources; DROP TABLE vb_books;
    `)
    raw.prepare('INSERT INTO notes (kind, text, data_json) VALUES (?, ?, ?)').run('sentence', MOVIE_LINE, d)
    raw.prepare('INSERT INTO notes (kind, text) VALUES (?, ?)').run('idiom', 'break the ice')
    const back = '{"meaning_bn":"পুরো বাক্য","meaning_en":"","example":"","example_bn":"","note":""}'
    const ins = raw.prepare("INSERT INTO flashcards (note_id, front, back_json, card_json, due, state, reps, lapses) VALUES (?, ?, ?, '{}', '2026-11-01T00:00:00.000Z', 2, 1, 0)")
    ins.run(1, MOVIE_LINE, back)
    ins.run(2, 'break the ice', back)
    raw.exec(`PRAGMA user_version = ${SCHEMA_VERSION - 2}`)
    raw.close()

    const db = openDatabase(file)
    const [sentence, idiom] = [getFlashcard(db, 1)!, getFlashcard(db, 2)!]
    expect([sentence.front, sentence.back.meaning_bn, sentence.due, sentence.reps]).toEqual(['check stuff out', 'ঘুরে দেখা', '2026-11-01T00:00:00.000Z', 1])
    const legacy = db.prepare('SELECT legacy_front, legacy_back_json FROM flashcards WHERE id = 1').get() as { legacy_front: string; legacy_back_json: string }
    expect([legacy.legacy_front, legacy.legacy_back_json]).toEqual([MOVIE_LINE, back])
    expect([idiom.front, getNote(db, 2)!.target]).toEqual(['break the ice', 'break the ice'])
    expect(listNotes(db)).toHaveLength(2) // nothing deleted
    db.close()
  })
})
