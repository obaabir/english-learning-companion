import { createContext, useContext } from 'react'
import { create, useStore } from 'zustand'
import type { PlayerStatus, NoteKind, SubtitleLine } from '@shared/types'

const MAX_LINES = 3000

export interface Explanation {
  text: string
  status: 'streaming' | 'done' | 'error'
  error?: string
  promptId: number | null
}

/** What the learner is currently studying: a subtitle line, part of it, or text picked elsewhere. */
export interface StudySelection {
  key: string
  text: string
  sentence: string | null
  line: SubtitleLine | null
  suggestedKind: NoteKind
}

export interface MovieState {
  status: PlayerStatus
  lines: SubtitleLine[]
  /** File path of the movie the current subtitle list belongs to. */
  feedMedia: string | null
  lastArrivedId: string | null
  followLive: boolean

  selectedLineId: string | null
  wordRange: [number, number] | null
  custom: { text: string; kind: NoteKind } | null

  explanations: Record<string, Explanation>
  savedNotes: Record<string, number>

  setStatus: (s: PlayerStatus) => void
  addLine: (l: SubtitleLine) => void
  clearLines: () => void
  setFollowLive: (v: boolean) => void
  selectLine: (id: string | null) => void
  setWordRange: (r: [number, number] | null) => void
  setCustom: (c: { text: string; kind: NoteKind } | null) => void
  setExplanation: (key: string, e: Explanation) => void
  appendExplanation: (key: string, delta: string) => void
  markSaved: (selectionKey: string, noteId: number) => void
}

export const EMPTY_STATUS: PlayerStatus = {
  running: false,
  connected: false,
  mediaPath: null,
  mediaTitle: null,
  timePos: null,
  paused: false,
  subtitles: { kind: 'idle' }
}

/** Splits a line into word tokens, keeping punctuation attached for display. */
export function tokenize(text: string): string[] {
  return text.split(/\s+/).filter(Boolean)
}

/** Removes surrounding punctuation from a selected word/phrase. */
export function trimPunctuation(s: string): string {
  return s.replace(/^[^\p{L}\p{N}']+|[^\p{L}\p{N}']+$/gu, '')
}

/** State reset when the active movie changes. Saved notes and cached explanations are kept. */
function freshFeed(mediaPath: string): Partial<MovieState> {
  return { feedMedia: mediaPath, lines: [], lastArrivedId: null, selectedLineId: null, wordRange: null, followLive: true }
}

/** A subtitle/transcript study list with its selection. Movie Mode and YouTube each have their own. */
export function createStudyStore() {
  return create<MovieState>((set, get) => ({
  status: EMPTY_STATUS,
  lines: [],
  feedMedia: null,
  lastArrivedId: null,
  followLive: true,
  selectedLineId: null,
  wordRange: null,
  custom: null,
  explanations: {},
  savedNotes: {},

  setStatus: (status) => {
    // A different movie was opened (even after the player was closed in between):
    // start a fresh subtitle list. The list is kept when the player just closes,
    // so you can keep studying the lines you already have.
    if (status.mediaPath && status.mediaPath !== get().feedMedia) {
      set({ status, ...freshFeed(status.mediaPath) })
    } else {
      set({ status })
    }
  },

  addLine: (line) => {
    // Ignore late lines from a movie that is no longer the active one.
    const active = get().status.mediaPath ?? get().feedMedia
    if (active && line.mediaPath !== active) return
    if (line.mediaPath !== get().feedMedia) set(freshFeed(line.mediaPath))
    const { lines } = get()
    if (lines.some((l) => l.id === line.id)) {
      set({ lastArrivedId: line.id })
      return
    }
    const next = [...lines]
    if (line.start == null) {
      next.push(line)
    } else {
      let i = next.length
      while (i > 0 && (next[i - 1].start ?? -Infinity) > line.start) i--
      next.splice(i, 0, line)
    }
    set({ lines: next.length > MAX_LINES ? next.slice(-MAX_LINES) : next, lastArrivedId: line.id })
  },

  clearLines: () => set({ lines: [], lastArrivedId: null, selectedLineId: null, wordRange: null }),
  setFollowLive: (followLive) => set({ followLive }),
  selectLine: (selectedLineId) => set({ selectedLineId, wordRange: null, custom: null }),
  setWordRange: (wordRange) => set({ wordRange, custom: null }),
  setCustom: (custom) => set({ custom }),

  setExplanation: (key, e) => set({ explanations: { ...get().explanations, [key]: e } }),
  appendExplanation: (key, delta) => {
    const cur = get().explanations[key]
    if (!cur) return
    set({ explanations: { ...get().explanations, [key]: { ...cur, text: cur.text + delta } } })
  },
  markSaved: (selectionKey, noteId) => set({ savedNotes: { ...get().savedNotes, [selectionKey]: noteId } })
}))
}

export type StudyStore = ReturnType<typeof createStudyStore>

/** Movie Mode's study list (the default for shared components). */
export const useMovie = createStudyStore()

/** Which study list the shared subtitle rows / Explanation panel use. Defaults to Movie Mode. */
export const StudyStoreContext = createContext<StudyStore>(useMovie)

export function useStudyStore(): StudyStore {
  return useContext(StudyStoreContext)
}

export function useStudy<T>(selector: (s: MovieState) => T): T {
  return useStore(useStudyStore(), selector)
}

/** How "jump to this moment" works for the current list (Movie Mode: VLC/mpv). */
export interface StudyActions {
  seek: (line: SubtitleLine) => Promise<void>
}

export function getSelection(s: Pick<MovieState, 'lines' | 'selectedLineId' | 'wordRange' | 'custom'>): StudySelection | null {
  if (s.custom) {
    return { key: `custom:${s.custom.text}`, text: s.custom.text, sentence: null, line: null, suggestedKind: s.custom.kind }
  }
  const line = s.lines.find((l) => l.id === s.selectedLineId)
  if (!line) return null
  if (s.wordRange) {
    const [a, b] = s.wordRange
    const words = tokenize(line.text).slice(Math.min(a, b), Math.max(a, b) + 1)
    const text = trimPunctuation(words.join(' '))
    if (text) {
      return {
        key: `${line.id}|${Math.min(a, b)}-${Math.max(a, b)}`,
        text,
        sentence: line.text,
        line,
        suggestedKind: words.length === 1 ? 'word' : 'phrase'
      }
    }
  }
  return { key: line.id, text: line.text, sentence: line.text, line, suggestedKind: 'sentence' }
}

/** Neighbouring subtitle lines, used as context for Gemini. */
export function contextLines(lines: SubtitleLine[], line: SubtitleLine | null, n = 2): { before: string[]; after: string[] } {
  if (!line) return { before: [], after: [] }
  const i = lines.findIndex((l) => l.id === line.id)
  if (i < 0) return { before: [], after: [] }
  return {
    before: lines.slice(Math.max(0, i - n), i).map((l) => l.text),
    after: lines.slice(i + 1, i + 1 + n).map((l) => l.text)
  }
}
