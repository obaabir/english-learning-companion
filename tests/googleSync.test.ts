import { describe, expect, it } from 'vitest'
import { openDatabase } from '../src/main/db'
import { insertNote, getNote } from '../src/main/db/repos/notes'
import { recordArticle } from '../src/main/db/repos/articles'
import { setDocTarget } from '../src/main/db/repos/settings'
import { createNoteSync } from '../src/main/notesSync'
import { GoogleService } from '../src/main/google/GoogleService'

/**
 * The app's real Google Docs code (GoogleService: request building, error handling, duplicate check)
 * against a fake Google Docs. Only the authorised HTTP client is replaced — everything above it is real.
 */
function fakeGoogle() {
  const docs = new Map<string, string>([['doc-1', '\n']])
  let mode: 'ok' | 'forbidden' | 'expired' | 'offline' | 'lost-after-write' = 'ok'
  const requests: { url: string; method: string }[] = []
  const fail = (status: number, message: string) => Object.assign(new Error(message), { response: { status, data: { error: { message } } } })
  const client = {
    async request<T>(opts: { url: string; method?: string; data?: { requests?: { insertText?: { text: string; location: { index: number } } }[] } }): Promise<{ data: T }> {
      requests.push({ url: opts.url, method: opts.method ?? 'GET' })
      if (mode === 'offline') throw Object.assign(new Error('getaddrinfo ENOTFOUND docs.googleapis.com'), { code: 'ENOTFOUND' })
      if (mode === 'forbidden') throw fail(403, 'The caller does not have permission')
      if (mode === 'expired') throw fail(401, 'invalid_grant')
      const id = decodeURIComponent(opts.url.split('/documents/')[1]?.split(/[:?]/)[0] ?? '')
      if (!docs.has(id)) throw fail(404, 'Requested entity was not found.')
      const text = docs.get(id)!
      if (opts.url.endsWith(':batchUpdate')) {
        const ins = opts.data!.requests!.find((r) => r.insertText)!.insertText!
        docs.set(id, text.slice(0, ins.location.index - 1) + ins.text + text.slice(ins.location.index - 1))
        if (mode === 'lost-after-write') throw new Error('socket hang up') // no response: result unknown
        return { data: {} as T }
      }
      // GET document: body end index, or the paragraphs' text.
      return {
        data: { body: { content: [{ endIndex: 1 }, { endIndex: text.length + 1, paragraph: { elements: [{ textRun: { content: text } }] } }] } } as T
      }
    }
  }
  return { docs, requests, client, setMode: (m: typeof mode) => (mode = m) }
}

function setup() {
  const db = openDatabase(':memory:')
  const g = fakeGoogle()
  const google = new GoogleService(db)
  ;(google as unknown as { client: unknown }).client = g.client
  const sync = createNoteSync(
    db,
    (docId, entry) => google.appendEntry(docId, entry),
    (docId, text) => google.docContains(docId, text)
  )
  setDocTarget(db, { category: 'article_vocab', docId: 'doc-1', title: 'Article Vocabulary' })
  const art = recordArticle(db, { url: 'https://www.bbc.com/news/economy', title: 'Why the economy stayed strong' })
  const add = (text: string) => insertNote(db, { kind: 'word', text, articleId: art.id, mediaTitle: art.title, contextSentence: `It proved ${text}.` }, null)
  return { db, g, sync, add }
}

describe('Google Docs sync through the real GoogleService', () => {
  it('appends a formatted entry with the source URL; success only after Google accepts it', async () => {
    const { g, sync, add } = setup()
    const n = add('resilient')
    const synced = await sync.syncNote(n.id)
    expect(synced.syncStatus).toBe('synced')
    const doc = g.docs.get('doc-1')!
    for (const k of ['resilient', `Record ID: elc-${n.uid}`]) expect(doc).toContain(k)
    expect(g.requests.map((r) => r.method)).toEqual(['GET', 'POST']) // read end of doc, then one batchUpdate
  })

  it('permission denied → recorded as failed (kept in the app), clear message; retry works once access is back', async () => {
    const { db, g, sync, add } = setup()
    const n = add('reluctant')
    g.setMode('forbidden')
    const r = await sync.syncNote(n.id)
    expect(r.syncStatus).toBe('failed')
    expect(r.gdocError).toMatch(/Google refused access/)
    expect(getNote(db, n.id)).not.toBeNull()
    g.setMode('ok')
    expect(await sync.syncPending()).toEqual({ added: 1, error: null })
    expect(g.docs.get('doc-1')!.match(/reluctant/g)?.length).toBe(1) // the heading, appended once
  })

  it('expired sign-in → asks to reconnect', async () => {
    const { g, sync, add } = setup()
    g.setMode('expired')
    expect((await sync.syncNote(add('thrive').id)).gdocError).toMatch(/Reconnect Google in Settings/)
  })

  it('offline → failed, then retry sends it', async () => {
    const { g, sync, add } = setup()
    const n = add('cope')
    g.setMode('offline')
    expect((await sync.syncNote(n.id)).syncStatus).toBe('failed')
    g.setMode('ok')
    expect((await sync.syncNote(n.id)).syncStatus).toBe('synced')
  })

  it('connection lost after Google wrote the entry → the retry finds it and does not append it again', async () => {
    const { g, sync, add } = setup()
    const n = add('endure')
    g.setMode('lost-after-write')
    expect((await sync.syncNote(n.id)).syncStatus).toBe('failed')
    g.setMode('ok')
    expect((await sync.syncNote(n.id)).syncStatus).toBe('synced')
    expect(g.docs.get('doc-1')!.split(`elc-${n.uid}`).length - 1).toBe(1)
  })

  it('a deleted / wrong doc → clear message to choose another', async () => {
    const { db, sync, add } = setup()
    setDocTarget(db, { category: 'article_vocab', docId: 'missing-doc', title: 'Gone' })
    expect((await sync.syncNote(add('vanish').id)).gdocError).toMatch(/not found/)
  })
})
