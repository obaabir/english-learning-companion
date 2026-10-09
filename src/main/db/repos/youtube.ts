import type { TranscriptLine, YouTubeLevel, YouTubeVideo } from '@shared/types'
import type { Db } from '../index'

interface Row {
  video_id: string
  url: string
  title: string
  channel: string
  thumbnail_url: string | null
  duration_sec: number | null
  transcript_source: 'ai' | null
  transcript_json: string
  chunks_done: number
  transcript_complete: number
  level: YouTubeLevel | null
  last_position_sec: number
}

const toVideo = (r: Row): YouTubeVideo & { chunksDone: number } => ({
  videoId: r.video_id,
  url: r.url,
  title: r.title,
  channel: r.channel,
  thumbnailUrl: r.thumbnail_url,
  durationSec: r.duration_sec,
  transcriptSource: r.transcript_source,
  transcript: JSON.parse(r.transcript_json) as TranscriptLine[],
  transcriptComplete: r.transcript_complete === 1,
  level: r.level,
  lastPositionSec: r.last_position_sec,
  chunksDone: r.chunks_done
})

export function getVideo(db: Db, videoId: string): (YouTubeVideo & { chunksDone: number }) | null {
  const r = db.prepare('SELECT * FROM youtube_videos WHERE video_id = ?').get(videoId) as Row | undefined
  return r ? toVideo(r) : null
}

/** Inserts the video or refreshes its title/channel/thumbnail (keeps any transcript). */
export function upsertVideoInfo(db: Db, v: { videoId: string; url: string; title: string; channel: string; thumbnailUrl: string | null }): void {
  db.prepare(
    `INSERT INTO youtube_videos (video_id, url, title, channel, thumbnail_url) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(video_id) DO UPDATE SET title = excluded.title, channel = excluded.channel, thumbnail_url = excluded.thumbnail_url,
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')`
  ).run(v.videoId, v.url, v.title, v.channel, v.thumbnailUrl)
}

export function saveTranscriptProgress(
  db: Db,
  videoId: string,
  p: { transcript: TranscriptLine[]; chunksDone: number; complete: boolean; durationSec: number | null; level: YouTubeLevel | null }
): void {
  db.prepare(
    `UPDATE youtube_videos SET transcript_source = 'ai', transcript_json = ?, chunks_done = ?, transcript_complete = ?,
       duration_sec = COALESCE(?, duration_sec), level = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE video_id = ?`
  ).run(JSON.stringify(p.transcript), p.chunksDone, p.complete ? 1 : 0, p.durationSec, p.level, videoId)
}

export function saveVideoPosition(db: Db, videoId: string, seconds: number): void {
  db.prepare("UPDATE youtube_videos SET last_position_sec = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE video_id = ?").run(
    Math.max(0, seconds),
    videoId
  )
}

/** Recently used videos, without transcripts (for the home list). */
export function listRecentVideos(db: Db, limit = 12): YouTubeVideo[] {
  return (db.prepare('SELECT * FROM youtube_videos ORDER BY updated_at DESC LIMIT ?').all(limit) as unknown as Row[]).map((r) => {
    const { chunksDone: _c, ...v } = toVideo(r)
    return { ...v, transcript: [] }
  })
}
