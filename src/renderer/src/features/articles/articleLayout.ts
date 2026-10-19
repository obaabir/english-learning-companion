import { create } from 'zustand'

/**
 * Articles layout: whether the top toolbar and the side (study) panel are shown, and the side
 * panel's last width. Remembered between sessions (this computer only).
 */
interface ArticleLayoutState {
  toolbar: boolean
  side: boolean
  /** Side panel width (% of the Articles area) to restore when it is shown again. */
  sideSize: number
  setToolbar: (v: boolean) => void
  setSide: (v: boolean) => void
  setSideSize: (v: number) => void
}

const KEY = 'elc.articles.layout.v1'
export const DEFAULT_SIDE_SIZE = 42

function load(): Partial<Pick<ArticleLayoutState, 'toolbar' | 'side' | 'sideSize'>> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}')
  } catch {
    return {}
  }
}

export const useArticleLayout = create<ArticleLayoutState>((set, get) => {
  const save = (): void => {
    try {
      const { toolbar, side, sideSize } = get()
      localStorage.setItem(KEY, JSON.stringify({ toolbar, side, sideSize }))
    } catch {
      // storage unavailable: keep the layout for this session only
    }
  }
  return {
    toolbar: true,
    side: true,
    sideSize: DEFAULT_SIDE_SIZE,
    ...load(),
    setToolbar: (toolbar) => {
      set({ toolbar })
      save()
    },
    setSide: (side) => {
      set({ side })
      save()
    },
    setSideSize: (sideSize) => {
      if (sideSize < 5 || Math.abs(sideSize - get().sideSize) < 0.5) return
      set({ sideSize })
      save()
    }
  }
})
