import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { MpvClient } from '../src/main/mpv/MpvClient'
import type { SubtitleLine } from '../src/shared/types'

const FAKE_MPV = resolve(__dirname, 'fixtures/fake-mpv.mjs')

const fakeSpawn = ((_cmd: string, args: readonly string[], opts: object) =>
  spawn(process.execPath, [FAKE_MPV, ...args], opts)) as unknown as typeof spawn

let client: MpvClient | null = null
afterEach(() => client?.quit())

describe('MpvClient (against a fake mpv IPC server)', () => {
  it('streams cleaned, de-duplicated subtitle lines with timestamps', async () => {
    client = new MpvClient(fakeSpawn)
    const lines: SubtitleLine[] = []
    client.on('subtitle', (l: SubtitleLine) => lines.push(l))

    const status = await client.open('mpv', 'C:\\movies\\Film.mkv')
    expect(status.connected).toBe(true)
    await new Promise((r) => setTimeout(r, 400))

    expect(lines.map((l) => [l.text, l.start])).toEqual([
      ["I don't think that's a good idea.", 1.5],
      ['What are you talking about?', 4.0]
    ])
    expect(lines[0].mediaPath).toBe('C:\\movies\\Film.mkv')
    expect(lines[0].mediaTitle).toBe('Film')
    expect(client.status.subtitles).toEqual({ kind: 'text', codec: 'subrip', lang: 'eng' })
  })

  it('seeks to a saved moment in the open movie', async () => {
    client = new MpvClient(fakeSpawn)
    await client.open('mpv', 'C:\\movies\\Film.mkv')
    await client.seekTo('mpv', 'C:\\movies\\Film.mkv', 83.2)
    const log = (await client.command(['get_property', 'command-log'])) as unknown[][]
    expect(log).toContainEqual(['set_property', 'time-pos', 83.2])
  })

  it('reports a clear error when mpv cannot be started', async () => {
    client = new MpvClient()
    await expect(client.open('C:\\nope\\mpv-missing.exe', 'C:\\movies\\Film.mkv')).rejects.toThrow(/mpv was not found/)
  })
})
