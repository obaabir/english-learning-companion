import { create } from 'zustand'
import type { AppSettings, Prompt } from '@shared/types'
import { errorMessage, invoke } from '@renderer/lib/api'

export type Page = 'movie' | 'youtube' | 'notes' | 'structures' | 'flashcards' | 'games' | 'ielts' | 'errors' | 'prompts' | 'settings'

export interface Toast {
  id: number
  kind: 'success' | 'error' | 'info'
  text: string
  /** Set while the exit animation plays. */
  leaving?: boolean
}

interface AppState {
  page: Page
  setPage: (p: Page) => void

  settings: AppSettings | null
  setSettings: (s: AppSettings) => void
  loadSettings: () => Promise<void>

  prompts: Prompt[]
  activePromptId: number | null
  loadPrompts: () => Promise<void>
  setActivePromptId: (id: number) => void

  dueCount: number
  refreshDue: () => Promise<void>

  toasts: Toast[]
  toast: (kind: Toast['kind'], text: string) => void
  toastError: (err: unknown) => void
  dismissToast: (id: number) => void
}

let toastSeq = 0

export const useApp = create<AppState>((set, get) => ({
  page: 'movie',
  setPage: (page) => set({ page }),

  settings: null,
  setSettings: (settings) => set({ settings }),
  loadSettings: async () => set({ settings: await invoke('settings:get') }),

  prompts: [],
  activePromptId: null,
  loadPrompts: async () => {
    const prompts = await invoke('prompts:list')
    const current = get().activePromptId
    const stillExists = prompts.some((p) => p.id === current)
    set({
      prompts,
      activePromptId: stillExists ? current : (prompts.find((p) => p.isDefault) ?? prompts[0])?.id ?? null
    })
  },
  setActivePromptId: (activePromptId) => set({ activePromptId }),

  dueCount: 0,
  refreshDue: async () => {
    try {
      set({ dueCount: (await invoke('flashcards:stats')).due })
    } catch {
      // non-critical
    }
  },

  toasts: [],
  toast: (kind, text) => {
    const id = ++toastSeq
    set({ toasts: [...get().toasts, { id, kind, text }] })
    setTimeout(() => get().dismissToast(id), kind === 'error' ? 7000 : 3500)
  },
  toastError: (err) => get().toast('error', errorMessage(err)),
  // Play the exit animation first, then remove.
  dismissToast: (id) => {
    const t = get().toasts.find((x) => x.id === id)
    if (!t || t.leaving) return
    set({ toasts: get().toasts.map((x) => (x.id === id ? { ...x, leaving: true } : x)) })
    setTimeout(() => set({ toasts: get().toasts.filter((x) => x.id !== id) }), 180)
  }
}))
