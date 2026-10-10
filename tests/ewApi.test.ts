import { beforeAll, describe, expect, it, vi } from 'vitest'

// The real library is loaded by Supabase (Deno) from 'npm:'; here a stand-in is enough.
vi.mock('npm:@supabase/supabase-js@2', () => ({ createClient: () => ({}) }))

// The server function lives outside the app (Supabase); loaded dynamically so the app's tsconfig stays unchanged.
const FN = '../supabase/functions/ew-api/index.ts'
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let M: any
beforeAll(async () => {
  M = await import(/* @vite-ignore */ FN)
})
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Deps = Record<string, (...a: any[]) => Promise<any>>

// English World server function: safety before publishing (Gemini and the database are stand-ins).
function deps(over: Deps = {}) {
  const inserted: { table: string; row: Record<string, unknown> }[] = []
  const updated: unknown[] = []
  return {
    inserted,
    updated,
    userId: async (h: string) => (h === 'Bearer good' ? 'user-1' : null),
    insert: async (table: string, row: Record<string, unknown>) => {
      inserted.push({ table, row })
      return { id: 'new-id' }
    },
    update: async (_t: string, id: string, patch: unknown) => {
      updated.push({ id, patch })
    },
    post: async (id: string) => (id === 'p1' ? { id: 'p1', author_id: 'user-2', kind: 'post', text: 'I goed home.' } : null),
    hasProfile: async () => true,
    safety: async (text: string) => (/stupid/i.test(text) ? { allowed: false, category: 'bullying', reason: 'Please be kind. Correct the English, never the person.' } : { allowed: true, category: 'none', reason: '' }),
    check: async () => ({ ok: false, corrected: 'I went home.', mistakes: [{ wrong: 'goed', fix: 'went', why: 'go-এর past হলো went' }] }),
    answer: async () => ({ bn: 'প্রতিদিন একটু করে বলুন।', en: 'Speak a little every day.' }),
    ...over
  }
}
const call = (d: unknown, body: unknown, auth = 'Bearer good'): Promise<Record<string, unknown>> =>
  M.handle(new Request('https://x/ew-api', { method: 'POST', headers: { Authorization: auth }, body: JSON.stringify(body) }), d).then((r: Response) => r.json())

describe('English World server: safety and publishing', () => {
  it('needs a signed-in user', async () => {
    expect(await call(deps(), { action: 'post', text: 'Hi' }, 'Bearer bad')).toMatchObject({ ok: false })
  })

  it('publishes a safe post', async () => {
    const d = deps()
    expect(await call(d, { action: 'post', kind: 'post', text: 'Today I learned a new word.', tags: ['Study', 'Hacking'], correctMe: true })).toEqual({ ok: true, id: 'new-id' })
    expect(d.inserted[0].row).toMatchObject({ author_id: 'user-1', kind: 'post', tags: ['Study'], correct_me: true, expires_at: null })
  })

  it('blocks personal details before asking AI', async () => {
    let asked = false
    const d = deps({ safety: async () => ((asked = true), { allowed: true, category: 'none', reason: '' }) })
    const r = await call(d, { action: 'post', kind: 'post', text: 'Call me 01712345678' })
    expect(r).toMatchObject({ ok: false, flagged: true })
    expect(String(r.error)).toMatch(/phone/)
    expect(asked).toBe(false)
    expect(d.inserted).toHaveLength(0)
  })

  it('AI-flagged content is not published and gets a gentle reason', async () => {
    const d = deps()
    const r = await call(d, { action: 'fix', postId: 'p1', text: 'I went home.', note: 'you are stupid' })
    expect(r).toMatchObject({ ok: false, flagged: true, error: 'Please be kind. Correct the English, never the person.' })
    expect(d.inserted).toHaveLength(0)
  })

  it('if the safety check fails, nothing is published (fail closed)', async () => {
    const d = deps({
      safety: async () => {
        throw new Error('503')
      }
    })
    const r = await call(d, { action: 'comment', postId: 'p1', text: 'Great job!' })
    expect(r.ok).toBe(false)
    expect(String(r.error)).toMatch(/couldn't check/i)
    expect(d.inserted).toHaveLength(0)
  })

  it('stories expire after 24 hours', async () => {
    const d = deps()
    await call(d, { action: 'post', kind: 'story', text: 'My English day!', bg: '#781b36' })
    const exp = new Date(String(d.inserted[0].row.expires_at)).getTime()
    expect(Math.round((exp - Date.now()) / 3600000)).toBe(24)
    expect(d.inserted[0].row.bg).toBe('#781b36')
  })

  it('questions get an AI answer', async () => {
    const d = deps()
    await call(d, { action: 'post', kind: 'question', text: 'How can I stop being shy?', tags: ['Confidence'] })
    expect(d.updated).toEqual([{ id: 'new-id', patch: { ai_answer: { bn: 'প্রতিদিন একটু করে বলুন।', en: 'Speak a little every day.' } } }])
  })

  it("can't correct your own post; corrections and comments need a visible post", async () => {
    expect(await call(deps({ post: async () => ({ id: 'p1', author_id: 'user-1', kind: 'post', text: 'x' }) }), { action: 'fix', postId: 'p1', text: 'y' })).toMatchObject({ ok: false })
    expect(await call(deps(), { action: 'comment', postId: 'gone', text: 'Nice!' })).toMatchObject({ ok: false, error: 'This post is no longer available.' })
  })

  it('private check returns mistakes without publishing anything', async () => {
    const d = deps()
    const r = await call(d, { action: 'check', text: 'I goed home.' })
    expect(r).toMatchObject({ ok: true, result: { corrected: 'I went home.' } })
    expect(d.inserted).toHaveLength(0)
  })

  it('photos must be small JPEG data', () => {
    expect(M.cleanPost({ kind: 'post', text: 'Hi', image: 'data:image/png;base64,AAA' })).toEqual({ error: 'The photo is too big. Please choose a smaller one.' })
    expect('post' in M.cleanPost({ kind: 'post', text: 'Hi', image: 'data:image/jpeg;base64,AAA' })).toBe(true)
  })

  it('personal info patterns and database messages', () => {
    expect(M.personalInfo('mail abc@gmail.com')).toMatch(/email/)
    expect(M.personalInfo('follow @abir_99')).toMatch(/social/)
    expect(M.personalInfo('instagram.com/abir')).toMatch(/social/)
    expect(M.personalInfo('In 2023-2024 I read 12 books.')).toBeNull()
    expect(M.dbMessage('EW_LIMIT: You have posted a lot this hour. Take a short break and try again later.')).toMatch(/short break/)
  })

  it('Gemini: tries the next model if one fails; blocked input counts as not allowed', async () => {
    const seen: string[] = []
    const fetcher = (async (url: string) => {
      seen.push(url)
      if (url.includes('flash-lite')) return new Response(JSON.stringify({ error: { message: 'busy' } }), { status: 503 })
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"allowed":true,"category":"none","reason":""}' }] } }] }))
    }) as unknown as typeof fetch
    expect(await M.gemini('k', 's', [{ text: 'hi' }], {}, fetcher)).toEqual({ allowed: true, category: 'none', reason: '' })
    expect(seen).toHaveLength(2)
    const blocked = (async () => new Response(JSON.stringify({ promptFeedback: { blockReason: 'SAFETY' } }))) as unknown as typeof fetch
    expect(await M.gemini('k', 's', [{ text: 'x' }], {}, blocked)).toMatchObject({ allowed: false })
  })
})
