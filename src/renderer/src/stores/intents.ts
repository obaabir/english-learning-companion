import { create } from 'zustand'
import type { GameMode } from '@shared/games'

/**
 * Requests to open a section in a particular state (used by voice commands): e.g. Flashcards on the
 * review, or Games on a given game. The section takes the request when it opens.
 */
interface IntentsState {
  flashcardsMode: 'dashboard' | 'review' | null
  gameMode: GameMode | null
  request: (r: Partial<Pick<IntentsState, 'flashcardsMode' | 'gameMode'>>) => void
  takeFlashcardsMode: () => 'dashboard' | 'review' | null
  takeGameMode: () => GameMode | null
}

export const useIntents = create<IntentsState>((set, get) => ({
  flashcardsMode: null,
  gameMode: null,
  request: (r) => set(r),
  takeFlashcardsMode: () => {
    const m = get().flashcardsMode
    if (m) set({ flashcardsMode: null })
    return m
  },
  takeGameMode: () => {
    const m = get().gameMode
    if (m) set({ gameMode: null })
    return m
  }
}))
