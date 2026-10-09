import { cleanSubtitle } from '../../mpv/subtitleClean'

/** One timed subtitle, times in seconds. */
export interface Cue {
  start: number
  end: number
  text: string
}

/** Lines that only describe sounds or music, e.g. "[CAT MEOWS]", "(sighs)", "♪". Not useful for learning. */
export function isSoundOnly(text: string): boolean {
  const stripped = text
    .replace(/\[[^\]]*\]|\([^)]*\)/g, '')
    .replace(/[♪♫#\-–—:.\s]/g, '')
  return stripped.length === 0
}

/** Cleans, drops empty/sound-only cues, and sorts by start time. */
export function finalizeCues(cues: Cue[]): Cue[] {
  return cues
    .map((c) => ({ ...c, text: cleanSubtitle(c.text) }))
    .filter((c) => c.text && !isSoundOnly(c.text) && Number.isFinite(c.start))
    .sort((a, b) => a.start - b.start)
}

/** "01:02:03,456" / "01:02:03.456" / "02:03.456" → seconds. */
function parseClock(s: string): number {
  const m = s.trim().match(/^(?:(\d+):)?(\d{1,2}):(\d{1,2})(?:[,.](\d{1,3}))?$/)
  if (!m) return NaN
  const [, h, min, sec, frac] = m
  return Number(h ?? 0) * 3600 + Number(min) * 60 + Number(sec) + (frac ? Number(frac.padEnd(3, '0')) / 1000 : 0)
}

const TIMING = /^\s*([\d:.,]+)\s*-->\s*([\d:.,]+)/

/** SRT and WebVTT share the same block structure: optional id, timing line, text lines. */
function parseBlocks(content: string): Cue[] {
  const cues: Cue[] = []
  for (const block of content.replace(/\r\n?/g, '\n').split(/\n{2,}/)) {
    const lines = block.split('\n')
    const t = lines.findIndex((l) => TIMING.test(l))
    if (t < 0) continue
    const [, a, b] = lines[t].match(TIMING)!
    const text = lines.slice(t + 1).join('\n').trim()
    if (text) cues.push({ start: parseClock(a), end: parseClock(b), text })
  }
  return cues
}

export const parseSrt = (content: string): Cue[] => finalizeCues(parseBlocks(content))

export const parseVtt = (content: string): Cue[] =>
  finalizeCues(parseBlocks(content.replace(/^WEBVTT[^\n]*\n/, '').replace(/^NOTE[\s\S]*?(\n\n|$)/gm, '')))

/** ASS/SSA: reads the [Events] Format line to find Start, End and Text columns. */
export function parseAss(content: string): Cue[] {
  const cues: Cue[] = []
  let fields: string[] = ['layer', 'start', 'end', 'style', 'name', 'marginl', 'marginr', 'marginv', 'effect', 'text']
  let inEvents = false
  for (const raw of content.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trim()
    if (line.startsWith('[')) {
      inEvents = line.toLowerCase() === '[events]'
      continue
    }
    if (!inEvents) continue
    if (/^format:/i.test(line)) {
      fields = line.slice(7).split(',').map((f) => f.trim().toLowerCase())
    } else if (/^dialogue:/i.test(line)) {
      const parts = line.slice(9).split(',')
      const textIdx = fields.indexOf('text')
      const values = [...parts.slice(0, textIdx), parts.slice(textIdx).join(',')]
      const get = (f: string): string => values[fields.indexOf(f)] ?? ''
      cues.push({ start: parseClock(get('start')), end: parseClock(get('end')), text: get('text') })
    }
  }
  return finalizeCues(cues)
}

export function parseSubtitleText(content: string, ext: string): Cue[] {
  const e = ext.toLowerCase().replace(/^\./, '')
  if (e === 'ass' || e === 'ssa') return parseAss(content)
  if (e === 'vtt') return parseVtt(content)
  return parseSrt(content)
}

/** Decodes subtitle bytes: UTF-8 (with/without BOM), UTF-16 LE/BE, falling back to Windows-1252. */
export function decodeSubtitleBuffer(buf: Uint8Array): string {
  if (buf[0] === 0xff && buf[1] === 0xfe) return new TextDecoder('utf-16le').decode(buf.subarray(2))
  if (buf[0] === 0xfe && buf[1] === 0xff) return new TextDecoder('utf-16be').decode(buf.subarray(2))
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf).replace(/^﻿/, '')
  } catch {
    return new TextDecoder('windows-1252').decode(buf)
  }
}

/**
 * Index of the cue showing at time t, or -1. Cues are sorted by start; when cues
 * overlap, the latest-starting one wins.
 */
export function activeCueIndex(cues: Cue[], t: number): number {
  let lo = 0
  let hi = cues.length - 1
  let idx = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (cues[mid].start <= t) {
      idx = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  for (let i = idx; i >= 0 && i > idx - 5; i--) {
    if (t < cues[i].end) return i
  }
  return -1
}
