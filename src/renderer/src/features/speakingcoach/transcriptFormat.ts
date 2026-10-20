/** Speaking Coach: pure helpers for timestamps, Gemini transcript validation and export (no DOM, unit-tested). */

/** One transcript line. `id` is 1..n in order; `part` is the ~10-minute audio part it came from. */
export interface TranscriptLine {
  id: number
  start: number
  end: number
  text: string
  part: number
}

/** One segment exactly as Gemini returns it (times are relative to the start of that audio part). */
export interface RawSegment {
  start: string
  end: string
  text: string
}

/** "mm:ss", "h:mm:ss", "m:ss.5", "75" or 75 → seconds. Null when it can't be read. */
export function parseTimestamp(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? value : null
  if (typeof value !== 'string') return null
  const s = value.trim()
  if (/^\d+(?:[.,]\d+)?$/.test(s)) return Number(s.replace(',', '.'))
  const m = /^(\d+):(\d{1,2})(?::(\d{1,2}))?(?:[.,](\d+))?$/.exec(s)
  if (!m) return null
  const frac = m[4] ? Number(`0.${m[4]}`) : 0
  const [a, b, c] = [Number(m[1]), Number(m[2]), m[3] === undefined ? null : Number(m[3])]
  return c === null ? a * 60 + b + frac : a * 3600 + b * 60 + c + frac
}

/** 75 → "01:15", 3725 → "1:02:05". */
export function formatClock(sec: number): string {
  const t = Math.max(0, Math.floor(sec))
  const h = Math.floor(t / 3600)
  const m = Math.floor((t % 3600) / 60)
  const s = t % 60
  const mm = String(m).padStart(2, '0')
  const ss = String(s).padStart(2, '0')
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

/** 75.5 → "00:01:15,500" (SubRip time). */
export function formatSrtTime(sec: number): string {
  const ms = Math.max(0, Math.round(sec * 1000))
  const h = Math.floor(ms / 3_600_000)
  const m = Math.floor((ms % 3_600_000) / 60_000)
  const s = Math.floor((ms % 60_000) / 1000)
  const pad = (n: number, w = 2): string => String(n).padStart(w, '0')
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(ms % 1000, 3)}`
}

/**
 * Checks Gemini's {"segments":[...]} answer. Returns the segments, or null when the shape is wrong
 * (the caller then asks Gemini once more). An empty list is valid (silent audio).
 */
export function validateSegments(json: unknown): RawSegment[] | null {
  if (!json || typeof json !== 'object') return null
  const segments = (json as { segments?: unknown }).segments
  if (!Array.isArray(segments)) return null
  const out: RawSegment[] = []
  for (const seg of segments) {
    if (!seg || typeof seg !== 'object') return null
    const { start, end, text } = seg as Record<string, unknown>
    if (typeof text !== 'string') return null
    if (parseTimestamp(start) === null) return null
    if (end !== undefined && end !== null && end !== '' && parseTimestamp(end) === null) return null
    if (!text.trim()) continue
    out.push({ start: String(start), end: end === undefined || end === null ? '' : String(end), text: text.trim() })
  }
  return out
}

/**
 * Turns one part's segments into lines with absolute times: adds the part's offset, fills a missing end
 * with the next start, and keeps times inside the part when its length is known.
 */
export function segmentsToLines(segments: RawSegment[], offsetSec: number, part: number, partDurationSec: number | null): Omit<TranscriptLine, 'id'>[] {
  const clamp = (t: number): number => (partDurationSec && partDurationSec > 0 ? Math.min(Math.max(0, t), partDurationSec) : Math.max(0, t))
  return segments.map((seg, i) => {
    const start = clamp(parseTimestamp(seg.start) ?? 0)
    const nextStart = segments[i + 1] ? parseTimestamp(segments[i + 1].start) : null
    const rawEnd = parseTimestamp(seg.end) ?? nextStart ?? start + 2
    const end = Math.max(start, clamp(rawEnd))
    return { start: start + offsetSec, end: end + offsetSec, text: seg.text, part }
  })
}

/** Replaces the lines of one part (keeping your edits in the other parts) and renumbers ids 1..n. */
export function mergePartLines(existing: TranscriptLine[], part: number, added: Omit<TranscriptLine, 'id'>[]): TranscriptLine[] {
  const kept = existing.filter((l) => l.part !== part).map(({ id: _id, ...rest }) => rest)
  return [...kept, ...added]
    .sort((a, b) => a.part - b.part || a.start - b.start)
    .map((l, i) => ({ ...l, id: i + 1 }))
}

/** "[00:12] text" per line — used for Copy all and the .txt download. */
export function toPlainText(lines: TranscriptLine[]): string {
  return lines.map((l) => `[${formatClock(l.start)}] ${l.text}`).join('\n')
}

export function toSrt(lines: TranscriptLine[]): string {
  return lines
    .map((l, i) => {
      // SRT players need end > start.
      const end = l.end > l.start ? l.end : l.start + 1
      return `${i + 1}\n${formatSrtTime(l.start)} --> ${formatSrtTime(end)}\n${l.text}\n`
    })
    .join('\n')
}

/** 1536000 → "1.5 MB". */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}

/** "my talk.final.mp4" → "my talk.final". */
export function baseName(fileName: string): string {
  const i = fileName.lastIndexOf('.')
  return i > 0 ? fileName.slice(0, i) : fileName
}

export function fileExtension(fileName: string): string {
  const i = fileName.lastIndexOf('.')
  return i >= 0 ? fileName.slice(i + 1).toLowerCase() : ''
}
