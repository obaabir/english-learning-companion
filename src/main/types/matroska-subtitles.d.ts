declare module 'matroska-subtitles' {
  import { Writable } from 'node:stream'

  export interface MkvSubtitleTrack {
    number: number
    language?: string
    type: 'utf8' | 'ass' | 'ssa' | string
    name?: string
    header?: string
  }

  export interface MkvSubtitle {
    text: string
    /** milliseconds */
    time: number
    /** milliseconds */
    duration?: number
  }

  export class SubtitleParser extends Writable {
    on(event: 'tracks', listener: (tracks: MkvSubtitleTrack[]) => void): this
    on(event: 'subtitle', listener: (subtitle: MkvSubtitle, trackNumber: number) => void): this
    on(event: string | symbol, listener: (...args: any[]) => void): this
    once(event: 'tracks', listener: (tracks: MkvSubtitleTrack[]) => void): this
    once(event: string | symbol, listener: (...args: any[]) => void): this
  }
}
