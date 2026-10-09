import { createReadStream } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { basename, dirname, extname, join } from 'node:path'
import { SubtitleParser, type MkvSubtitleTrack } from 'matroska-subtitles'
import { decodeSubtitleBuffer, finalizeCues, parseSubtitleText, type Cue } from './parsers'

export const SUBTITLE_EXTENSIONS = ['srt', 'ass', 'ssa', 'vtt']

/**
 * Subtitle files next to the movie whose name starts with the movie's name,
 * English-looking ones first (e.g. "Movie.en.srt", "Movie.English.srt", "Movie.srt").
 */
export async function findSidecarSubtitles(mediaPath: string): Promise<string[]> {
  const dir = dirname(mediaPath)
  const stem = basename(mediaPath, extname(mediaPath)).toLowerCase()
  let entries: string[]
  try {
    entries = await readdir(dir)
  } catch {
    return []
  }
  const score = (name: string): number => {
    const rest = name.toLowerCase().slice(stem.length)
    if (/\b(en|eng|english)\b/.test(rest)) return 0
    if (rest.replace(/\.[^.]+$/, '') === '') return 1
    return 2
  }
  return entries
    .filter((f) => SUBTITLE_EXTENSIONS.includes(extname(f).slice(1).toLowerCase()) && f.toLowerCase().startsWith(stem))
    .sort((a, b) => score(a) - score(b))
    .map((f) => join(dir, f))
}

export async function loadSubtitleFile(path: string): Promise<Cue[]> {
  return parseSubtitleText(decodeSubtitleBuffer(await readFile(path)), extname(path))
}

/** Picks the best English text track: tagged English, unnamed/untagged (usually English), not "forced". */
export function pickEnglishTrack(tracks: MkvSubtitleTrack[]): MkvSubtitleTrack | null {
  if (!tracks.length) return null
  const isEnglish = (t: MkvSubtitleTrack): boolean =>
    /^(en|eng)$/i.test(t.language ?? '') || /english/i.test(t.name ?? '')
  const isForced = (t: MkvSubtitleTrack): boolean => /forced/i.test(t.name ?? '')
  const untagged = (t: MkvSubtitleTrack): boolean => !t.language || t.language === 'und'
  return (
    tracks.find((t) => isEnglish(t) && !isForced(t)) ??
    tracks.find((t) => untagged(t) && !isForced(t)) ??
    tracks.find(isEnglish) ??
    tracks[0]
  )
}

export interface MkvReadHandle {
  cancel: () => void
  done: Promise<{ cues: Cue[]; track: MkvSubtitleTrack | null }>
}

/**
 * Streams an MKV file and extracts its English text subtitles. onBatch receives
 * cleaned cues as they are found, so playback can start before the whole file
 * is read (about 7 s for a 2.5 GB movie on a typical SSD).
 */
export function readMkvSubtitles(
  file: string,
  handlers: { onTrack?: (t: MkvSubtitleTrack | null) => void; onBatch?: (cues: Cue[]) => void }
): MkvReadHandle {
  const parser = new SubtitleParser()
  const stream = createReadStream(file, { highWaterMark: 1 << 20 })
  let track: MkvSubtitleTrack | null = null
  let tracksSeen = false
  const all: Cue[] = []
  let pending: Cue[] = []
  let cancelled = false

  const flush = (): void => {
    if (!pending.length) return
    const batch = finalizeCues(pending)
    pending = []
    all.push(...batch)
    if (batch.length) handlers.onBatch?.(batch)
  }
  const timer = setInterval(flush, 300)

  const done = new Promise<{ cues: Cue[]; track: MkvSubtitleTrack | null }>((resolve, reject) => {
    parser.once('tracks', (tracks: MkvSubtitleTrack[]) => {
      tracksSeen = true
      track = pickEnglishTrack(tracks)
      handlers.onTrack?.(track)
      if (!track) {
        // No text subtitles in this file: stop reading.
        stream.destroy()
        clearInterval(timer)
        resolve({ cues: [], track: null })
      }
    })
    parser.on('subtitle', (sub, trackNumber) => {
      if (track && trackNumber === track.number) {
        pending.push({ start: sub.time / 1000, end: (sub.time + (sub.duration ?? 2000)) / 1000, text: sub.text ?? '' })
      }
    })
    const finish = (): void => {
      clearInterval(timer)
      flush()
      if (!tracksSeen) handlers.onTrack?.(null)
      resolve({ cues: all.sort((a, b) => a.start - b.start), track })
    }
    parser.on('finish', finish)
    stream.on('close', () => {
      if (cancelled) finish()
    })
    stream.on('error', (err) => {
      clearInterval(timer)
      reject(err)
    })
    parser.on('error', (err: Error) => {
      clearInterval(timer)
      reject(err)
    })
  })

  stream.pipe(parser)
  return {
    cancel: () => {
      cancelled = true
      stream.destroy()
    },
    done
  }
}
