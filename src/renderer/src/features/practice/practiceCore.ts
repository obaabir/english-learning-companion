import { createContext } from 'react'
import { create } from 'zustand'
import type { SubtitleLine } from '@shared/types'
import { invoke } from '@renderer/lib/api'
import { useMovie } from '@renderer/stores/movie'

/** What the practice module needs from a player (VLC/mpv today; others later). */
export interface PracticePlayer {
  play(): Promise<void>
  pause(): Promise<void>
  seek(seconds: number): Promise<void>
  setRate(rate: number): Promise<void>
  /** Best estimate of the playback time now, or null if unknown. */
  currentTime(): number | null
}

import { PAD, type Count, type Rep } from './practiceLogic'
export { COUNTS, PAD, repeatPlan, type Count, type Rep } from './practiceLogic'

/** Movie Mode's player (VLC/mpv through the app's backend). Time is interpolated between status updates. */
export function createMoviePlayer(): PracticePlayer {
  let anchor = { t: null as number | null, at: 0, paused: true }
  let rate = 1
  let ignoreUntil = 0
  useMovie.subscribe((s, prev) => {
    if (s.status === prev.status || performance.now() < ignoreUntil) return
    anchor = { t: s.status.timePos, at: performance.now(), paused: s.status.paused }
  })
  return {
    play: async () => {
      await invoke('player:control', { action: 'play' })
      anchor = { ...anchor, t: timeNow(), at: performance.now(), paused: false }
    },
    pause: async () => {
      await invoke('player:control', { action: 'pause' })
      anchor = { ...anchor, t: timeNow(), at: performance.now(), paused: true }
    },
    seek: async (seconds) => {
      await invoke('player:control', { action: 'seek', seconds })
      // Status updates from before the seek may still arrive; ignore them briefly.
      ignoreUntil = performance.now() + 350
      anchor = { ...anchor, t: seconds, at: performance.now() }
    },
    setRate: async (r) => {
      await invoke('player:control', { action: 'rate', rate: r })
      anchor = { ...anchor, t: timeNow(), at: performance.now() }
      rate = r
    },
    currentTime: () => timeNow()
  }
  function timeNow(): number | null {
    if (anchor.t == null) return null
    return anchor.paused ? anchor.t : anchor.t + ((performance.now() - anchor.at) / 1000) * rate
  }
}


/**
 * Plays [start-PAD, end+PAD] once at the given speed and resolves when it has finished
 * (or was cancelled). Checks the time every 50 ms; a timeout guards against a stuck player.
 */
export async function playSegment(player: PracticePlayer, line: SubtitleLine, rate: number, cancelled: () => boolean): Promise<void> {
  const start = Math.max(0, (line.start ?? 0) - PAD)
  const end = (line.end ?? (line.start ?? 0) + 3) + PAD
  await player.setRate(rate)
  await player.seek(start)
  await player.play()
  const deadline = performance.now() + (((end - start) / rate) * 1.6 + 2) * 1000
  await new Promise<void>((resolve) => {
    const timer = setInterval(() => {
      const t = player.currentTime()
      if (cancelled() || (t != null && t >= end) || performance.now() > deadline) {
        clearInterval(timer)
        resolve()
      }
    }, 50)
  })
}

interface RepeatState {
  lineId: string
  index: number
  total: number
  rep: Rep
}

interface Prefs {
  repeat: Count
  /** Speak reps, 1–14. */
  speak: number
  smart: boolean
  quiet: boolean
  autoAdvance: boolean
}

const prefs = (): Prefs => {
  const base: Prefs = { repeat: 5, speak: 5, smart: true, quiet: false, autoAdvance: false }
  try {
    return { ...base, ...JSON.parse(localStorage.getItem('elc.practice.v1') ?? '{}') }
  } catch {
    return base
  }
}

/** Which page opened the Speak panel (each page shows only its own). */
export type SpeakHost = 'movie' | 'youtube' | 'room'

interface PracticeStore {
  repeatCount: Count
  speakCount: number
  smart: boolean
  quiet: boolean
  autoAdvance: boolean
  repeat: RepeatState | null
  speakLine: SubtitleLine | null
  speakHost: SpeakHost | null
  setRepeatCount: (c: Count) => void
  setSpeakCount: (n: number) => void
  setSmart: (v: boolean) => void
  setQuiet: (v: boolean) => void
  setAutoAdvance: (v: boolean) => void
  setRepeat: (r: RepeatState | null) => void
  openSpeak: (line: SubtitleLine | null, host?: SpeakHost) => void
}

export const usePractice = create<PracticeStore>((set, get) => {
  const save = (): void => {
    try {
      const { repeatCount, speakCount, smart, quiet, autoAdvance } = get()
      localStorage.setItem('elc.practice.v1', JSON.stringify({ repeat: repeatCount, speak: speakCount, smart, quiet, autoAdvance }))
    } catch {
      // storage unavailable: keep for this session
    }
  }
  const p = prefs()
  const remember = (patch: Partial<PracticeStore>): void => {
    set(patch)
    save()
  }
  return {
    repeatCount: p.repeat,
    speakCount: Math.min(14, Math.max(1, Number(p.speak) || 5)),
    smart: p.smart,
    quiet: p.quiet,
    autoAdvance: p.autoAdvance,
    repeat: null,
    speakLine: null,
    speakHost: null,
    setRepeatCount: (repeatCount) => remember({ repeatCount }),
    setSpeakCount: (n) => remember({ speakCount: Math.min(14, Math.max(1, Math.round(n))) }),
    setSmart: (smart) => remember({ smart }),
    setQuiet: (quiet) => remember({ quiet }),
    setAutoAdvance: (autoAdvance) => remember({ autoAdvance }),
    setRepeat: (repeat) => set({ repeat }),
    openSpeak: (speakLine, host) => set({ speakLine, speakHost: speakLine ? (host ?? get().speakHost ?? 'movie') : null })
  }
})

/** Practice actions offered on subtitle lines (provided by Movie Mode, YouTube and the Practice Room). */
export interface PracticeActions {
  host: SpeakHost
  player: PracticePlayer
  /** True when this line's original clip can be played here (same movie/video loaded). */
  canPlay: (line: SubtitleLine) => boolean
  startRepeat: (line: SubtitleLine) => void
  stopRepeat: () => void
  skipRep: () => void
}
export const PracticeContext = createContext<PracticeActions | null>(null)

let sharedMoviePlayer: PracticePlayer | null = null
/** One movie player for the whole app (Movie Mode and Practice Room). */
export function getMoviePlayer(): PracticePlayer {
  sharedMoviePlayer ??= createMoviePlayer()
  return sharedMoviePlayer
}

/** "AI voice": Windows' built-in English voice reads the text; resolves when it has finished. */
export async function playAiVoice(text: string): Promise<void> {
  const b64 = await invoke('practice:voice', text)
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
  const url = URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' }))
  try {
    await new Promise<void>((resolve) => {
      const a = new Audio(url)
      a.onended = () => resolve()
      a.onerror = () => resolve()
      void a.play().catch(() => resolve())
    })
  } finally {
    URL.revokeObjectURL(url)
  }
}

export function recordFor(line: SubtitleLine, extra: { listenReps?: number; speakReps?: number; rating?: 'Easy' | 'OK' | 'Hard' }): void {
  void invoke('practice:record', {
    lineKey: line.id,
    mediaPath: line.mediaPath || null,
    mediaTitle: line.mediaTitle || null,
    start: line.start,
    end: line.end,
    text: line.text,
    ...extra
  }).catch(() => undefined)
}
