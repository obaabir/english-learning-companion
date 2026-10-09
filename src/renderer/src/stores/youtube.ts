import { create } from 'zustand'
import type { YouTubeVideo } from '@shared/types'
import { createStudyStore } from './movie'

/** YouTube's own study list (transcript lines, selection, explanations), separate from Movie Mode. */
export const youtubeStudy = createStudyStore()

interface YouTubeState {
  video: YouTubeVideo | null
  /** Open this video at this time (e.g. from a note's timestamp). */
  pendingOpen: { url: string; seconds: number } | null
  setVideo: (v: YouTubeVideo | null) => void
  openAt: (url: string, seconds: number) => void
  takePendingOpen: () => { url: string; seconds: number } | null
}

export const useYouTube = create<YouTubeState>((set, get) => ({
  video: null,
  pendingOpen: null,
  setVideo: (video) => set({ video }),
  openAt: (url, seconds) => set({ pendingOpen: { url, seconds } }),
  takePendingOpen: () => {
    const p = get().pendingOpen
    set({ pendingOpen: null })
    return p
  }
}))
