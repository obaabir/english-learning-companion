import { create } from 'zustand'
import type { VbBook, VbMode } from '@shared/vocabBook'
import { invoke } from '@renderer/lib/api'

const KEY = 'elc.vocabbook.v1'
interface Saved {
  bookId: number | null
  modes: VbMode[]
}
function load(): Saved {
  try {
    return { bookId: null, modes: ['flashcard', 'mcq'], ...(JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Saved>) }
  } catch {
    return { bookId: null, modes: ['flashcard', 'mcq'] }
  }
}

interface VbState extends Saved {
  books: VbBook[]
  /** Bumped when words change (import, meanings filled in, answers) so open views reload. */
  version: number
  setBook: (id: number | null) => void
  setModes: (modes: VbMode[]) => void
  refreshBooks: () => Promise<VbBook[]>
  bump: () => void
}

const save = (s: Saved): void => {
  try {
    localStorage.setItem(KEY, JSON.stringify(s))
  } catch {
    // this session only
  }
}

export const useVb = create<VbState>((set, get) => ({
  ...load(),
  books: [],
  version: 0,
  setBook: (bookId) => {
    set({ bookId })
    save({ bookId, modes: get().modes })
  },
  setModes: (modes) => {
    set({ modes })
    save({ bookId: get().bookId, modes })
  },
  refreshBooks: async () => {
    const books = await invoke('vb:books')
    const cur = get().bookId
    set({ books, ...(cur === null || !books.some((b) => b.id === cur) ? { bookId: books[0]?.id ?? null } : {}) })
    return books
  },
  bump: () => set({ version: get().version + 1 })
}))
