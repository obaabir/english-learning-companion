import type { CalendarDay, PracticeRating, ShadowLine, StreakState } from '@shared/types'

/** Review rungs in days after shadowing: 3 → 7 → 14 → 30, then mastered. */
export const RUNGS = [3, 7, 14, 30]
export const SHIELDS_PER_MONTH = 2
export const DEFAULT_DAILY_CAP = 15

/** Local calendar date as YYYY-MM-DD. */
export function localDay(d = new Date()): string {
  return d.toLocaleDateString('en-CA')
}

export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number)
  return localDay(new Date(y, m - 1, d + n))
}

export function daysBetween(a: string, b: string): number {
  const [y1, m1, d1] = a.split('-').map(Number)
  const [y2, m2, d2] = b.split('-').map(Number)
  return Math.round((new Date(y2, m2 - 1, d2).getTime() - new Date(y1, m1 - 1, d1).getTime()) / 86400000)
}

/** A line reached its final rep: start (or restart) its review schedule. */
export function onShadowed(
  rec: ShadowLine | null,
  line: Pick<ShadowLine, 'id' | 'text' | 'mediaPath' | 'mediaTitle' | 'start' | 'end'>,
  reps: number,
  today: string
): ShadowLine {
  const base: ShadowLine = rec ?? {
    ...line,
    dateShadowed: today,
    reps: 0,
    rung: 0,
    nextDue: null,
    status: 'new',
    ratings: [],
    shadowDays: []
  }
  const restart = base.status === 'new' || base.status === 'mastered'
  return {
    ...base,
    reps: base.reps + reps,
    shadowDays: base.shadowDays.includes(today) ? base.shadowDays : [...base.shadowDays, today],
    ...(restart ? { rung: 0, nextDue: addDays(today, RUNGS[0]), status: base.status === 'new' ? 'new' : 'learning' } : {})
  }
}

/** A review was rated: Easy/OK climb a rung, Hard goes back to the 3-day rung. */
export function onReviewed(rec: ShadowLine, rating: PracticeRating, today: string): ShadowLine {
  const ratings = [...rec.ratings, { date: today, rating }]
  if (rating === 'Hard') return { ...rec, ratings, rung: 0, nextDue: addDays(today, RUNGS[0]), status: 'learning' }
  const rung = rec.rung + 1
  if (rung >= RUNGS.length) return { ...rec, ratings, rung, nextDue: null, status: 'mastered' }
  return { ...rec, ratings, rung, nextDue: addDays(today, RUNGS[rung]), status: 'learning' }
}

/** Lines due today, oldest first, capped. The rest roll over to later days (no scary total). */
export function todayQueue(records: ShadowLine[], today: string, cap: number): ShadowLine[] {
  return records
    .filter((r) => r.status !== 'mastered' && r.nextDue != null && r.nextDue <= today)
    .sort((a, b) => (a.nextDue! < b.nextDue! ? -1 : a.nextDue! > b.nextDue! ? 1 : a.dateShadowed < b.dateShadowed ? -1 : 1))
    .slice(0, Math.max(1, cap))
}

/**
 * Brings the streak up to date (call on open). Each missed day uses one of the month's
 * 2 shields; with no shield left the streak restarts. Today counts once it has activity.
 */
export function updateStreak(state: StreakState, activeDays: Set<string>, today: string): StreakState {
  const s: StreakState = { ...state, shieldsUsed: { ...state.shieldsUsed }, shieldDays: [...(state.shieldDays ?? [])] }
  if (!s.lastCheckedDay) {
    s.lastCheckedDay = addDays(today, -1)
    return s
  }
  const yesterday = addDays(today, -1)
  for (let d = addDays(s.lastCheckedDay, 1); d <= yesterday; d = addDays(d, 1)) {
    const month = d.slice(0, 7)
    if (activeDays.has(d)) s.streak += 1
    else if ((s.shieldsUsed[month] ?? 0) < SHIELDS_PER_MONTH && s.streak > 0) {
      s.shieldsUsed[month] = (s.shieldsUsed[month] ?? 0) + 1
      s.shieldDays.push(d)
    } else s.streak = 0
  }
  if (s.lastCheckedDay < yesterday) s.lastCheckedDay = yesterday
  return s
}

/** Streak to show today: the counted days plus today if you practised today. */
export function streakToday(state: StreakState, activeDays: Set<string>, today: string): number {
  return state.streak + (activeDays.has(today) ? 1 : 0)
}

export function shieldsLeft(state: StreakState, today: string): number {
  return Math.max(0, SHIELDS_PER_MONTH - (state.shieldsUsed[today.slice(0, 7)] ?? 0))
}

export function lineStatus(rec: ShadowLine): 'New' | 'Learning' | 'Mastered' {
  if (rec.status === 'mastered') return 'Mastered'
  return rec.ratings.length === 0 ? 'New' : 'Learning'
}

/**
 * Calendar cells for a month: a dot (none / shadowed / due / done) and how many lines were
 * first shadowed that day. "Due" days are past/today days with reviews still waiting.
 */
export function calendarMonth(
  records: ShadowLine[],
  activity: Map<string, { shadowed: number; reviewed: number }>,
  year: number,
  month: number,
  today: string
): CalendarDay[] {
  const days: CalendarDay[] = []
  const count = new Date(year, month, 0).getDate()
  for (let d = 1; d <= count; d++) {
    const date = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    const learned = records.filter((r) => r.dateShadowed === date).length
    const act = activity.get(date)
    const dueThatDay = records.filter((r) => r.nextDue === date && r.status !== 'mastered').length
    let dot: CalendarDay['dot'] = 'none'
    if (date <= today && dueThatDay > 0) dot = 'due'
    else if (act && act.reviewed > 0) dot = 'done'
    else if (act && act.shadowed > 0) dot = 'shadowed'
    else if (date > today && dueThatDay > 0) dot = 'upcoming'
    days.push({ date, dot, learned, due: dueThatDay })
  }
  return days
}
