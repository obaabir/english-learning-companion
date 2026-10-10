import { describe, expect, it } from 'vitest'
import { addDays, calendarMonth, onReviewed, onShadowed, shieldsLeft, streakToday, todayQueue, updateStreak } from '../src/main/practice/schedule'
import { PracticeRoom } from '../src/main/practice/room'
import { openDatabase } from '../src/main/db'
import { setDailyCap } from '../src/main/db/repos/room'
import { ladder } from '../src/renderer/src/features/practice/practiceLogic'
import { windowsVoiceWav } from '../src/main/practice/voice'
import type { GeminiService } from '../src/main/ai/gemini'
import type { ShadowLine, StreakState } from '../src/shared/types'

const line = (id: string, text = `Line ${id}`) => ({ id, text, mediaPath: 'm.mkv', mediaTitle: 'Movie', start: 1, end: 3 })

describe('spaced schedule 3 → 7 → 14 → 30', () => {
  it('first review 3 days after shadowing; Easy/OK climb; Hard goes back to 3 days; mastered after 30', () => {
    let r = onShadowed(null, line('a'), 5, '2026-10-01')
    expect(r).toMatchObject({ nextDue: '2026-10-04', rung: 0, status: 'new', reps: 5 })
    r = onReviewed(r, 'OK', '2026-10-04')
    expect(r).toMatchObject({ nextDue: '2026-10-11', rung: 1, status: 'learning' })
    r = onReviewed(r, 'Easy', '2026-10-11')
    expect(r.nextDue).toBe('2026-10-25')
    r = onReviewed(r, 'Hard', '2026-10-25')
    expect(r).toMatchObject({ nextDue: '2026-10-28', rung: 0 })
    r = onReviewed(onReviewed(onReviewed(r, 'OK', '2026-10-28'), 'OK', '2026-11-04'), 'OK', '2026-11-18')
    expect(r).toMatchObject({ rung: 3, nextDue: '2026-12-18' })
    r = onReviewed(r, 'Easy', '2026-12-18')
    expect(r).toMatchObject({ status: 'mastered', nextDue: null })
  })

  it("re-shadowing a learning line doesn't reset it; re-shadowing a mastered one restarts it", () => {
    const learning = onReviewed(onShadowed(null, line('a'), 3, '2026-10-01'), 'OK', '2026-10-04')
    expect(onShadowed(learning, line('a'), 2, '2026-10-05')).toMatchObject({ nextDue: '2026-10-11', reps: 5 })
    const mastered: ShadowLine = { ...learning, status: 'mastered', nextDue: null, rung: 4 }
    expect(onShadowed(mastered, line('a'), 2, '2026-12-01')).toMatchObject({ status: 'learning', nextDue: '2026-12-04', rung: 0 })
  })

  it("caps today's queue, oldest first; the rest roll over (backlog protection)", () => {
    const recs = Array.from({ length: 40 }, (_, i) => ({ ...onShadowed(null, line(String(i)), 3, addDays('2026-09-01', i % 10)) }))
    const q = todayQueue(recs, '2026-10-20', 15)
    expect(q).toHaveLength(15)
    expect(q.every((r, i) => i === 0 || r.nextDue! >= q[i - 1].nextDue!)).toBe(true)
    expect(q[0].nextDue).toBe('2026-09-04')
  })
})

describe('streak with 2 shields per month', () => {
  const s0: StreakState = { streak: 0, lastCheckedDay: '2026-10-01', shieldsUsed: {}, shieldDays: [] }

  it('counts practised days, shields protect up to 2 missed days a month', () => {
    const active = new Set(['2026-10-02', '2026-10-03', '2026-10-05', '2026-10-07', '2026-10-08'])
    const s = updateStreak(s0, active, '2026-10-09')
    // 10-04 and 10-06 missed → both shielded; 5 practised days counted
    expect(s).toMatchObject({ streak: 5, shieldsUsed: { '2026-10': 2 } })
    expect(shieldsLeft(s, '2026-10-09')).toBe(0)
    expect(streakToday(s, new Set([...active, '2026-10-09']), '2026-10-09')).toBe(6)
  })

  it('returning after missing 5 days: shields cover 2, then the streak restarts gently', () => {
    const active = new Set(['2026-10-02', '2026-10-03'])
    const s = updateStreak(s0, active, '2026-10-09') // 10-04..10-08 missed
    expect(s.streak).toBe(0)
    expect(s.shieldsUsed['2026-10']).toBe(2)
  })
})

describe('Shadow Ladder', () => {
  it('14 reps → Listen 2 · Mumble 3 · Shadow 4 · No text 3 · Memory 2', () => {
    const l = ladder(14)
    const counts = l.reduce<Record<string, number>>((m, r) => ({ ...m, [r.stage]: (m[r.stage] ?? 0) + 1 }), {})
    expect(counts).toEqual({ listen: 2, mumble: 3, shadow: 4, noText: 3, memory: 2 })
    expect(l.map((r) => r.stage)).toEqual([...Array(2).fill('listen'), ...Array(3).fill('mumble'), ...Array(4).fill('shadow'), ...Array(3).fill('noText'), ...Array(2).fill('memory')])
  })

  it('small counts use fewer stages; 3+ always ends without text', () => {
    expect(ladder(1).map((r) => r.stage)).toEqual(['shadow'])
    expect(ladder(2).map((r) => r.stage)).toEqual(['listen', 'shadow'])
    for (let n = 3; n <= 14; n++) {
      const l = ladder(n)
      expect(l).toHaveLength(n)
      expect(l.at(-1)!.hideText).toBe(true)
    }
  })
})

describe('Practice Room service', () => {
  it('home card: Day N, lines shadowed today, capped queue, streak', () => {
    const db = openDatabase(':memory:')
    let today = '2026-10-01'
    const room = new PracticeRoom(db, { configured: false } as unknown as GeminiService, () => today)
    for (let i = 0; i < 20; i++) room.shadowed(line(String(i)), 5)
    let h = room.home()
    expect(h).toMatchObject({ dayNumber: 1, shadowedToday: 20, queue: [], practisedToday: true })
    today = '2026-10-04'
    setDailyCap(db, 15)
    h = room.home()
    expect(h.dayNumber).toBe(4)
    expect(h.queue).toHaveLength(15)
    room.review(h.queue[0].id, 'OK')
    expect(room.home().queue).toHaveLength(14) // 19 due, but 1 of today's 15 is used
    const cal = room.calendar(2026, 10)
    expect(cal.find((d) => d.date === '2026-10-01')).toMatchObject({ learned: 20 })
    expect(room.day('2026-10-01')).toHaveLength(20)
  })

  it('calendar dots: shadowed, due, all done', () => {
    const recs = [onShadowed(null, line('a'), 3, '2026-10-01')]
    const act = new Map([['2026-10-01', { shadowed: 1, reviewed: 0 }]])
    const cal = calendarMonth(recs, act, 2026, 10, '2026-10-05')
    expect(cal.find((d) => d.date === '2026-10-01')!.dot).toBe('shadowed')
    expect(cal.find((d) => d.date === '2026-10-04')!.dot).toBe('due')
  })
})

describe.skipIf(process.platform !== 'win32')('AI voice (Windows built-in, free)', () => {
  it('reads a line into a WAV', async () => {
    const b64 = await windowsVoiceWav('You should have told me earlier.')
    expect(Buffer.from(b64, 'base64').subarray(0, 4).toString()).toBe('RIFF')
  }, 30000)
})
