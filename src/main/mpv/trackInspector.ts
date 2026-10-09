import type { SubtitleStatus } from '@shared/types'

export interface MpvTrack {
  type: string
  codec?: string
  selected?: boolean
  lang?: string
}

const IMAGE_CODECS = new Set(['hdmv_pgs_subtitle', 'dvd_subtitle', 'dvb_subtitle', 'xsub', 'pgssub', 'vobsub'])

/** Classifies the active subtitle track from mpv's `track-list`. */
export function inspectSubtitles(tracks: MpvTrack[] | null | undefined): SubtitleStatus {
  const subs = (tracks ?? []).filter((t) => t.type === 'sub')
  if (!subs.length) return { kind: 'none' }
  const active = subs.find((t) => t.selected) ?? subs[0]
  const codec = active.codec ?? 'unknown'
  return IMAGE_CODECS.has(codec)
    ? { kind: 'image', codec, lang: active.lang }
    : { kind: 'text', codec, lang: active.lang }
}
