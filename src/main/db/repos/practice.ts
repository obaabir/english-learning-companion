import type { PracticeLine, PracticeRating, PracticeStats } from '@shared/types'
import type { Db } from '../index'

interface Row {
  line_key: string
  media_path: string | null
  media_title: string | null
  start_sec: number | null
  end_sec: number | null
  text: string
  listen_reps: number
  speak_reps: number
  rating: PracticeRating | null
}

const toLine = (r: Row): PracticeLine => ({
  lineKey: r.line_key,
  mediaPath: r.media_path,
  mediaTitle: r.media_title,
  start: r.start_sec,
  end: r.end_sec,
  text: r.text,
  listenReps: r.listen_reps,
  speakReps: r.speak_reps,
  rating: r.rating
})

export interface PracticeRecord {
  lineKey: string
  mediaPath: string | null
  mediaTitle: string | null
  start: number | null
  end: number | null
  text: string
  listenReps?: number
  speakReps?: number
  rating?: PracticeRating
}

/** Adds reps (and an optional rating) to a line's practice record. */
export function recordPractice(db: Db, r: PracticeRecord): void {
  db.prepare(
    `INSERT INTO practice_lines (line_key, media_path, media_title, start_sec, end_sec, text, listen_reps, speak_reps, rating)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(line_key) DO UPDATE SET
       listen_reps = listen_reps + excluded.listen_reps,
       speak_reps = speak_reps + excluded.speak_reps,
       rating = COALESCE(excluded.rating, rating),
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')`
  ).run(r.lineKey, r.mediaPath, r.mediaTitle, r.start, r.end, r.text, r.listenReps ?? 0, r.speakReps ?? 0, r.rating ?? null)
}

export function practiceStats(db: Db): PracticeStats {
  const t = db
    .prepare('SELECT COUNT(*) AS n, COALESCE(SUM(listen_reps), 0) AS l, COALESCE(SUM(speak_reps), 0) AS s FROM practice_lines')
    .get() as { n: number; l: number; s: number }
  const hard = db.prepare("SELECT * FROM practice_lines WHERE rating = 'Hard' ORDER BY updated_at DESC LIMIT 50").all() as unknown as Row[]
  return { linesPractised: t.n, listenReps: t.l, speakReps: t.s, hardLines: hard.map(toLine) }
}
