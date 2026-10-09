import { create } from 'zustand'

/** Open/closed state of the collapsible Movie Mode panels, remembered between sessions. */
interface LayoutState {
  chatOpen: boolean
  actionsOpen: boolean
  controlsOpen: boolean
  setChatOpen: (v: boolean) => void
  setActionsOpen: (v: boolean) => void
  setControlsOpen: (v: boolean) => void
}

const KEY = 'elc.layout.v1'

function load(): Partial<Pick<LayoutState, 'chatOpen' | 'actionsOpen' | 'controlsOpen'>> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}')
  } catch {
    return {}
  }
}

export const useLayout = create<LayoutState>((set, get) => {
  const save = (): void => {
    try {
      const { chatOpen, actionsOpen, controlsOpen } = get()
      localStorage.setItem(KEY, JSON.stringify({ chatOpen, actionsOpen, controlsOpen }))
    } catch {
      // storage unavailable: keep the state for this session only
    }
  }
  return {
    chatOpen: false,
    actionsOpen: false,
    controlsOpen: true,
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
    }
  }
})
