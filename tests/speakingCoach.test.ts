import { describe, expect, it } from 'vitest'
import {
  formatClock,
  formatSrtTime,
  mergePartLines,
  parseTimestamp,
  segmentsToLines,
  toPlainText,
  toSrt,
  validateSegments,
  type TranscriptLine
} from '../src/renderer/src/features/speakingcoach/transcriptFormat'

describe('Speaking Coach transcript helpers', () => {
  it('reads Gemini timestamps', () => {
    expect(parseTimestamp('01:15')).toBe(75)
    expect(parseTimestamp('1:02:05')).toBe(3725)
    expect(parseTimestamp('00:03.5')).toBe(3.5)
    expect(parseTimestamp('42')).toBe(42)
    expect(parseTimestamp(12)).toBe(12)
    expect(parseTimestamp('soon')).toBeNull()
    expect(parseTimestamp(undefined)).toBeNull()
  })

  it('formats clock and SRT times', () => {
    expect(formatClock(75)).toBe('01:15')
    expect(formatClock(3725)).toBe('1:02:05')
    expect(formatSrtTime(75.5)).toBe('00:01:15,500')
  })

  it('validates the segments JSON and rejects broken shapes', () => {
    expect(validateSegments({ segments: [{ start: '00:01', end: '00:03', text: ' I go to school yesterday ' }] })).toEqual([
      { start: '00:01', end: '00:03', text: 'I go to school yesterday' }
    ])
    expect(validateSegments({ segments: [] })).toEqual([])
    expect(validateSegments({ segments: [{ start: '00:01', end: '00:02', text: '   ' }] })).toEqual([])
    expect(validateSegments(null)).toBeNull()
    expect(validateSegments({ lines: [] })).toBeNull()
    expect(validateSegments({ segments: [{ start: 'x', end: '00:02', text: 'hi' }] })).toBeNull()
    expect(validateSegments({ segments: [{ start: '00:01', end: '00:02' }] })).toBeNull()
  })

  it('adds the part offset so times are right across parts', () => {
    const lines = segmentsToLines(
      [
        { start: '00:05', end: '00:09', text: 'um so I am agree' },
        { start: '09:58', end: '', text: 'last one' }
      ],
      600,
      1,
      600
    )
    expect(lines[0]).toEqual({ start: 605, end: 609, text: 'um so I am agree', part: 1 })
    // missing end → part end (clamped to the part's length)
    expect(lines[1].start).toBe(1198)
    expect(lines[1].end).toBe(1200)
  })

  it('keeps edits in other parts when a part is (re)transcribed and renumbers ids', () => {
    const existing: TranscriptLine[] = [{ id: 1, start: 1, end: 2, text: 'edited by me', part: 0 }]
    const merged = mergePartLines(existing, 1, [
      { start: 601, end: 603, text: 'second part', part: 1 },
      { start: 600, end: 601, text: 'first of part 2', part: 1 }
    ])
    expect(merged.map((l) => [l.id, l.text])).toEqual([
      [1, 'edited by me'],
      [2, 'first of part 2'],
      [3, 'second part']
    ])
  })

  it('exports .txt and .srt', () => {
    const lines: TranscriptLine[] = [
      { id: 1, start: 0, end: 2.5, text: 'Hello', part: 0 },
      { id: 2, start: 65, end: 65, text: 'He go there', part: 0 }
    ]
    expect(toPlainText(lines)).toBe('[00:00] Hello\n[01:05] He go there')
    expect(toSrt(lines)).toBe('1\n00:00:00,000 --> 00:00:02,500\nHello\n\n2\n00:01:05,000 --> 00:01:06,000\nHe go there\n')
  })
})
