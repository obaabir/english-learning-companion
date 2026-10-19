import type { ReviewRating } from '@shared/types'

/**
 * A simple, predictable revision schedule.
 *
 * A new item is reviewed on Day 1 (the day it is saved), then Day 3, then Day 7 — the default
 * ladder. After that each "Good" roughly doubles the gap. The rating adjusts it:
 *  - Again: back to the start, due again in 10 minutes, and its future gaps grow more slowly.
 *  - Difficult: a short gap (no step forward), future gaps a little shorter.
 *  - Good: next step of the ladder (or double the gap).
 *  - Easy: a longer jump, future gaps a little longer.
 * Items you keep forgetting therefore come back sooner; items you keep remembering spread out.
 */
export interface RevisionState {
  /** Successful steps on the ladder (0 = new). */
  step: number
  intervalDays: number
  /** Growth factor for gaps after Day 7 (1 = normal; lower after forgetting, higher after Easy). */
  ease: number
  reps: number
  lapses: number
  due: string
  lastReviewedAt: string | null
  lastRating: ReviewRating | null
}

/** Gaps (days) after a successful review at step 0 and step 1: Day 1 → Day 3 → Day 7. */
export const LADDER_GAPS = [2, 4]
export const MASTERED_DAYS = 21
export const FORGOTTEN_LAPSES = 2
const MIN_EASE = 0.6
const MAX_EASE = 1.6
const MAX_DAYS = 365
const DAY = 86_400_000

export function newRevision(now = new Date()): RevisionState {
  return { step: 0, intervalDays: 0, ease: 1, reps: 0, lapses: 0, due: now.toISOString(), lastReviewedAt: null, lastRating: null }
}

/** The gap after a "Good" review at this state. */
function goodGap(s: RevisionState): number {
  if (s.step < LADDER_GAPS.length) return LADDER_GAPS[s.step]
  return Math.round(Math.max(s.intervalDays, LADDER_GAPS.at(-1)!) * 2 * s.ease)
}

export function reviewRevision(s: RevisionState, rating: ReviewRating, now = new Date()): RevisionState {
  const next: RevisionState = { ...s, reps: s.reps + 1, lastReviewedAt: now.toISOString(), lastRating: rating }
  let dueMs: number
  if (rating === 1) {
    next.lapses = s.lapses + 1
    next.ease = Math.max(MIN_EASE, s.ease - 0.2)
    next.step = 0
    next.intervalDays = 0
    dueMs = now.getTime() + 10 * 60_000
  } else {
    if (rating === 2) {
      next.ease = Math.max(MIN_EASE, s.ease - 0.15)
      next.intervalDays = s.step === 0 || s.intervalDays < 1 ? 1 : Math.max(1, Math.round(s.intervalDays * 1.2))
    } else if (rating === 3) {
      next.intervalDays = goodGap(s)
      next.step = s.step + 1
    } else {
      next.ease = Math.min(MAX_EASE, s.ease + 0.15)
      next.intervalDays = Math.ceil(goodGap(s) * 1.5)
      next.step = s.step + 2
    }
    next.intervalDays = Math.min(MAX_DAYS, next.intervalDays)
    dueMs = now.getTime() + next.intervalDays * DAY
  }
  next.due = new Date(dueMs).toISOString()
  return next
}

export function isMastered(s: Pick<RevisionState, 'intervalDays' | 'lastRating'>): boolean {
  return s.intervalDays >= MASTERED_DAYS && (s.lastRating ?? 0) >= 3
}

export function isFrequentlyForgotten(s: Pick<RevisionState, 'lapses'>): boolean {
  return s.lapses >= FORGOTTEN_LAPSES
}

/** The end of the local calendar day (items due any time today count as "due today"). */
export function endOfDay(now = new Date()): Date {
  const d = new Date(now)
  d.setHours(23, 59, 59, 999)
  return d
}

export function startOfDay(now = new Date()): Date {
  const d = new Date(now)
  d.setHours(0, 0, 0, 0)
  return d
}
