import { afterEach, describe, expect, it, vi } from 'vitest'
import { YouTubeService } from '../src/main/youtube/YouTubeService'
import { openDatabase } from '../src/main/db'
import { upsertVideoInfo } from '../src/main/db/repos/youtube'
import type { GeminiService } from '../src/main/ai/gemini'

const LINK = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
const make = () => {
  const db = openDatabase(':memory:')
  return { db, svc: new YouTubeService(db, {} as GeminiService, () => undefined, 10, 80) }
}
const reply = (status: number, body: unknown = {}) => Promise.resolve(new Response(JSON.stringify(body), { status }))

afterEach(() => vi.unstubAllGlobals())

describe('YouTube Check button', () => {
  it('a video opened before comes back at once (no waiting for YouTube)', async () => {
    const { db, svc } = make()
    upsertVideoInfo(db, { videoId: 'dQw4w9WgXcQ', url: LINK, title: 'Saved title', channel: 'Ch', thumbnailUrl: null })
    vi.stubGlobal('fetch', () => new Promise(() => undefined)) // YouTube never answers
    const t0 = Date.now()
    const v = await svc.info(LINK)
    expect(Date.now() - t0).toBeLessThan(50)
    expect(v.title).toBe('Saved title')
  })

  it('a new video opens with basic details if YouTube is slow', async () => {
    const { svc } = make()
    vi.stubGlobal('fetch', (_u: string, o: { signal: AbortSignal }) => new Promise((_r, rej) => o.signal.addEventListener('abort', () => rej(new Error('timeout')))))
    const v = await svc.info(LINK)
    expect(v.videoId).toBe('dQw4w9WgXcQ')
    expect(v.title).toBe('YouTube video')
    expect(v.thumbnailUrl).toContain('dQw4w9WgXcQ')
  })

  it('a new video gets its real title', async () => {
    const { svc } = make()
    vi.stubGlobal('fetch', () => reply(200, { title: 'Real title', author_name: 'Channel', thumbnail_url: 'https://i.ytimg.com/x.jpg' }))
    expect(await svc.info(LINK)).toMatchObject({ title: 'Real title', channel: 'Channel' })
  })

  it('private or blocked videos still give a clear message', async () => {
    const { svc } = make()
    vi.stubGlobal('fetch', () => reply(403))
    await expect(svc.info(LINK)).rejects.toThrow(/embedding|private/)
  })
})
