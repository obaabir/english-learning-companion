import type { TranscriptLine, YouTubeVideo } from '@shared/types'
import type { Db } from '../db'
import type { GeminiService } from '../ai/gemini'
import { getVideo, saveTranscriptProgress, upsertVideoInfo } from '../db/repos/youtube'
import { canonicalUrl, estimateLevel, normalizeTranscriptChunk, parseYouTubeId } from './youtube'

/** Long videos are transcribed in 5-minute parts, two at a time, so lines appear sooner. */
export const CHUNK_SEC = 300
const SINGLE_CALL_MAX_SEC = 6 * 60
const PARALLEL = 2

/** Sorted lines from several parts, without duplicates where parts overlap. */
function mergeLines(parts: TranscriptLine[][]): TranscriptLine[] {
  const all = parts.flat().sort((a, b) => a.start - b.start)
  return all.filter((l, i) => i === 0 || !(Math.abs(l.start - all[i - 1].start) < 0.5 && l.text === all[i - 1].text))
}

export interface TranscriptProgress {
  videoId: string
  transcript: TranscriptLine[]
  chunksDone: number
  totalChunks: number
  complete: boolean
}

export class YouTubeService {
  private running = new Map<string, Promise<YouTubeVideo>>()

  constructor(
    private readonly db: Db,
    private readonly gemini: GeminiService,
    private readonly onProgress: (p: TranscriptProgress) => void
  ) {}

  /** Checks a link and returns the video's details (YouTube's official oEmbed; free, no key). */
  async info(link: string): Promise<YouTubeVideo> {
    const videoId = parseYouTubeId(link)
    if (!videoId) throw new Error("That doesn't look like a YouTube video link.")
    const url = canonicalUrl(videoId)
    let res: Response
    try {
      res = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`, { signal: AbortSignal.timeout(10000) })
    } catch {
      const cached = getVideo(this.db, videoId)
      if (cached) return cached
      throw new Error('Could not reach YouTube. Check your internet connection.')
    }
    if (res.status === 401 || res.status === 403) throw new Error("This video can't be played inside other apps (its owner turned off embedding), or it is private.")
    if (!res.ok) throw new Error('Video not found. It may be private, deleted, or the link is wrong.')
    const o = (await res.json()) as { title?: string; author_name?: string; thumbnail_url?: string }
    upsertVideoInfo(this.db, {
      videoId,
      url,
      title: o.title ?? 'YouTube video',
      channel: o.author_name ?? '',
      thumbnailUrl: o.thumbnail_url ?? null
    })
    return getVideo(this.db, videoId)!
  }

  /** Makes (or resumes) the AI transcript. Concurrent calls for the same video share one run. */
  transcribe(videoId: string, durationSec: number | null): Promise<YouTubeVideo> {
    const existing = this.running.get(videoId)
    if (existing) return existing
    const run = this.run(videoId, durationSec).finally(() => this.running.delete(videoId))
    this.running.set(videoId, run)
    return run
  }

  private async run(videoId: string, durationSec: number | null): Promise<YouTubeVideo> {
    const video = getVideo(this.db, videoId)
    if (!video) throw new Error('Check the video link first.')
    if (video.transcriptComplete) return video
    if (!this.gemini.configured) throw new Error('Add your Gemini API key in Settings to make transcripts.')

    const duration = durationSec && durationSec > 0 ? durationSec : video.durationSec
    const single = !duration || duration <= SINGLE_CALL_MAX_SEC
    const totalChunks = single ? 1 : Math.ceil(duration / CHUNK_SEC)
    const saved = video.chunksDone > 0 ? video.transcript : []
    const results = new Map<number, TranscriptLine[]>()
    let next = video.chunksDone
    let firstError: unknown = null

    const report = (): void => {
      // Saved progress = the unbroken run of finished parts from the start (so a resume never duplicates).
      let prefix = video.chunksDone
      while (results.has(prefix)) prefix++
      const savedLines = mergeLines([saved, ...[...results.entries()].filter(([i]) => i < prefix).map(([, l]) => l)])
      const shown = mergeLines([saved, ...results.values()])
      const complete = prefix === totalChunks
      saveTranscriptProgress(this.db, videoId, { transcript: savedLines, chunksDone: prefix, complete, durationSec: duration ?? null, level: estimateLevel(savedLines) })
      this.onProgress({ videoId, transcript: shown, chunksDone: results.size + video.chunksDone, totalChunks, complete })
    }

    const worker = async (): Promise<void> => {
      while (!firstError && next < totalChunks) {
        const i = next++
        const clip = single ? undefined : { startSec: i * CHUNK_SEC, endSec: Math.min(duration!, (i + 1) * CHUNK_SEC) }
        try {
          const raw = await this.gemini.transcribeYouTube(video.url, clip)
          results.set(i, normalizeTranscriptChunk(raw, clip?.startSec ?? 0, clip?.endSec ?? Number.MAX_SAFE_INTEGER))
          report()
        } catch (err) {
          firstError ??= err
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(PARALLEL, totalChunks - video.chunksDone) }, worker))
    if (firstError) throw firstError
    return getVideo(this.db, videoId)!
  }
}
