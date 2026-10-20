/**
 * Speaking Coach state. Kept in a store (not the component) so a running job keeps going
 * when you switch to another section and come back.
 */
import { create } from 'zustand'
import { useApp } from '@renderer/stores/app'
import { extractAudio, ExtractError, PART_SECONDS } from './audioExtract'
import { getApiKey, isAbortError, SPEAKING_COACH_MODEL, transcribeAudioPart } from './geminiService'
import { deleteTranscript, getTranscript, listTranscripts, saveTranscript, type TranscriptSummary } from './transcriptDb'
import { baseName, fileExtension, mergePartLines, segmentsToLines, type TranscriptLine } from './transcriptFormat'

export const ACCEPTED_EXTENSIONS = ['mp4', 'mov', 'mkv', 'webm', 'mp3', 'wav', 'm4a', 'ogg']
/** For <input type="file" accept>. */
export const ACCEPT_ATTR = ACCEPTED_EXTENSIONS.map((e) => `.${e}`).join(',')
const VIDEO_EXTENSIONS = new Set(['mp4', 'mov', 'mkv', 'webm'])
export const MAX_BYTES = 500 * 1024 * 1024
export const BIG_BYTES = 300 * 1024 * 1024
/** Audio Gemini reads as-is: sent without conversion when under ~20 MB and ≤ 10 minutes. */
const DIRECT_AUDIO: Record<string, string> = { mp3: 'audio/mp3', wav: 'audio/wav', ogg: 'audio/ogg' }
const SKIP_CONVERSION_BYTES = 20 * 1024 * 1024

export type Phase = 'idle' | 'extracting' | 'transcribing' | 'done' | 'failed'
export type PartStatus = 'pending' | 'uploading' | 'transcribing' | 'done' | 'failed'

export interface PartState {
  index: number
  blob: Blob
  mimeType: string
  offsetSec: number
  durationSec: number | null
  status: PartStatus
  error?: string
}

/** The recording the transcript on screen belongs to (also known for transcripts opened from History). */
export interface SourceInfo {
  fileName: string
  fileSize: number
  durationSec: number | null
}

interface SpeakingCoachState {
  view: 'main' | 'history'
  settingsOpen: boolean

  /** The original file, played locally from an object URL (never uploaded). */
  file: File | null
  mediaUrl: string | null
  isVideo: boolean
  source: SourceInfo | null
  bigFileWarning: boolean

  phase: Phase
  status: string
  progress: number | null
  error: string | null
  parts: PartState[]

  lines: TranscriptLine[]
  complete: boolean
  savedId: string | null
  createdAt: number | null
  dirty: boolean
  history: TranscriptSummary[]

  setView: (view: 'main' | 'history') => void
  setSettingsOpen: (open: boolean) => void
  chooseFile: (file: File) => void
  attachMedia: (file: File) => void
  setDuration: (sec: number) => void
  start: (confirmedBig?: boolean) => Promise<void>
  dismissBigWarning: () => void
  retryFailed: () => Promise<void>
  cancel: () => void
  editLine: (id: number, text: string) => void
  save: (quiet?: boolean) => Promise<void>
  loadHistory: () => Promise<void>
  openSaved: (id: string) => Promise<void>
  deleteSaved: (id: string) => Promise<void>
  reset: () => void
}

let controller: AbortController | null = null

const isBusy = (phase: Phase): boolean => phase === 'extracting' || phase === 'transcribing'

/** Checks type and size. Returns an error message, or null if the file is fine. */
export function checkFile(file: File): string | null {
  if (!ACCEPTED_EXTENSIONS.includes(fileExtension(file.name))) return `This file type isn't supported. Use: ${ACCEPTED_EXTENSIONS.join(', ')}.`
  if (file.size > MAX_BYTES) return 'This file is bigger than 500 MB. Try a shorter clip.'
  return null
}

