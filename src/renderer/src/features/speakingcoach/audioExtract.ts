/**
 * Speaking Coach: audio extraction in the browser with ffmpeg.wasm (single-thread core, no COOP/COEP needed).
 * ffmpeg runs inside its own Web Worker, so the page never freezes. It is loaded only when the Speaking Coach
 * section opens, and terminated after each job so its memory is given back.
 */
import type { FFmpeg, LogEvent } from '@ffmpeg/ffmpeg'
// Served from node_modules by Vite (no CDN): the ffmpeg worker, the core script and its wasm.
import ffmpegWorkerURL from '@ffmpeg/ffmpeg/worker?worker&url'
import ffmpegCoreURL from '@ffmpeg/core?url'
import ffmpegWasmURL from '@ffmpeg/core/wasm?url'

/** Parts are cut every 10 minutes. */
export const PART_SECONDS = 600

export interface AudioPart {
  index: number
  blob: Blob
  mimeType: string
  /** Where this part starts in the original recording. */
  offsetSec: number
  durationSec: number | null
}

export interface ExtractResult {
  parts: AudioPart[]
  /** Length of the recording as ffmpeg read it (null if unknown). */
  durationSec: number | null
}

export class ExtractError extends Error {
  constructor(
    message: string,
    readonly kind: 'memory' | 'no_audio' | 'cancelled' | 'other'
  ) {
    super(message)
    this.name = 'ExtractError'
  }
}

let instance: FFmpeg | null = null
let loading: Promise<FFmpeg> | null = null

const absolute = (url: string): string => new URL(url, window.location.href).href

async function getFFmpeg(): Promise<FFmpeg> {
  if (instance) return instance
  loading ??= (async () => {
    const { FFmpeg } = await import('@ffmpeg/ffmpeg')
    const ff = new FFmpeg()
    await ff.load({ classWorkerURL: absolute(ffmpegWorkerURL), coreURL: absolute(ffmpegCoreURL), wasmURL: absolute(ffmpegWasmURL) })
    instance = ff
    return ff
  })().finally(() => {
    loading = null
  })
  return loading
}

/** Starts loading ffmpeg in the background (called when the section opens). */
export function preloadFFmpeg(): void {
  void getFFmpeg().catch(() => undefined)
}

/** Stops the ffmpeg worker and frees all of its memory. */
export function releaseFFmpeg(): void {
  instance?.terminate()
  instance = null
}

const hms = (h: string, m: string, s: string): number => Number(h) * 3600 + Number(m) * 60 + Number(s)

function isMemoryError(text: string): boolean {
  return /out of memory|memory access out of bounds|Cannot enlarge memory|Array buffer allocation failed|RangeError|OOM|Aborted\(/i.test(text)
}

/**
 * Extracts the audio track to mono 16 kHz MP3 (~32 kbps), cut into ~10-minute parts.
 * The file is mounted with WORKERFS (read in place, never copied whole into memory).
 */
export async function extractAudio(
  file: File,
  opts: { durationSec: number | null; onProgress?: (percent: number) => void; onLoading?: () => void; signal?: AbortSignal }
): Promise<ExtractResult> {
  const { onProgress, signal } = opts
  if (signal?.aborted) throw new ExtractError('Stopped.', 'cancelled')
  if (!instance) opts.onLoading?.()

  let ff: FFmpeg
  try {
    ff = await getFFmpeg()
  } catch (err) {
    const text = String(err instanceof Error ? err.message : err)
    if (isMemoryError(text)) throw new ExtractError("Your device couldn't process this file. Try a shorter clip.", 'memory')
    throw new ExtractError(`Couldn't load the audio tools: ${text}`, 'other')
  }

  let total = opts.durationSec
  const logTail: string[] = []
  const onLog = ({ message }: LogEvent): void => {
    logTail.push(message)
    if (logTail.length > 40) logTail.shift()
    if (!total) {
      const d = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(message)
      if (d) total = hms(d[1], d[2], d[3])
    }
    const t = /time=\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(message)
    if (t && total) onProgress?.(Math.min(99, Math.round((hms(t[1], t[2], t[3]) / total) * 100)))
  }
  ff.on('log', onLog)

  let cancelled = false
  const onAbort = (): void => {
    cancelled = true
    releaseFFmpeg() // stops the running command at once
  }
  signal?.addEventListener('abort', onAbort, { once: true })

  const { FFFSType } = await import('@ffmpeg/ffmpeg')
  const IN = '/sc_in'
  const OUT = '/sc_out'
  try {
    await ff.createDir(IN)
    await ff.createDir(OUT)
    await ff.mount(FFFSType.WORKERFS, { files: [file] }, IN)
    onProgress?.(0)
    const ret = await ff.exec([
      '-i', `${IN}/${file.name}`,
      '-vn',
      '-map', '0:a:0',
      '-ac', '1',
      '-ar', '16000',
      '-c:a', 'libmp3lame',
      '-b:a', '32k',
      '-f', 'segment',
      '-segment_time', String(PART_SECONDS),
      '-reset_timestamps', '1',
      '-segment_list', `${OUT}/list.csv`,
      '-segment_list_type', 'csv',
      `${OUT}/part_%03d.mp3`
    ]) // prettier-ignore
    const log = logTail.join('\n')
    if (ret !== 0) {
      if (/matches no streams|does not contain any stream|Output file .* does not contain/i.test(log)) throw new ExtractError('This file has no audio track.', 'no_audio')
      if (isMemoryError(log)) throw new ExtractError("Your device couldn't process this file. Try a shorter clip.", 'memory')
      const last = logTail.filter((l) => /error|invalid/i.test(l)).pop() ?? `ffmpeg exited with code ${ret}`
      throw new ExtractError(`Couldn't extract the audio: ${last}`, 'other')
    }

    // list.csv: "part_000.mp3,0.000000,600.000000" per part (exact start/end of each part).
    const list = String(await ff.readFile(`${OUT}/list.csv`, 'utf8'))
    const rows = list
      .split(/\r?\n/)
      .map((r) => r.trim())
      .filter(Boolean)
      .map((r) => r.split(','))
    const parts: AudioPart[] = []
    for (const [i, [name, start, end]] of rows.entries()) {
      const data = (await ff.readFile(`${OUT}/${name}`)) as Uint8Array
      await ff.deleteFile(`${OUT}/${name}`)
      const s = Number(start)
      const e = Number(end)
      parts.push({
        index: i,
        blob: new Blob([data.slice().buffer], { type: 'audio/mp3' }),
        mimeType: 'audio/mp3',
        offsetSec: Number.isFinite(s) ? s : i * PART_SECONDS,
        durationSec: Number.isFinite(e) && Number.isFinite(s) ? Math.max(0, e - s) : null
      })
    }
    if (parts.length === 0) throw new ExtractError('This file has no audio track.', 'no_audio')
    onProgress?.(100)
    return { parts, durationSec: total }
  } catch (err) {
    if (cancelled) throw new ExtractError('Stopped.', 'cancelled')
    if (err instanceof ExtractError) throw err
    const text = String(err instanceof Error ? err.message : err)
    if (isMemoryError(text) || isMemoryError(logTail.join('\n'))) throw new ExtractError("Your device couldn't process this file. Try a shorter clip.", 'memory')
    throw new ExtractError(`Couldn't extract the audio: ${text}`, 'other')
  } finally {
    signal?.removeEventListener('abort', onAbort)
    // Free everything: the worker (and all wasm memory) is thrown away after each job.
    if (instance === ff) releaseFFmpeg()
  }
}
