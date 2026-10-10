import { describe, expect, it } from 'vitest'
import { estimateLevel, normalizeTranscriptChunk, parseStartTime, parseYouTubeId } from '../src/main/youtube/youtube'
import { CHUNK_SEC, YouTubeService } from '../src/main/youtube/YouTubeService'
import { openDatabase } from '../src/main/db'
import { getVideo, upsertVideoInfo } from '../src/main/db/repos/youtube'
import { GeminiService, completeTranscriptObjects, parseTranscriptJson } from '../src/main/ai/gemini'

describe('YouTube links', () => {
  it('reads the video id from every common link form', () => {
    for (const link of [
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      'youtube.com/watch?v=dQw4w9WgXcQ&list=PL123',
      'https://youtu.be/dQw4w9WgXcQ?t=42',
      'https://m.youtube.com/watch?v=dQw4w9WgXcQ',
      'https://www.youtube.com/shorts/dQw4w9WgXcQ',
      'https://www.youtube.com/embed/dQw4w9WgXcQ',
      'https://www.youtube.com/live/dQw4w9WgXcQ',
      'dQw4w9WgXcQ'
    ]) {
      expect(parseYouTubeId(link), link).toBe('dQw4w9WgXcQ')
    }
    expect(parseYouTubeId('https://vimeo.com/123')).toBeNull()
    expect(parseYouTubeId('https://www.youtube.com/watch?v=short')).toBeNull()
    expect(parseYouTubeId('not a link')).toBeNull()
  })

  it('reads start times from links', () => {
    expect(parseStartTime('https://youtu.be/dQw4w9WgXcQ?t=90')).toBe(90)
    expect(parseStartTime('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=1m30s')).toBe(90)
    expect(parseStartTime('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe(0)
  })
})

describe('AI transcript cleaning', () => {
  it('keeps whole-video times as they are', () => {
    const out = normalizeTranscriptChunk(
      [
        { start: 605, end: 607.5, text: ' Hello   there. ' },
        { start: 601, end: 603, text: 'Earlier line.' }
      ],
      600,
      1200
    )
    expect(out).toEqual([
      { start: 601, end: 603, text: 'Earlier line.' },
      { start: 605, end: 607.5, text: 'Hello there.' }
    ])
  })

  it('converts clip-relative times to whole-video times', () => {
    const out = normalizeTranscriptChunk(
      [
        { start: 1, end: 3, text: 'First.' },
        { start: 4, text: 'Second, no end time.' },
        { start: 9, end: 8, text: 'Bad end time.' }
      ],
      600,
      1200
    )
    expect(out.map((l) => [l.start, l.end])).toEqual([
      [601, 603],
      [604, 609],
      [609, 612]
    ])
  })

  it('drops empty or invalid lines and never invents any', () => {
    expect(normalizeTranscriptChunk([{ start: NaN, text: 'x' }, { start: 3, text: '   ' }], 0, 600)).toEqual([])
    expect(normalizeTranscriptChunk([], 0, 600)).toEqual([])
  })

  it('estimates a listening level from speed and long words', () => {
    const slow = Array.from({ length: 10 }, (_, i) => ({ start: i * 4, end: i * 4 + 3, text: 'I like my cat a lot' }))
    const fast = Array.from({ length: 10 }, (_, i) => ({ start: i * 3, end: i * 3 + 2.5, text: 'Macroeconomic considerations notwithstanding, international cooperation fundamentally determines sustainability outcomes' }))
    expect(estimateLevel(slow)).toBe('Easy')
    expect(estimateLevel(fast)).toBe('Hard')
    expect(estimateLevel(slow.slice(0, 2))).toBeNull()
  })
})

describe('Gemini transcript request fallback', () => {
  it('on "invalid argument" tries simpler requests and remembers the one that works', async () => {
    const svc = new GeminiService(
      () => 'dummy',
      () => 'gemini-test'
    )
    const sent: { lowRes: boolean; thinking: boolean; clip: boolean }[] = []
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(svc as any).client = () => ({
      models: {
        generateContentStream: async (req: { config: Record<string, unknown>; contents: { parts: { videoMetadata?: unknown }[] }[] }) => {
          const r = { lowRes: 'mediaResolution' in req.config, thinking: 'thinkingConfig' in req.config, clip: !!req.contents[0].parts[0].videoMetadata }
          sent.push(r)
          // Like the error in the screenshot: this model rejects the low-resolution setting.
          if (r.lowRes) throw new Error('ApiError: {"error":{"code":400,"message":"Request contains an invalid argument.","status":"INVALID_ARGUMENT"}}')
          return (async function* () {
            yield { text: '[{"start": 2, "end": 4, "text": "Hello."}]' }
          })()
        }
      }
    })
    const lines = await svc.transcribeYouTube('https://www.youtube.com/watch?v=dQw4w9WgXcQ', { startSec: 0, endSec: 600 })
    expect(lines).toEqual([{ start: 2, end: 4, text: 'Hello.' }])
    expect(sent).toEqual([
      { lowRes: true, thinking: true, clip: true }, // thinking off
      { lowRes: true, thinking: true, clip: true }, // minimal thinking
      { lowRes: true, thinking: false, clip: true }, // default thinking
      { lowRes: false, thinking: true, clip: true } // minimal thinking, normal resolution: works
    ])
    // Next part goes straight to the working request.
    await svc.transcribeYouTube('https://www.youtube.com/watch?v=dQw4w9WgXcQ', { startSec: 600, endSec: 833 })
    expect(sent).toHaveLength(5)
    expect(sent[4]).toEqual({ lowRes: false, thinking: true, clip: true })
  })

  it('shows finished lines while Gemini is still writing (streaming)', async () => {
    const svc = new GeminiService(
      () => 'dummy',
      () => 'gemini-test'
    )
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(svc as any).client = () => ({
      models: {
        generateContentStream: async () =>
          (async function* () {
            yield { text: '[{"start": 1, "end": 2, "text": "Hi, '}
            yield { text: 'there."}, {"start": 3, "end": 4, "te' }
            yield { text: 'xt": "A {brace} \\"quote\\""}]' }
          })()
      }
    })
    const partials: number[] = []
    const lines = await svc.transcribeYouTube('https://www.youtube.com/watch?v=dQw4w9WgXcQ', undefined, (l) => partials.push(l.length))
    expect(partials).toEqual([1, 2])
    expect(lines.map((l) => l.text)).toEqual(['Hi, there.', 'A {brace} "quote"'])
  })

  it('finds complete lines in an unfinished reply', () => {
    expect(completeTranscriptObjects('[{"start":1,"end":2,"text":"One"},{"start":3,"te')).toEqual([{ start: 1, end: 2, text: 'One' }])
    expect(completeTranscriptObjects('')).toEqual([])
  })

  it('reads the transcript even when it comes inside a code block', () => {
    expect(parseTranscriptJson('```json\n[{"start":1,"end":2,"text":"Hi"}]\n```')).toEqual([{ start: 1, end: 2, text: 'Hi' }])
    expect(parseTranscriptJson('')).toEqual([])
  })
})

describe('YouTubeService transcripts (Gemini stand-in)', () => {
  const setup = (fail?: { onCall: number; message?: string }) => {
    const db = openDatabase(':memory:')
    upsertVideoInfo(db, { videoId: 'dQw4w9WgXcQ', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', title: 'Test', channel: 'Ch', thumbnailUrl: null })
    const calls: ({ startSec: number; endSec: number } | undefined)[] = []
    const gemini = {
      configured: true,
      transcribeYouTube: async (_url: string, clip?: { startSec: number; endSec: number }) => {
        calls.push(clip)
        if (fail && calls.length === fail.onCall) throw new Error(fail.message ?? 'Network error')
        const base = clip?.startSec ?? 0
        return [
          { start: base + 2, end: base + 4, text: `Line at ${base + 2}` },
          { start: base + 30, end: base + 33, text: `Line at ${base + 30}` }
        ]
      }
    } as unknown as GeminiService
    const progress: number[] = []
    const service = new YouTubeService(db, gemini, (p) => progress.push(p.chunksDone), 10)
    return { db, service, calls, progress }
  }

  it('transcribes a short video in one call and caches it', async () => {
    const { db, service, calls } = setup()
    const v = await service.transcribe('dQw4w9WgXcQ', 60)
    expect(calls).toEqual([undefined])
    expect(v.transcriptComplete).toBe(true)
    expect(v.transcriptSource).toBe('ai')
    expect(v.transcript.map((l) => l.text)).toEqual(['Line at 2', 'Line at 30'])
    await service.transcribe('dQw4w9WgXcQ', 60) // cached: no new Gemini call
    expect(calls).toHaveLength(1)
    expect(getVideo(db, 'dQw4w9WgXcQ')?.durationSec).toBe(60)
  })

  it('splits videos into 1-minute parts (four at a time), and resumes after a failure without duplicates', async () => {
    const { db, service, calls } = setup({ onCall: 2 }) // the 2nd request (part 2) fails
    const duration = 3 * CHUNK_SEC - 30 // 3 parts
    await expect(service.transcribe('dQw4w9WgXcQ', duration)).rejects.toThrow(/Network/)
    // Part 1 finished and is saved; part 2 failed, so the saved progress stops after part 1.
    expect(getVideo(db, 'dQw4w9WgXcQ')?.chunksDone).toBe(1)
    const v = await service.transcribe('dQw4w9WgXcQ', duration) // resumes from part 2
    // First run: parts 1, 2 (failed), 3 (finished but after the gap, so redone). Resume: parts 2 and 3.
    expect(calls.map((c) => c?.startSec)).toEqual([0, CHUNK_SEC, 2 * CHUNK_SEC, CHUNK_SEC, 2 * CHUNK_SEC])
    expect(v.transcriptComplete).toBe(true)
    expect(v.transcript).toHaveLength(6)
    expect(v.transcript.every((l, i) => i === 0 || l.start > v.transcript[i - 1].start)).toBe(true)
  })

  it('runs parts in parallel and shows lines as each part finishes', async () => {
    const { service, calls, progress } = setup()
    await service.transcribe('dQw4w9WgXcQ', 4 * CHUNK_SEC)
    expect(calls).toHaveLength(4)
    expect(progress).toEqual([1, 2, 3, 4])
  })

  it('shares one run when asked twice at once', async () => {
    const { service, calls } = setup()
    await Promise.all([service.transcribe('dQw4w9WgXcQ', 60), service.transcribe('dQw4w9WgXcQ', 60)])
    expect(calls).toHaveLength(1)
  })

  it('a part that hits "busy" waits and is tried again instead of stopping', async () => {
    const { service, calls } = setup({ onCall: 2, message: 'Gemini rate limit or quota reached. Wait a moment and try again.' })
    const v = await service.transcribe('dQw4w9WgXcQ', 3 * CHUNK_SEC)
    expect(v.transcriptComplete).toBe(true)
    expect(calls.map((c) => c?.startSec)).toEqual([0, CHUNK_SEC, 2 * CHUNK_SEC, CHUNK_SEC])
    expect(v.transcript).toHaveLength(6)
  })

  it('a 3:51 video is made in 4 parts that run at the same time', async () => {
    const { service, calls } = setup()
    let inFlight = 0
    let peak = 0
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const g = (service as any).gemini
    const orig = g.transcribeYouTube
    g.transcribeYouTube = async (...a: unknown[]) => {
      peak = Math.max(peak, ++inFlight)
      await new Promise((r) => setTimeout(r, 20))
      inFlight--
      return orig(...a)
    }
    await service.transcribe('dQw4w9WgXcQ', 231)
    expect(calls).toHaveLength(4)
    expect(peak).toBe(4)
  })
})
