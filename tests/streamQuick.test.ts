import { describe, expect, it } from 'vitest'
import { GeminiService } from '../src/main/ai/gemini'

// Explanation / chat streaming: quick answers when the main model is busy or slow.
type Script = (model: string, signal: AbortSignal) => AsyncGenerator<{ text: string }> | Promise<never>

function service(script: Script): { svc: GeminiService; asked: string[] } {
  const svc = new GeminiService(
    () => 'dummy',
    () => 'gemini-flash-latest'
  )
  const asked: string[] = []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = svc as any
  s.client = () => ({
    models: {
      generateContentStream: async (req: { model: string; config: { abortSignal: AbortSignal } }) => {
        asked.push(req.model)
        const r = script(req.model, req.config.abortSignal)
        if (r instanceof Promise) return r
        return r
      },
      list: async () =>
        (async function* () {
          yield { name: 'models/gemini-flash-latest' }
          yield { name: 'models/gemini-flash-lite-latest' }
        })()
    }
  })
  s.streamHedgeMs = 60
  return { svc, asked }
}
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
async function* words(list: string[], delay = 0, signal?: AbortSignal) {
  for (const w of list) {
    if (delay) await wait(delay)
    if (signal?.aborted) return
    yield { text: w }
  }
}

describe('Explanation streaming: quick answers', () => {
  it('busy main model → light model at once (no retry waits)', async () => {
    const { svc, asked } = service((m) => (m === 'gemini-flash-latest' ? Promise.reject(new Error('{"error":{"code":503,"status":"UNAVAILABLE"}}')) : words(['Hi ', 'there'])))
    const got: string[] = []
    const t0 = Date.now()
    expect(await svc.stream({ contents: [], onDelta: (t) => got.push(t) })).toBe('Hi there')
    expect(Date.now() - t0).toBeLessThan(500)
    expect(asked).toEqual(['gemini-flash-latest', 'gemini-flash-lite-latest'])
    expect(got.join('')).toBe('Hi there')
  })

  it('slow main model → light model asked too; first to write wins, no duplicate text', async () => {
    const { svc, asked } = service((m, signal) => (m === 'gemini-flash-latest' ? words(['SLOW ', 'MAIN'], 400, signal) : words(['Fast ', 'light'], 10, signal)))
    const got: string[] = []
    expect(await svc.stream({ contents: [], onDelta: (t) => got.push(t) })).toBe('Fast light')
    await wait(900)
    expect(got.join('')).toBe('Fast light')
    expect(asked).toEqual(['gemini-flash-latest', 'gemini-flash-lite-latest'])
  })

  it('fast main model → only one request', async () => {
    const { svc, asked } = service(() => words(['Quick ', 'answer']))
    expect(await svc.stream({ contents: [], onDelta: () => undefined })).toBe('Quick answer')
    await wait(100)
    expect(asked).toEqual(['gemini-flash-latest'])
  })

  it('both fail → one clear error', async () => {
    const { svc } = service(() => Promise.reject(new Error('{"error":{"code":429,"status":"RESOURCE_EXHAUSTED"}}')))
    await expect(svc.stream({ contents: [], onDelta: () => undefined })).rejects.toThrow(/rate limit|quota/i)
  })
})
