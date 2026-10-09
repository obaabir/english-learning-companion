import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { detectVlcPath, VlcClient } from '../src/main/player/VlcClient'
import { readMkvSubtitles } from '../src/main/player/subtitles/loader'
import type { SubtitleLine } from '../src/shared/types'

/** A silent mono 8 kHz WAV, so VLC has real media with a running clock. */
function silentWav(seconds: number): Buffer {
  const rate = 8000
  const data = rate * seconds
  const b = Buffer.alloc(44 + data, 0x80)
  b.write('RIFF', 0)
  b.writeUInt32LE(36 + data, 4)
  b.write('WAVEfmt ', 8)
  b.writeUInt32LE(16, 16)
  b.writeUInt16LE(1, 20) // PCM
  b.writeUInt16LE(1, 22) // mono
  b.writeUInt32LE(rate, 24)
  b.writeUInt32LE(rate, 28)
  b.writeUInt16LE(1, 32)
  b.writeUInt16LE(8, 34)
  b.write('data', 36)
  b.writeUInt32LE(data, 40)
  return b
}

const vlcPath = detectVlcPath()
const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
let client: VlcClient | null = null
afterEach(() => client?.quit())

describe.skipIf(!vlcPath)('VlcClient with the real VLC (headless)', () => {
  it('shows subtitles in time, seeks, and pauses', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'elc-vlc-'))
    const media = join(dir, "Learner's Test Movie.wav")
    writeFileSync(media, silentWav(30))
    writeFileSync(
      join(dir, "Learner's Test Movie.en.srt"),
      '1\n00:00:01,000 --> 00:00:02,200\nI don\'t think that\'s a good idea.\n\n2\n00:00:02,600 --> 00:00:03,800\nYou should have told me earlier.\n'
    )

    client = new VlcClient({ extraArgs: ['--intf=dummy', '--aout=dummy', '--vout=dummy'], pollMs: 100 })
    const lines: SubtitleLine[] = []
    client.on('subtitle', (l: SubtitleLine) => lines.push(l))

    const status = await client.open(vlcPath!, media)
    expect(status.connected).toBe(true)
    await wait(4500)

    expect(lines.map((l) => l.text)).toEqual(["I don't think that's a good idea.", 'You should have told me earlier.'])
    expect(lines[0].start).toBe(1)
    expect(lines[0].mediaTitle).toBe("Learner's Test Movie")
    expect(client.status.subtitles).toMatchObject({ kind: 'text', codec: "Learner's Test Movie.en.srt", count: 2 })
    expect(client.status.timePos).toBeGreaterThan(3)

    // Jump back to a saved moment: the first line shows again.
    lines.length = 0
    await client.seekTo(vlcPath!, media, 1)
    await wait(800)
    expect(lines[0]?.text).toBe("I don't think that's a good idea.")

    await client.togglePause()
    await wait(400)
    expect(client.status.paused).toBe(true)
  }, 30000)

  it('switches movies cleanly: only the new movie’s subtitles appear', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'elc-vlc-switch-'))
    const a = join(dir, 'Movie A.wav')
    const b = join(dir, 'Movie B.wav')
    writeFileSync(a, silentWav(30))
    writeFileSync(b, silentWav(30))
    writeFileSync(join(dir, 'Movie A.srt'), '1\n00:00:00,500 --> 00:00:20,000\nThis is movie A.\n')
    writeFileSync(join(dir, 'Movie B.srt'), '1\n00:00:01,500 --> 00:00:03,000\nThis is movie B.\n')

    client = new VlcClient({ extraArgs: ['--intf=dummy', '--aout=dummy', '--vout=dummy'], pollMs: 100 })
    const lines: SubtitleLine[] = []
    client.on('subtitle', (l: SubtitleLine) => lines.push(l))

    await client.open(vlcPath!, a)
    await wait(2500)
    expect(lines.map((l) => l.text)).toEqual(['This is movie A.'])

    lines.length = 0
    await client.open(vlcPath!, b) // switch while VLC is still running
    expect(client.status.mediaPath).toBe(b)
    await wait(3500)
    expect(lines.map((l) => [l.text, l.mediaPath])).toEqual([['This is movie B.', b]])
    expect(client.status.subtitles).toMatchObject({ kind: 'text', codec: 'Movie B.srt' })
  }, 30000)

  it('reports a clear error for a wrong VLC path', async () => {
    client = new VlcClient()
    await expect(client.open('C:\\nope\\vlc-missing.exe', 'C:\\movies\\x.mkv')).rejects.toThrow(/VLC was not found/)
  })
})

// Opt-in: ELC_TEST_MKV=<path to a real .mkv with text subtitles> npx vitest run tests/vlc.test.ts
const realMkv = process.env.ELC_TEST_MKV
describe.skipIf(!realMkv || !existsSync(realMkv))('MKV subtitle extraction (real movie file)', () => {
  it('extracts the English text track progressively', async () => {
    let batches = 0
    const t0 = Date.now()
    const { cues, track } = await readMkvSubtitles(realMkv!, { onBatch: () => batches++ }).done
    console.log(`MKV: ${cues.length} cues from track ${track?.number} in ${((Date.now() - t0) / 1000).toFixed(1)}s, ${batches} batches`)
    console.log('first cues:', cues.slice(0, 3))
    expect(track).not.toBeNull()
    expect(cues.length).toBeGreaterThan(100)
    expect(cues.every((c, i) => i === 0 || c.start >= cues[i - 1].start)).toBe(true)
    expect(cues.some((c) => /^\[.*\]$/.test(c.text))).toBe(false)
  }, 120000)
})
