import type { RemixSet, ShadowLine, StreakState } from '@shared/types'
import type { Db } from '../index'
import { getSetting, setSetting } from './settings'
import { DEFAULT_DAILY_CAP } from '../../practice/schedule'

export function getShadowLine(db: Db, id: string): ShadowLine | null {
  const r = db.prepare('SELECT json FROM shadow_lines WHERE id = ?').get(id) as { json: string } | undefined
  return r ? (JSON.parse(r.json) as ShadowLine) : null
}

export function saveShadowLine(db: Db, rec: ShadowLine): void {
  db.prepare(
    `INSERT INTO shadow_lines (id, json, next_due, date_shadowed) VALUES (?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET json = excluded.json, next_due = excluded.next_due`
  ).run(rec.id, JSON.stringify(rec), rec.nextDue, rec.dateShadowed)
}

export function allShadowLines(db: Db): ShadowLine[] {
  return (db.prepare('SELECT json FROM shadow_lines').all() as { json: string }[]).map((r) => JSON.parse(r.json) as ShadowLine)
}

export function linesShadowedOn(db: Db, day: string): ShadowLine[] {
  return allShadowLines(db).filter((r) => r.shadowDays.includes(day) || r.dateShadowed === day)
}

export function addActivity(db: Db, day: string, kind: 'shadowed' | 'reviewed'): void {
  db.prepare(
    `INSERT INTO practice_activity (day, ${kind}) VALUES (?, 1)
     ON CONFLICT(day) DO UPDATE SET ${kind} = ${kind} + 1`
  ).run(day)
}

export function activityMap(db: Db): Map<string, { shadowed: number; reviewed: number }> {
  const rows = db.prepare('SELECT day, shadowed, reviewed FROM practice_activity').all() as { day: string; shadowed: number; reviewed: number }[]
  return new Map(rows.map((r) => [r.day, { shadowed: r.shadowed, reviewed: r.reviewed }]))
}

const STREAK_KEY = 'room.streak'
export function getStreak(db: Db): StreakState {
  const raw = getSetting(db, STREAK_KEY)
  return raw ? (JSON.parse(raw) as StreakState) : { streak: 0, lastCheckedDay: null, shieldsUsed: {}, shieldDays: [] }
}
export function saveStreak(db: Db, s: StreakState): void {
  setSetting(db, STREAK_KEY, JSON.stringify(s))
}

export function getDailyCap(db: Db): number {
  const v = Number(getSetting(db, 'room.dailyCap'))
  return Number.isFinite(v) && v >= 1 ? v : DEFAULT_DAILY_CAP
}
export function setDailyCap(db: Db, cap: number): void {
  setSetting(db, 'room.dailyCap', String(Math.min(100, Math.max(1, Math.round(cap)))))
}

export function getRemix(db: Db, day: string): RemixSet | null {
  const r = db.prepare('SELECT json FROM remix_sets WHERE day = ?').get(day) as { json: string } | undefined
  return r ? (JSON.parse(r.json) as RemixSet) : null
}
export function saveRemix(db: Db, set: RemixSet): void {
  db.prepare('INSERT INTO remix_sets (day, json) VALUES (?, ?) ON CONFLICT(day) DO UPDATE SET json = excluded.json').run(set.date, JSON.stringify(set))
}
