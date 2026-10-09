import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { activeCueIndex, decodeSubtitleBuffer, isSoundOnly, parseAss, parseSrt, parseVtt } from '../src/main/player/subtitles/parsers'
import { findSidecarSubtitles, pickEnglishTrack } from '../src/main/player/subtitles/loader'
import { VlcClient } from '../src/main/player/VlcClient'

const SRT = `1
00:01:18,745 --> 00:01:21,112
[CAT MEOWS]

2
00:01:21,665 --> 00:01:26,660
I should've known that you would
be here, Professor McGonagall.

3
00:01:52,237 --> 00:01:55,480
- And the boy?
- Hagrid is bringing him.
`

describe('subtitle parsers', () => {
  it('parses SRT, merges lines and drops sound-only cues', () => {
    const cues = parseSrt(SRT.replace(/\n/g, '\r\n'))
    expect(cues).toEqual([
      { start: 81.665, end: 86.66, text: "I should've known that you would be here, Professor McGonagall." },
      { start: 112.237, end: 115.48, text: '- And the boy? - Hagrid is bringing him.' }
    ])
  })

  it('parses WebVTT with short timestamps and cue settings', () => {
    const vtt = 'WEBVTT\n\nNOTE a comment\n\n00:05.000 --> 00:07.500 align:start\n<i>What are you talking about?</i>\n'
    expect(parseVtt(vtt)).toEqual([{ start: 5, end: 7.5, text: 'What are you talking about?' }])
  })

  it('parses ASS using the Format line, keeping commas in the text', () => {
    const ass = [
      '[Script Info]',
      'Title: x',
      '[Events]',
      'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
      String.raw`Dialogue: 0,0:00:03.50,0:00:05.20,Default,,0,0,0,,{\i1}Well,\Nthat's a good idea.`,
      'Comment: 0,0:00:06.00,0:00:07.00,Default,,0,0,0,,ignored'
    ].join('\n')
    expect(parseAss(ass)).toEqual([{ start: 3.5, end: 5.2, text: "Well, that's a good idea." }])
  })

  it('detects sound-only lines', () => {
    expect(isSoundOnly('[CAT MEOWS]')).toBe(true)
    expect(isSoundOnly('♪ ♪')).toBe(true)
    expect(isSoundOnly('(sighs) Fine.')).toBe(false)
  })

  it('decodes UTF-16 and Windows-1252 subtitle files', () => {
    const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('Café', 'utf16le')])
    expect(decodeSubtitleBuffer(utf16)).toBe('Café')
    expect(decodeSubtitleBuffer(Buffer.from([0x43, 0x61, 0x66, 0xe9]))).toBe('Café')
  })

  it('finds the cue showing at a given time', () => {
    const cues = parseSrt(SRT)
    expect(activeCueIndex(cues, 80)).toBe(-1)
    expect(activeCueIndex(cues, 83)).toBe(0)
    expect(activeCueIndex(cues, 90)).toBe(-1)
    expect(activeCueIndex(cues, 113)).toBe(1)
  })
})

describe('subtitle sources', () => {
  it('prefers an English subtitle file named after the movie', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'elc-subs-'))
    for (const f of ['Movie.mkv', 'Movie.hi.srt', 'Movie.en.srt', 'Movie.srt', 'Other.srt']) writeFileSync(join(dir, f), '')
    const found = await findSidecarSubtitles(join(dir, 'Movie.mkv'))
    expect(found.map((p) => p.split(/[\\/]/).pop())).toEqual(['Movie.en.srt', 'Movie.srt', 'Movie.hi.srt'])
  })

  it('picks the English, non-forced MKV text track', () => {
    expect(
      pickEnglishTrack([
        { number: 3, language: 'hin', type: 'utf8' },
        { number: 4, language: 'eng', type: 'utf8', name: 'Forced' },
        { number: 5, language: 'eng', type: 'utf8', name: 'English SDH' }
      ])?.number
    ).toBe(5)
    // Untagged tracks are usually English (as in many BluRay rips).
    expect(pickEnglishTrack([{ number: 4, type: 'utf8' }])?.number).toBe(4)
    expect(pickEnglishTrack([])).toBeNull()
  })

  it('computes sub-second playback time from VLC status', () => {
    expect(VlcClient.playbackTime({ time: 83, length: 6000, position: 83.6 / 6000 })).toBeCloseTo(83.6, 3)
    // Never drifts outside the whole second VLC reports.
    expect(VlcClient.playbackTime({ time: 83, length: 6000, position: 0.5 })).toBeCloseTo(83.999, 3)
    expect(VlcClient.playbackTime({ time: 12 })).toBe(12)
  })
})
