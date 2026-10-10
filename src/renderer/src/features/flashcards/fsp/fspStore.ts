// Flash Sentence Practice: state, saved in browser storage under three "fsp:" keys.
import { create } from 'zustand'
import type { FspErrorType, FspLesson } from '@shared/fsp'
import type { FspCard, FspCardState, FspErrorLog } from './fspLogic'

const KEY_CARDS = 'fsp:cards'
const KEY_BANK = 'fsp:bank'
const KEY_STATS = 'fsp:stats'

export interface FspBankEntry {
  sentence: string
  date: string
}

export interface FspStats {
  /** 'auto' or a fixed level 1–5. */
  levelMode: 'auto' | number
  autoLevel: number
  /** Correct sentences in a row (for Auto). */
  streak: number
  contextNudge: boolean
  states: Record<string, FspCardState>
  errors: FspErrorLog[]
  lessons: Partial<Record<FspErrorType, { date: string; lesson: FspLesson }>>
}

const DEFAULT_STATS: FspStats = { levelMode: 'auto', autoLevel: 1, streak: 0, contextNudge: false, states: {}, errors: [], lessons: {} }

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // storage unavailable or full: keep working for this session
  }
}

interface FspStore {
  cards: FspCard[]
  bank: Record<string, FspBankEntry[]>
  stats: FspStats
  setCards: (cards: FspCard[]) => void
  updateCard: (id: string, patch: Partial<FspCard>) => void
  addToBank: (id: string, entry: FspBankEntry) => void
  setStats: (patch: Partial<FspStats> | ((s: FspStats) => Partial<FspStats>)) => void
}

export const useFsp = create<FspStore>((set, get) => ({
  cards: read<FspCard[]>(KEY_CARDS, []),
  bank: read<Record<string, FspBankEntry[]>>(KEY_BANK, {}),
  stats: { ...DEFAULT_STATS, ...read<Partial<FspStats>>(KEY_STATS, {}) },
  setCards: (cards) => {
    set({ cards })
    write(KEY_CARDS, cards)
  },
  updateCard: (id, patch) => {
    const cards = get().cards.map((c) => (c.id === id ? { ...c, ...patch } : c))
    set({ cards })
    write(KEY_CARDS, cards)
  },
  addToBank: (id, entry) => {
    const prev = get().bank[id] ?? []
    if (prev.some((e) => e.sentence === entry.sentence)) return
    const bank = { ...get().bank, [id]: [...prev, entry] }
    set({ bank })
    write(KEY_BANK, bank)
  },
  setStats: (patch) => {
    const cur = get().stats
    const stats = { ...cur, ...(typeof patch === 'function' ? patch(cur) : patch) }
    if (stats.errors.length > 500) stats.errors = stats.errors.slice(-500)
    set({ stats })
    write(KEY_STATS, stats)
  }
}))
