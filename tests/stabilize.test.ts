import { beforeEach, describe, expect, it } from 'vitest'
import { friendlyError, isBusyError, isThinkingConfigError, withRetry } from '../src/main/ai/gemini'
import { openDatabase } from '../src/main/db'
import { getNote, insertNote, listNoteMovies, listNotes, updateUserNote } from '../src/main/db/repos/notes'
import { setDocTarget, setMovieDoc } from '../src/main/db/repos/settings'
import { createNoteSync } from '../src/main/notesSync'
import type { DocEntry } from '../src/main/google/docs'
import { getSelection, useMovie, EMPTY_STATUS } from '../src/renderer/src/stores/movie'
import type { PlayerStatus, SubtitleLine } from '../src/shared/types'

// The exact error text from the screenshot (503 while explaining).
const OVERLOADED = `ApiError: {"error":{"message":"{\\n \\"error\\": {\\n \\"code\\": 503,\\n \\"message\\": \\"This model is currently experiencing high demand. Spikes in demand are usually temporary. Please try again later.\\",\\n \\"status\\": \\"UNAVAILABLE\\"\\n }\\n}\\n","code":503,"status":"Service Unavailable"}}`

describe('Gemini error handling', () => {
  it('turns the 503 "high demand" error into a readable message', () => {
    expect(isBusyError(new Error(OVERLOADED))).toBe(true)
    const msg = friendlyError(new Error(OVERLOADED)).message
    expect(msg).toMatch(/Gemini is very busy/)
    expect(msg).not.toMatch(/[{}"]/)
  })

  it('never shows raw JSON for other API errors', () => {
    const raw = 'ApiError: {"error":{"code":400,"message":"Request contains an invalid argument.","status":"INVALID_ARGUMENT"}}'
    expect(friendlyError(new Error(raw)).message).toBe('Gemini error: Request contains an invalid argument.')
  })

  it('recognises when a model rejects the fast (no-thinking) setting, so it can fall back', () => {
    expect(isThinkingConfigError(new Error('ApiError: {"error":{"code":400,"message":"Budget 0 is invalid. This model only works in thinking mode.","status":"INVALID_ARGUMENT"}}'))).toBe(true)
    expect(isThinkingConfigError(new Error('thinking_level is not supported by this model'))).toBe(true)
    expect(isThinkingConfigError(new Error(OVERLOADED))).toBe(false)
    expect(isThinkingConfigError(new Error('API key not valid'))).toBe(false)
  })

  it('retries busy errors, then succeeds', async () => {
    let calls = 0
    const result = await withRetry(
      async () => {
        calls++
        if (calls < 3) throw new Error(OVERLOADED)
        return 'ok'
      },
      { delaysMs: [1, 1] }
    )
    expect(result).toBe('ok')
    expect(calls).toBe(3)
  })

  it('does not retry real errors, or once output has started', async () => {
    let calls = 0
    await expect(
      withRetry(
        async () => {
          calls++
          throw new Error('API key not valid')
        },
        { delaysMs: [1, 1] }
      )
    ).rejects.toThrow()
    expect(calls).toBe(1)

    calls = 0
    await expect(
      withRetry(
        async () => {
          calls++
          throw new Error(OVERLOADED)
        },
        { delaysMs: [1, 1], canRetry: () => false }
      )
    ).rejects.toThrow()
    expect(calls).toBe(1)
  })
})

const status = (mediaPath: string | null): PlayerStatus => ({ ...EMPTY_STATUS, connected: !!mediaPath, mediaPath, mediaTitle: mediaPath })
const line = (mediaPath: string, start: number, text = `line ${start}`): SubtitleLine => ({
  id: `${mediaPath}@${start}`,
  text,
  start,
  end: start + 2,
  mediaPath,
  mediaTitle: mediaPath
})

describe('switching movies (subtitle list)', () => {
  beforeEach(() => {
    useMovie.setState({ status: EMPTY_STATUS, lines: [], feedMedia: null, selectedLineId: null, wordRange: null, custom: null })
  })

  it('shows only the new movie after a switch, and ignores late lines from the old one', () => {
    const m = useMovie.getState()
    m.setStatus(status('A.mkv'))
    m.addLine(line('A.mkv', 10))
    m.addLine(line('A.mkv', 12))
    useMovie.getState().selectLine('A.mkv@10')
    expect(getSelection(useMovie.getState())?.text).toBe('line 10')

    useMovie.getState().setStatus(status('B.mkv'))
    expect(useMovie.getState().lines).toEqual([])
    expect(useMovie.getState().selectedLineId).toBeNull()

    useMovie.getState().addLine(line('A.mkv', 14)) // delayed from movie A
    useMovie.getState().addLine(line('B.mkv', 5))
    expect(useMovie.getState().lines.map((l) => l.id)).toEqual(['B.mkv@5'])
  })

  it('clears the list when a different movie is opened after the player was closed', () => {
    useMovie.getState().setStatus(status('A.mkv'))
    useMovie.getState().addLine(line('A.mkv', 10))
    useMovie.getState().setStatus(status(null)) // VLC closed: keep studying A's lines
    expect(useMovie.getState().lines).toHaveLength(1)
    useMovie.getState().setStatus(status('C.mkv')) // previously A's lines stayed and mixed in
    expect(useMovie.getState().lines).toEqual([])
    expect(useMovie.getState().feedMedia).toBe('C.mkv')
  })
})

describe('notes per movie and Google Docs saving', () => {
  const setup = () => {
    const db = openDatabase(':memory:')
    const appended: { docId: string; entry: DocEntry }[] = []
    let fail: string | null = null
    const sync = createNoteSync(db, async (docId, entry) => {
      if (fail) throw new Error(fail)
      appended.push({ docId, entry })
    })
    const add = (mediaPath: string, text: string) =>
      insertNote(db, { kind: 'sentence', text, mediaPath, mediaTitle: mediaPath.replace('.mkv', ''), timestampSec: 60 }, null)
    return { db, sync, appended, add, setFail: (m: string | null) => (fail = m) }
  }

  it('keeps each movie’s notes separate, using the file path as identity', () => {
    const { db, add } = setup()
    add('C:/m/Harry Potter.mkv', 'I should have known.')
    add('C:/m/Thor.mkv', 'And I would have what is mine.')
    add('C:/other/Thor.mkv', 'Same title, different file.')
    expect(listNotes(db, { mediaPath: 'C:/m/Thor.mkv' }).map((n) => n.text)).toEqual(['And I would have what is mine.'])
    expect(listNoteMovies(db).map((m) => m.mediaPath).sort()).toEqual(['C:/m/Harry Potter.mkv', 'C:/m/Thor.mkv', 'C:/other/Thor.mkv'])
  })

  it('edits a note only for that one note', () => {
    const { db, add } = setup()
    const a = add('A.mkv', 'one')
    const b = add('B.mkv', 'two')
    updateUserNote(db, a.id, '  use when refusing politely  ')
    expect(getNote(db, a.id)?.userNote).toBe('use when refusing politely')
    expect(getNote(db, b.id)?.userNote).toBeNull()
  })

  it("sends notes to their own movie's doc, and repeated saves never duplicate", async () => {
    const { db, sync, appended, add } = setup()
    setMovieDoc(db, { mediaPath: 'A.mkv', mediaTitle: 'A', docId: 'doc-A', docTitle: 'A notes' })
    setDocTarget(db, { category: 'movie', docId: 'doc-default', title: 'Movie English Notes' })
    const a1 = add('A.mkv', 'first')
    add('A.mkv', 'second')
    const b1 = add('B.mkv', 'other movie')

    await sync.syncNote(a1.id)
    await sync.syncNote(a1.id) // second click
    const r = await sync.syncMovie('A.mkv')
    expect(r).toEqual({ added: 1, alreadyThere: 1, failed: 0, error: null })
    expect(await sync.syncMovie('A.mkv')).toEqual({ added: 0, alreadyThere: 2, failed: 0, error: null })
    expect(appended.map((x) => [x.docId, x.entry.title])).toEqual([
      ['doc-A', 'first'],
      ['doc-A', 'second']
    ])

    // A movie without its own doc falls back to the default doc from Settings.
    await sync.syncNote(b1.id)
    expect(appended.at(-1)).toMatchObject({ docId: 'doc-default', entry: { title: 'other movie' } })
  })

  it('reports a failed save as an error, never as success', async () => {
    const { db, sync, add, setFail } = setup()
    setMovieDoc(db, { mediaPath: 'A.mkv', mediaTitle: 'A', docId: 'doc-A', docTitle: 'A notes' })
    const a = add('A.mkv', 'first')
    setFail('Google access expired or was revoked. Reconnect Google in Settings.')
    const note = await sync.syncNote(a.id)
    expect(note.gdocSyncedAt).toBeNull()
    expect(note.gdocError).toMatch(/Reconnect Google/)
    expect(await sync.syncMovie('A.mkv')).toMatchObject({ added: 0, failed: 1 })

    setFail(null)
    const retried = await sync.syncNote(a.id)
    expect(retried.gdocSyncedAt).not.toBeNull()
    expect(retried.gdocError).toBeNull()
  })

  it('sends notes saved earlier (offline / before connecting) once a doc exists, oldest first, without duplicates', async () => {
    const { db, sync, appended, add, setFail } = setup()
    add('A.mkv', 'first word')
    add('A.mkv', 'second word')
    // No destination yet: nothing is sent and nothing is marked as failed.
    expect(await sync.syncPending()).toEqual({ added: 0, error: null })
    expect(appended).toHaveLength(0)

    setDocTarget(db, { category: 'movie', docId: 'doc-default', title: 'Vocabulary' })
    setFail('Network error')
    expect(await sync.syncPending()).toEqual({ added: 0, error: 'Network error' })
    setFail(null)
    expect(await sync.syncPending()).toEqual({ added: 2, error: null })
    expect(appended.map((x) => x.entry.title)).toEqual(['first word', 'second word'])
    expect(await sync.syncPending()).toEqual({ added: 0, error: null })
    expect(appended).toHaveLength(2)
  })

  it('asks for a doc instead of pretending to save when none is chosen', async () => {
    const { sync, add } = setup()
    const n = await sync.syncNote(add('A.mkv', 'x').id)
    expect(n.gdocSyncedAt).toBeNull()
    expect(n.gdocError).toMatch(/Choose a Google Doc for this movie/)
  })
})
