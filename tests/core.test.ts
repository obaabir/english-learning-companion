import { describe, expect, it } from 'vitest'
import { openDatabase } from '../src/main/db'
import { SEED_PROMPTS } from '../src/main/db/migrations'
import { listPrompts, setDefaultPrompt, deletePrompt } from '../src/main/db/repos/prompts'
import { insertNote, listNotes } from '../src/main/db/repos/notes'
import { insertFlashcard, reviewFlashcard, flashcardStats } from '../src/main/db/repos/flashcards'
import { cleanSubtitle } from '../src/main/mpv/subtitleClean'
import { inspectSubtitles } from '../src/main/mpv/trackInspector'
import { formatTimestamp } from '../src/shared/types'

describe('database', () => {
  it('seeds prompts and keeps exactly one default', () => {
    const db = openDatabase(':memory:')
    const prompts = listPrompts(db)
    expect(prompts).toHaveLength(SEED_PROMPTS.length)
    setDefaultPrompt(db, prompts[2].id)
    expect(listPrompts(db).filter((p) => p.isDefault).map((p) => p.id)).toEqual([prompts[2].id])
    deletePrompt(db, prompts[2].id)
    expect(listPrompts(db).filter((p) => p.isDefault)).toHaveLength(1)
  })

  it('stores, searches notes and schedules flashcards', () => {
    const db = openDatabase(':memory:')
    const note = insertNote(db, { kind: 'sentence', text: "I don't think that's a good idea.", mediaTitle: 'Movie', timestampSec: 83 }, null)
    insertNote(db, { kind: 'structure', text: 'The reason why I chose X was that...' }, null)
    expect(listNotes(db, { search: 'good idea' })).toHaveLength(1)
    expect(listNotes(db, { kinds: ['structure'] })).toHaveLength(1)
    const card = insertFlashcard(db, note.id, note.text, { meaning_bn: '', meaning_en: '', example: '', example_bn: '', note: '' })
    expect(flashcardStats(db).due).toBe(1)
    const reviewed = reviewFlashcard(db, card.id, 3)
    expect(reviewed.reps).toBe(1)
    expect(new Date(reviewed.due).getTime()).toBeGreaterThan(Date.now())
  })
})

describe('subtitles', () => {
  it('cleans tags and merges lines', () => {
    expect(cleanSubtitle(String.raw`{\an8}<i>What are you</i>` + '\ntalking about?')).toBe('What are you talking about?')
    expect(cleanSubtitle(String.raw`No, Nick.\NNever again.`)).toBe('No, Nick. Never again.')
    expect(cleanSubtitle('')).toBe('')
  })
  it('classifies subtitle tracks', () => {
    expect(inspectSubtitles([{ type: 'sub', codec: 'subrip', selected: true }]).kind).toBe('text')
    expect(inspectSubtitles([{ type: 'sub', codec: 'hdmv_pgs_subtitle', selected: true }]).kind).toBe('image')
    expect(inspectSubtitles([{ type: 'video' }]).kind).toBe('none')
  })
  it('formats timestamps', () => {
    expect(formatTimestamp(3725.4)).toBe('01:02:05')
  })
})
