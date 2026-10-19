/**
 * Vocabulary Book revision schedule (separate from the regular Day 1 → 3 → 7 schedule).
 *
 * The day a word is learned is its learning day. Reviews follow on Day 1, Day 4 and Day 7 after it
 * (counted from the item's own learning day, not calendar dates). After that a remembered word's
 * gap roughly doubles. Your recall rating adjusts it:
 *  - Again (forgot): back to the start, seen again in 10 minutes, future gaps grow more slowly.
 *  - Hard: tomorrow again (no step forward).
 *  - Good: the next step (Day 1 → Day 4 → Day 7 → …).
 *  - Easy: skips a step, future gaps a little longer.
 */
export interface VbScheduleState {
  step: number
  intervalDays: number
  ease: number
  reps: number
  lapses: number
  due: string | null
  introducedAt: string | null
  lastReviewedAt: string | null
  lastRating: number | null
}

/** Days after the learning day for the first three reviews. */
export const VB_LADDER = [1, 4, 7]
const DAY = 86_400_000
const MIN_EASE = 0.6
const MAX_EASE = 1.6
const MAX_DAYS = 365

/** Learned today: the first review is Day 1 (tomorrow). */
export function introduce(s: VbScheduleState, now = new Date()): VbScheduleState {
  return { ...s, introducedAt: now.toISOString(), step: 0, intervalDays: VB_LADDER[0], due: new Date(now.getTime() + VB_LADDER[0] * DAY).toISOString() }
}

/** The due date of ladder step `step`, counted from the learning day (never earlier than tomorrow). */
function ladderDue(s: VbScheduleState, step: number, now: Date): { due: Date; gap: number } {
  const learned = s.introducedAt ? new Date(s.introducedAt).getTime() : now.getTime()
  const target = learned + VB_LADDER[step] * DAY
  const due = Math.max(target, now.getTime() + DAY)
  return { due: new Date(due), gap: Math.round((due - now.getTime()) / DAY) }
}

export function reviewVb(s: VbScheduleState, rating: 1 | 2 | 3 | 4, now = new Date()): VbScheduleState {
  const next: VbScheduleState = { ...s, reps: s.reps + 1, lastReviewedAt: now.toISOString(), lastRating: rating }
  if (rating === 1) {
    next.lapses = s.lapses + 1
    next.ease = Math.max(MIN_EASE, s.ease - 0.2)
    next.step = 0
    next.intervalDays = 0
    next.due = new Date(now.getTime() + 10 * 60_000).toISOString()
    return next
  }
  if (rating === 2) {
    next.ease = Math.max(MIN_EASE, s.ease - 0.15)
    next.intervalDays = 1
    next.due = new Date(now.getTime() + DAY).toISOString()
    return next
  }
  const step = s.step + (rating === 4 ? 2 : 1)
  if (rating === 4) next.ease = Math.min(MAX_EASE, s.ease + 0.15)
  next.step = step
  if (step < VB_LADDER.length) {
    // Day 4, Day 7: from the learning day.
    const { due, gap } = ladderDue(s, step, now)
    next.intervalDays = Math.max(1, gap)
    next.due = due.toISOString()
  } else {
    // After Day 7: 2 weeks, then about a month, … (shorter for words you found hard before).
    const base = Math.max(s.intervalDays, VB_LADDER.at(-1)!)
    next.intervalDays = Math.min(MAX_DAYS, Math.round(base * 2 * next.ease * (rating === 4 ? 1.5 : 1)))
    next.due = new Date(now.getTime() + next.intervalDays * DAY).toISOString()
  }
  return next
}
