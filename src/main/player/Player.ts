import type { EventEmitter } from 'node:events'
import type { PlayerStatus } from '@shared/types'

/**
 * A media player the app can drive. Implementations emit:
 *  - 'status'   (PlayerStatus) when playback state changes
 *  - 'subtitle' (SubtitleLine) for each new subtitle shown
 */
export interface Player extends EventEmitter {
  readonly status: PlayerStatus
  open(exePath: string, file?: string, startSeconds?: number): Promise<PlayerStatus>
  addSubtitle(file: string): Promise<void>
  togglePause(): Promise<void>
  seekTo(exePath: string, mediaPath: string | null, seconds: number): Promise<void>
  quit(): void
  /** Practice controls (Repeat ×N / Speak ×N). */
  control(action: PlayerControl): Promise<void>
}

export type PlayerControl =
  | { action: 'play' }
  | { action: 'pause' }
  | { action: 'seek'; seconds: number }
  | { action: 'rate'; rate: number }
