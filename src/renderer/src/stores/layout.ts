import { create } from 'zustand'

/** Open/closed state of the collapsible Movie Mode panels, remembered between sessions. */
interface LayoutState {
  chatOpen: boolean
  actionsOpen: boolean
  controlsOpen: boolean
  /** Height of the open chat as a share of the Explanation section (0.3–0.9). */
  chatHeight: number
  setChatHeight: (v: number) => void
  setChatOpen: (v: boolean) => void
  setActionsOpen: (v: boolean) => void
  setControlsOpen: (v: boolean) => void
}

const KEY = 'elc.layout.v1'

/** Open chat height limits, as a share of the Explanation section. The default matches the original size. */
export const CHAT_MIN = 0.3
export const CHAT_DEFAULT = 0.46
export const CHAT_MAX = 0.9

function load(): Partial<Pick<LayoutState, 'chatOpen' | 'actionsOpen' | 'controlsOpen' | 'chatHeight'>> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}')
  } catch {
    return {}
  }
}

export const useLayout = create<LayoutState>((set, get) => {
  const save = (): void => {
    try {
      const { chatOpen, actionsOpen, controlsOpen, chatHeight } = get()
      localStorage.setItem(KEY, JSON.stringify({ chatOpen, actionsOpen, controlsOpen, chatHeight }))
    } catch {
      // storage unavailable: keep the state for this session only
    }
  }
  return {
    chatOpen: false,
    actionsOpen: false,
    controlsOpen: true,
    chatHeight: CHAT_DEFAULT,
    ...load(),
    setChatOpen: (chatOpen) => {
      set({ chatOpen })
      save()
    },
    setActionsOpen: (actionsOpen) => {
      set({ actionsOpen })
      save()
    },
    setControlsOpen: (controlsOpen) => {
      set({ controlsOpen })
      save()
    },
    setChatHeight: (v) => {
      set({ chatHeight: Math.min(CHAT_MAX, Math.max(CHAT_MIN, v)) })
      save()
    }
  }
})

let restoreHeight = CHAT_DEFAULT

export function isChatExpanded(height: number): boolean {
  return height >= CHAT_MAX - 0.01
}

/** Expands the chat to about the explanation's height, or restores the size it had before. */
export function toggleChatExpanded(): void {
  const { chatHeight, setChatHeight, setChatOpen } = useLayout.getState()
  setChatOpen(true)
  if (isChatExpanded(chatHeight)) setChatHeight(restoreHeight)
  else {
    restoreHeight = chatHeight
    setChatHeight(CHAT_MAX)
  }
}