const EMPTY_JOB = {
  phase: 'idle' as Phase,
  status: '',
  progress: null,
  error: null,
  parts: [],
  lines: [],
  complete: false,
  savedId: null,
  createdAt: null,
  dirty: false,
  bigFileWarning: false
}

export const useSpeakingCoach = create<SpeakingCoachState>((set, get) => {
  const updatePart = (index: number, patch: Partial<PartState>): void =>
    set({ parts: get().parts.map((p) => (p.index === index ? { ...p, ...patch } : p)) })

  const setMedia = (file: File | null): void => {
    const old = get().mediaUrl
    if (old) URL.revokeObjectURL(old)
    const ext = file ? fileExtension(file.name) : ''
    set({
      file,
      mediaUrl: file ? URL.createObjectURL(file) : null,
      isVideo: !!file && (VIDEO_EXTENSIONS.has(ext) || file.type.startsWith('video/'))
    })
  }

  /** Transcribes the parts that aren't done yet, one at a time, stopping at the first failure. */
  const transcribeRemaining = async (): Promise<void> => {
    const signal = controller?.signal
    set({ phase: 'transcribing', error: null, progress: null })
    const total = get().parts.length
    const name = baseName(get().source?.fileName ?? 'recording')
    for (const part of get().parts) {
      if (part.status === 'done') continue
      const n = part.index + 1
      try {
        const segments = await transcribeAudioPart(part.blob, part.mimeType, `${name} part ${n}`, {
          signal,
          onStage: (stage) => {
            updatePart(part.index, { status: stage, error: undefined })
            set({ status: `${stage === 'uploading' ? 'Uploading' : 'Transcribing'} part ${n}/${total}…` })
          },
          onWait: (w) =>
            set({
              status:
                w.reason === 'rate_limit'
                  ? `Free limit hit. Retrying part ${n}/${total} in ${w.secondsLeft}s (try ${w.attempt}/${w.maxAttempts})…`
                  : `Gemini is busy. Retrying part ${n}/${total} in ${w.secondsLeft}s (try ${w.attempt}/${w.maxAttempts})…`
            })
        })
        const added = segmentsToLines(segments, part.offsetSec, part.index, part.durationSec)
        set({ lines: mergePartLines(get().lines, part.index, added) })
        updatePart(part.index, { status: 'done' })
        set({ complete: get().parts.every((p) => p.status === 'done') })
        // Saved after every finished part, so nothing is lost if the app closes.
        await get().save(true)
      } catch (err) {
        const message = isAbortError(err) ? 'Stopped.' : err instanceof Error ? err.message : String(err)
        updatePart(part.index, { status: 'failed', error: message })
        set({ phase: 'failed', error: message, status: '' })
        return
      }
    }
    set({ phase: 'done', status: `Done: ${get().lines.length} lines.`, complete: true })
  }

  return {
    view: 'main',
    settingsOpen: !getApiKey(),
    file: null,
    mediaUrl: null,
    isVideo: false,
    source: null,
    ...EMPTY_JOB,
    history: [],

    setView: (view) => set({ view }),
    setSettingsOpen: (settingsOpen) => set({ settingsOpen }),

    chooseFile: (file) => {
      if (isBusy(get().phase)) return
      const problem = checkFile(file)
      if (problem) {
        set({ error: problem })
        return
      }
      setMedia(file)
      set({ ...EMPTY_JOB, view: 'main', source: { fileName: file.name, fileSize: file.size, durationSec: null }, bigFileWarning: file.size > BIG_BYTES })
    },

    attachMedia: (file) => {
      const problem = checkFile(file)
      if (problem) {
        set({ error: problem })
        return
      }
      setMedia(file)
    },

    setDuration: (sec) => {
      const source = get().source
      if (source && !source.durationSec && Number.isFinite(sec) && sec > 0) set({ source: { ...source, durationSec: sec } })
    },

    dismissBigWarning: () => set({ bigFileWarning: false }),

    start: async (confirmedBig = false) => {
      const { file, phase, source } = get()
      if (!file || !source || isBusy(phase)) return
      if (file.size > BIG_BYTES && !confirmedBig) {
        set({ bigFileWarning: true })
        return
      }
      if (!getApiKey()) {
        set({ error: 'Paste your Gemini API key in Settings first.', settingsOpen: true })
        return
      }
      controller = new AbortController()
      const signal = controller.signal
      set({ ...EMPTY_JOB, phase: 'extracting', status: 'Preparing…' })

      let parts: PartState[]
      const direct = DIRECT_AUDIO[fileExtension(file.name)]
      if (direct && file.size < SKIP_CONVERSION_BYTES && source.durationSec && source.durationSec <= PART_SECONDS) {
        parts = [{ index: 0, blob: file, mimeType: direct, offsetSec: 0, durationSec: source.durationSec, status: 'pending' }]
      } else {
        try {
          const result = await extractAudio(file, {
            durationSec: source.durationSec,
            signal,
            onLoading: () => set({ status: 'Loading audio tools…' }),
            onProgress: (p) => set({ status: `Extracting audio… ${p}%`, progress: p })
          })
          if (result.durationSec) get().setDuration(result.durationSec)
          parts = result.parts.map((p) => ({ ...p, status: 'pending' as const }))
        } catch (err) {
          if (err instanceof ExtractError && err.kind === 'cancelled') {
            set({ ...EMPTY_JOB })
            return
          }
          set({ phase: 'failed', status: '', progress: null, error: err instanceof Error ? err.message : String(err) })
          return
        }
      }
      set({ parts, progress: null })
      await transcribeRemaining()
    },

    retryFailed: async () => {
      if (isBusy(get().phase) || !get().parts.some((p) => p.status !== 'done')) return
      if (!getApiKey()) {
        set({ error: 'Paste your Gemini API key in Settings first.', settingsOpen: true })
        return
      }
      controller = new AbortController()
      await transcribeRemaining()
    },

    cancel: () => controller?.abort(),

    editLine: (id, text) => set({ lines: get().lines.map((l) => (l.id === id ? { ...l, text } : l)), dirty: true }),

    save: async (quiet = false) => {
      const { lines, source, savedId, createdAt, complete } = get()
      if (!source || lines.length === 0) return
      const now = Date.now()
      const id = savedId ?? crypto.randomUUID()
      await saveTranscript({
        id,
        title: baseName(source.fileName),
        fileName: source.fileName,
        fileSize: source.fileSize,
        durationSec: source.durationSec,
        model: SPEAKING_COACH_MODEL,
        complete,
        createdAt: createdAt ?? now,
        updatedAt: now,
        lines
      })
      set({ savedId: id, createdAt: createdAt ?? now, dirty: false })
      void get().loadHistory()
      if (!quiet) useApp.getState().toast('success', 'Transcript saved')
    },

    loadHistory: async () => set({ history: await listTranscripts() }),

    openSaved: async (id) => {
      if (isBusy(get().phase)) return
      const t = await getTranscript(id)
      if (!t) return
      // Keep the loaded media only if it is the same recording.
      const { file } = get()
      if (!file || file.name !== t.fileName || file.size !== t.fileSize) setMedia(null)
      set({
        ...EMPTY_JOB,
        view: 'main',
        source: { fileName: t.fileName, fileSize: t.fileSize, durationSec: t.durationSec },
        phase: 'done',
        lines: t.lines,
        complete: t.complete,
        savedId: t.id,
        createdAt: t.createdAt
      })
    },

    deleteSaved: async (id) => {
      await deleteTranscript(id)
      if (get().savedId === id) set({ savedId: null, createdAt: null, dirty: get().lines.length > 0 })
      await get().loadHistory()
    },

    reset: () => {
      if (isBusy(get().phase)) return
      setMedia(null)
      set({ ...EMPTY_JOB, view: 'main', source: null })
    }
  }
})
