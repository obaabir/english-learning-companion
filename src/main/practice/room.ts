import type { CalendarDay, PracticeRating, RemixSet, RoomHome, ShadowLine } from '@shared/types'
import type { Db } from '../db'
import type { GeminiService } from '../ai/gemini'
import {
  activityMap,
  addActivity,
  allShadowLines,
  getDailyCap,
  getRemix,
  getShadowLine,
  getStreak,
  linesShadowedOn,
  saveRemix,
  saveShadowLine,
  saveStreak
} from '../db/repos/room'
import { calendarMonth, daysBetween, localDay, onReviewed, onShadowed, shieldsLeft, streakToday, todayQueue, updateStreak } from './schedule'

type LineInput = Pick<ShadowLine, 'id' | 'text' | 'mediaPath' | 'mediaTitle' | 'start' | 'end'>

/** Practice Room: shadowed lines, spaced reviews, streak, calendar and remix. */
export class PracticeRoom {
  constructor(
    private readonly db: Db,
    private readonly gemini: GeminiService,
    private readonly today: () => string = () => localDay()
  ) {}

  shadowed(line: LineInput, reps: number): ShadowLine {
    const today = this.today()
    const rec = onShadowed(getShadowLine(this.db, line.id), line, reps, today)
    saveShadowLine(this.db, rec)
    addActivity(this.db, today, 'shadowed')
    return rec
  }

  review(id: string, rating: PracticeRating): ShadowLine {
    const rec = getShadowLine(this.db, id)
    if (!rec) throw new Error('That line is no longer in your Practice Room.')
    const today = this.today()
    const next = onReviewed(rec, rating, today)
    saveShadowLine(this.db, next)
    addActivity(this.db, today, 'reviewed')
    return next
  }

  home(): RoomHome {
    const today = this.today()
    const activity = activityMap(this.db)
    const active = new Set([...activity.keys()])
    const streak = updateStreak(getStreak(this.db), active, today)
    saveStreak(this.db, streak)
    const lines = allShadowLines(this.db)
    const first = lines.reduce<string | null>((min, l) => (!min || l.dateShadowed < min ? l.dateShadowed : min), null)
    const cap = getDailyCap(this.db)
    // The cap is per day: reviews already done today use it up.
    const reviewedToday = lines.filter((l) => l.ratings.some((r) => r.date === today)).length
    return {
      today,
      dayNumber: first ? daysBetween(first, today) + 1 : 1,
      streak: streakToday(streak, active, today),
      shieldsLeft: shieldsLeft(streak, today),
      shadowedToday: lines.filter((l) => l.shadowDays.includes(today)).length,
      practisedToday: active.has(today),
      queue: todayQueue(lines, today, Math.max(0, cap - reviewedToday)),
      dailyCap: cap,
      totalLines: lines.length
    }
  }

  calendar(year: number, month: number): CalendarDay[] {
    return calendarMonth(allShadowLines(this.db), activityMap(this.db), year, month, this.today())
  }

  day(date: string): ShadowLine[] {
    return linesShadowedOn(this.db, date)
  }

  /** Remix for a day: cached once made (so it costs nothing to reopen). */
  async remix(date: string, refresh = false): Promise<RemixSet> {
    const cached = getRemix(this.db, date)
    if (cached && !refresh) return cached
    const lines = this.day(date).map((l) => l.text)
    if (!lines.length) throw new Error('No lines were shadowed on this day.')
    if (!this.gemini.configured) throw new Error('Add your Gemini API key in Settings to use Remix.')
    const r = await this.gemini.remix(lines)
    const set: RemixSet = { date, phrases: (r.phrases ?? []).slice(0, 5), sentences: (r.sentences ?? []).slice(0, 3) }
    saveRemix(this.db, set)
    return set
  }
}
