import type { TranscriptLine, YouTubeLevel } from '@shared/types'

/** The 11-character video id from any common YouTube link, or null. */
export function parseYouTubeId(input: string): string | null {
  const s = input.trim()
  if (/^[A-Za-z0-9_-]{11}$/.test(s)) return s
  let url: URL
  try {
    url = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`)
  } catch {
    return null
  }
  const host = url.hostname.replace(/^(www\.|m\.|music\.)/, '')
  let id: string | null = null
  if (host === 'youtu.be') id = url.pathname.split('/')[1] ?? null
  else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    if (url.pathname === '/watch') id = url.searchParams.get('v')
    else {
      const m = url.pathname.match(/^\/(?:embed|shorts|live|v)\/([^/?#]+)/)
      id = m?.[1] ?? null
    }
  }
  return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null
}

export const canonicalUrl = (id: string): string => `https://www.youtube.com/watch?v=${id}`

/** Start time from a link (?t=90, ?t=1m30s, &start=90), in seconds. */
export function parseStartTime(input: string): number {
  try {
    const url = new URL(/^https?:\/\//i.test(input.trim()) ? input.trim() : `https://${input.trim()}`)
    const t = url.searchParams.get('t') ?? url.searchParams.get('start')
    if (!t) return 0
    if (/^\d+$/.test(t)) return Number(t)
    const m = t.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/)
    return m ? Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0) : 0
  } catch {
    return 0
  }
}

export interface RawTranscriptLine {
  start: number
  end?: number
  text: string
}

/**
 * Cleans Gemini's lines for one clip [chunkStart, chunkEnd] of the video. Gemini may give
 * times from the start of the clip or of the whole video; this detects which and returns
 * whole-video times, sorted, with sensible end times.
 */
export function normalizeTranscriptChunk(raw: RawTranscriptLine[], chunkStart: number, chunkEnd: number): TranscriptLine[] {
  const lines = (raw ?? [])
    .map((l) => ({ start: Number(l.start), end: l.end == null ? NaN : Number(l.end), text: String(l.text ?? '').replace(/\s+/g, ' ').trim() }))
    .filter((l) => l.text && Number.isFinite(l.start) && l.start >= 0)
  if (!lines.length) return []
  const clipLength = chunkEnd - chunkStart
  const relative = chunkStart > 0 && lines.every((l) => l.start <= clipLength + 5) && lines.some((l) => l.start < chunkStart - 5)
  const offset = relative ? chunkStart : 0
  const shifted = lines
    .map((l) => ({ ...l, start: l.start + offset, end: Number.isFinite(l.end) ? l.end + offset : NaN }))
    .filter((l) => l.start >= chunkStart - 2 && l.start <= chunkEnd + 2)
    .sort((a, b) => a.start - b.start)
  return shifted.map((l, i) => {
    const next = shifted[i + 1]?.start
    let end = Number.isFinite(l.end) && l.end > l.start ? l.end : (next ?? l.start + 3)
    if (next != null && end > next) end = next
    return { start: +l.start.toFixed(2), end: +Math.max(end, l.start + 0.5).toFixed(2), text: l.text }
  })
}

/**
 * Rough listening difficulty from the transcript: speaking speed (words per minute)
 * and how many long words there are. A hint for choosing videos, not a test score.
 */
export function estimateLevel(lines: TranscriptLine[]): YouTubeLevel | null {
  if (lines.length < 5) return null
  const words = lines.flatMap((l) => l.text.split(/\s+/).filter(Boolean))
  const speakingMinutes = lines.reduce((a, l) => a + Math.max(0, l.end - l.start), 0) / 60
  if (speakingMinutes <= 0 || words.length < 20) return null
  const wpm = words.length / speakingMinutes
  const longWords = words.filter((w) => w.replace(/[^A-Za-z]/g, '').length >= 8).length / words.length
  const score = (wpm - 110) / 60 + (longWords - 0.08) * 8
  if (score < 0.25) return 'Easy'
  if (score < 1.1) return 'Medium'
  return 'Hard'
}
