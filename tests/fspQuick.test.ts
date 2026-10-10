import { describe, expect, it } from 'vitest'
import { GeminiService } from '../src/main/ai/gemini'

// Sentence Practice check: no retry waits; the light model answers when the main one is busy or slow.
type Reply = (model: string) => Promise<{ text: string }>

function service(reply: Reply): { svc: GeminiService; asked: string[] } {
  const svc = new GeminiService(
    () => 'dummy',
    () => 'gemini-flash-latest'
  )
  const asked: string[] = []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = svc as any
  s.client = () => ({
    models: {
      generateContent: (req: { model: string }) => {
        asked.push(req.model)
        return reply(req.model)
      },
      list: async () =>
        (async function* () {
          yield { name: 'models/gemini-flash-latest' }
          yield { name: 'models/gemini-flash-lite-latest' }
        })()
    }
  })
  s.fspHedgeMs = 50
  return { svc, asked }
}

const OK = { status: 'correct', usesTargetCorrectly: true, challengeMet: true, errors: [], corrected: 'x', optionalTip: '' }
const input = { term: 'go', type: 'word' as const, meaningBn: '', sentence: 'I go to school every day.', challenge: 'Write a simple sentence.', context: null }

describe('Sentence Practice: quick check', () => {
  it('busy main model → light model at once (no retry waiting)', async () => {
    const { svc, asked } = service(async (m) => {
      if (m === 'gemini-flash-latest') throw new Error('{"error":{"code":503,"status":"UNAVAILABLE"}}')
      return { text: JSON.stringify(OK) }
    })
    const t0 = Date.now()
    expect(await svc.fspCheck(input)).toMatchObject({ status: 'correct' })
    expect(Date.now() - t0).toBeLessThan(500)
    expect(asked).toEqual(['gemini-flash-latest', 'gemini-flash-lite-latest'])
  })

  it('slow main model → the light model is asked too and the first answer wins', async () => {
    const { svc, asked } = service((m) =>
      m === 'gemini-flash-latest' ? new Promise(() => undefined) : Promise.resolve({ text: JSON.stringify(OK) })
    )
    expect(await svc.fspCheck(input)).toMatchObject({ status: 'correct' })
    expect(asked).toEqual(['gemini-flash-latest', 'gemini-flash-lite-latest'])
  })

  it('fast main model → only one request', async () => {
    const { svc, asked } = service(async () => ({ text: JSON.stringify(OK) }))
    await svc.fspCheck(input)
    await new Promise((r) => setTimeout(r, 80))
    expect(asked).toEqual(['gemini-flash-latest'])
  })

  it('both fail → a clear error', async () => {
    const { svc } = service(async () => {
      throw new Error('{"error":{"code":429,"status":"RESOURCE_EXHAUSTED"}}')
    })
    await expect(svc.fspCheck(input)).rejects.toThrow(/rate limit|quota/i)
  })
})
