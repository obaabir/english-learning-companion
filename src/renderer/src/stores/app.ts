import { create } from 'zustand'
import type { AppSettings, Prompt } from '@shared/types'
import { errorMessage, invoke } from '@renderer/lib/api'

export type Page =
  | 'movie'
  | 'youtube'
  | 'room'
  | 'articles'
  | 'world'
  | 'speaking' // Speaking Coach (added)
  | 'notes'
  | 'vocabulary'
  | 'idioms'
  | 'structures'
  | 'flashcards'
  | 'games'
  | 'vocabbook'
  | 'ielts'
  | 'errors'
  | 'prompts'
  | 'settings'

/** The main page: where the app opens, and where Home goes. */
export const HOME_PAGE: Page = 'movie'

/**
 * A page with unsaved work registers one of these while the work is unsaved. Leaving the page
 * (any navigation) then asks: save, discard, or keep editing.
 */
export interface LeaveGuard {
  /** What is unsaved, e.g. "this prompt". */
  what: string
  /** Saves the work; resolves false if saving failed (then the user stays). */
  save: () => Promise<boolean>
}

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
  /** Pages visited before this one (most recent last), for Back. */
  history: Page[]
  goBack: () => void
  goHome: () => void
  leaveGuard: LeaveGuard | null
  setLeaveGuard: (g: LeaveGuard | null) => void
  /** A navigation waiting for the user's answer about unsaved work. */
  pendingLeave: { to: Page; back: boolean } | null
  resolveLeave: (choice: 'save' | 'discard' | 'stay') => Promise<void>

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
  page: HOME_PAGE,
  setPage: (to) => {
    const { page, leaveGuard, history } = get()
    if (to === page) return
    if (leaveGuard) return set({ pendingLeave: { to, back: false } })
    set({ page: to, history: [...history, page].slice(-50) })
  },
  history: [],
  goBack: () => {
    const { page, history, leaveGuard } = get()
    // Nothing to go back to: Back goes Home.
    const to = history.length ? history[history.length - 1] : HOME_PAGE
    if (to === page) return
    if (leaveGuard) return set({ pendingLeave: { to, back: true } })
    set({ page: to, history: history.slice(0, -1) })
  },
  goHome: () => get().setPage(HOME_PAGE),
  leaveGuard: null,
  setLeaveGuard: (leaveGuard) => set({ leaveGuard }),
  pendingLeave: null,
  resolveLeave: async (choice) => {
    const { pendingLeave, leaveGuard } = get()
    if (!pendingLeave) return
    if (choice === 'stay') return set({ pendingLeave: null })
    if (choice === 'save' && leaveGuard && !(await leaveGuard.save())) return set({ pendingLeave: null })
    set({ leaveGuard: null, pendingLeave: null })
    if (pendingLeave.back) get().goBack()
    else get().setPage(pendingLeave.to)
  },

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
