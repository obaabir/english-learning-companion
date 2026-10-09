import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import net from 'node:net'
import { join } from 'node:path'
import { EventEmitter } from 'node:events'
import type { PlayerStatus, SubtitleLine } from '@shared/types'
import { cleanSubtitle } from './subtitleClean'
import { inspectSubtitles, type MpvTrack } from './trackInspector'

let launchCount = 0
/** A fresh pipe per launch, so a closing mpv instance is never mistaken for the new one. */
const newPipeName = (): string => `\\\\.\\pipe\\elc-mpv-${process.pid}-${++launchCount}`

/** Property ids for observe_property. */
const OBSERVED = ['sub-text', 'time-pos', 'path', 'media-title', 'track-list', 'pause'] as const

interface Pending {
  resolve: (data: unknown) => void
  reject: (err: Error) => void
}

interface MpvMessage {
  request_id?: number
  error?: string
  data?: unknown
  event?: string
  name?: string
  id?: number
}

/** Common Windows install locations, tried when the configured path is just "mpv". */
export function detectMpvPath(): string | null {
  const home = process.env.USERPROFILE ?? ''
  const candidates = [
    join(process.env.ProgramFiles ?? 'C:\\Program Files', 'mpv', 'mpv.exe'),
    join(process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'mpv', 'mpv.exe'),
    join(home, 'scoop', 'apps', 'mpv', 'current', 'mpv.exe'),
    // winget (shinchiro.mpv) links portable installs here
    join(process.env.LOCALAPPDATA ?? '', 'Microsoft', 'WinGet', 'Links', 'mpv.exe'),
    join(process.env.LOCALAPPDATA ?? '', 'Programs', 'mpv', 'mpv.exe'),
    'C:\\ProgramData\\chocolatey\\bin\\mpv.exe'
  ]
  return candidates.find((p) => existsSync(p)) ?? null
}

/**
 * Drives an mpv process over its JSON IPC named pipe. Emits:
 *  - 'status'   (PlayerStatus) whenever playback state changes (time throttled)
 *  - 'subtitle' (SubtitleLine) for each new non-empty subtitle
 */
export class MpvClient extends EventEmitter {
  private proc: ChildProcess | null = null
  private socket: net.Socket | null = null
  private buffer = ''
  private nextRequestId = 1
  private pending = new Map<number, Pending>()
  private lastSubtitleKey = ''
  private seq = 0
  private lastTimeEmit = 0

  status: PlayerStatus = MpvClient.emptyStatus()

  /** spawnFn is injectable so tests can run a fake mpv. */
  constructor(private readonly spawnFn: typeof spawn = spawn) {
    super()
  }

  private static emptyStatus(): PlayerStatus {
    return {
      running: false,
      connected: false,
      mediaPath: null,
      mediaTitle: null,
      timePos: null,
      paused: false,
      subtitles: { kind: 'idle' }
    }
  }

  get isConnected(): boolean {
    return !!this.socket && !this.socket.destroyed
  }

  /** Starts mpv (or reuses the running one) and loads a file. */
  async open(mpvPath: string, file?: string, startSeconds?: number): Promise<PlayerStatus> {
    if (this.isConnected) {
      if (file) await this.loadFile(file, startSeconds)
      return this.status
    }
    await this.launch(mpvPath, file, startSeconds)
    return this.status
  }

  private async launch(mpvPath: string, file?: string, startSeconds?: number): Promise<void> {
    const pipe = newPipeName()
    const args = [
      `--input-ipc-server=${pipe}`,
      '--force-window=yes',
      '--idle=yes',
      '--keep-open=yes',
      '--sub-auto=fuzzy',
      '--slang=en,eng,en-US,en-GB',
      '--sub-visibility=yes'
    ]
    if (startSeconds != null && startSeconds > 0) args.push(`--start=${startSeconds.toFixed(2)}`)
    if (file) args.push('--', file)

    let spawnError: Error | null = null
    const proc = this.spawnFn(mpvPath, args, { stdio: 'ignore', windowsHide: false })
    proc.on('error', (err: NodeJS.ErrnoException) => {
      spawnError =
        err.code === 'ENOENT'
          ? new Error(`mpv was not found at "${mpvPath}". Install mpv and set its path in Settings.`)
          : err
    })
    proc.on('exit', () => {
      if (this.proc === proc) this.reset()
    })
    this.proc = proc
    this.status = { ...MpvClient.emptyStatus(), running: true }

    for (let attempt = 0; attempt < 80; attempt++) {
      if (spawnError) {
        this.reset()
        throw spawnError
      }
      try {
        await this.connect(pipe)
        break
      } catch {
        await new Promise((r) => setTimeout(r, 100))
      }
    }
    if (!this.isConnected) {
      this.quit()
      throw new Error('Could not connect to mpv. Make sure the mpv path in Settings is correct.')
    }
    for (let i = 0; i < OBSERVED.length; i++) {
      await this.command(['observe_property', i + 1, OBSERVED[i]])
    }
    this.emitStatus()
  }

  private connect(pipe: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = net.connect(pipe)
      const onError = (err: Error): void => {
        socket.destroy()
        reject(err)
      }
      socket.once('error', onError)
      socket.once('connect', () => {
        socket.off('error', onError)
        socket.setEncoding('utf8')
        socket.on('data', (chunk: string) => this.onData(chunk))
        socket.on('error', () => undefined)
        socket.on('close', () => {
          if (this.socket === socket) this.reset()
        })
        this.socket = socket
        this.status = { ...this.status, connected: true }
        resolve()
      })
    })
  }

  private onData(chunk: string): void {
    this.buffer += chunk
    let idx: number
    while ((idx = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, idx).trim()
      this.buffer = this.buffer.slice(idx + 1)
      if (!line) continue
      try {
        this.onMessage(JSON.parse(line) as MpvMessage)
      } catch {
        // ignore malformed lines
      }
    }
  }

  private onMessage(msg: MpvMessage): void {
    if (msg.request_id != null && this.pending.has(msg.request_id)) {
      const p = this.pending.get(msg.request_id)!
      this.pending.delete(msg.request_id)
      if (msg.error && msg.error !== 'success') p.reject(new Error(msg.error))
      else p.resolve(msg.data)
      return
    }
    if (msg.event === 'property-change') this.onProperty(msg.name ?? '', msg.data)
    else if (msg.event) this.emit(`event:${msg.event}`, msg)
  }

  private onProperty(name: string, data: unknown): void {
    switch (name) {
      case 'sub-text':
        void this.onSubtitleText(typeof data === 'string' ? data : '')
        return
      case 'time-pos': {
        this.status = { ...this.status, timePos: typeof data === 'number' ? data : null }
        const now = Date.now()
        if (now - this.lastTimeEmit > 250) this.emitStatus()
        return
      }
      case 'path':
        this.status = { ...this.status, mediaPath: typeof data === 'string' ? data : null }
        this.lastSubtitleKey = ''
        break
      case 'media-title':
        this.status = { ...this.status, mediaTitle: typeof data === 'string' ? data : null }
        break
      case 'track-list':
        this.status = {
          ...this.status,
          subtitles: this.status.mediaPath ? inspectSubtitles(data as MpvTrack[]) : { kind: 'idle' }
        }
        break
      case 'pause':
        this.status = { ...this.status, paused: data === true }
        break
      default:
        return
    }
    this.emitStatus()
  }

  private async onSubtitleText(raw: string): Promise<void> {
    const text = cleanSubtitle(raw)
    if (!text) return
    const [start, end] = await Promise.all([this.getNumber('sub-start'), this.getNumber('sub-end')])
    const mediaPath = this.status.mediaPath ?? ''
    const key = start != null ? `${mediaPath}@${start.toFixed(2)}` : `${mediaPath}#${text}`
    if (key === this.lastSubtitleKey) return
    this.lastSubtitleKey = key
    const line: SubtitleLine = {
      id: start != null ? key : `${key}#${++this.seq}`,
      text,
      start: start ?? this.status.timePos,
      end,
      mediaPath,
      mediaTitle: this.displayTitle()
    }
    this.emit('subtitle', line)
  }

  private displayTitle(): string {
    const title = this.status.mediaTitle ?? this.status.mediaPath ?? ''
    // mpv falls back to the file name; drop the extension for readability
    return title.replace(/\.(mkv|mp4|avi|mov|webm|m4v|wmv|flv|ts)$/i, '')
  }

  private async getNumber(prop: string): Promise<number | null> {
    try {
      const v = await this.command(['get_property', prop])
      return typeof v === 'number' ? v : null
    } catch {
      return null
    }
  }

  command(cmd: unknown[]): Promise<unknown> {
    if (!this.isConnected) return Promise.reject(new Error('mpv is not running. Open a movie first.'))
    const request_id = this.nextRequestId++
    return new Promise((resolve, reject) => {
      this.pending.set(request_id, { resolve, reject })
      this.socket!.write(JSON.stringify({ command: cmd, request_id }) + '\n')
      setTimeout(() => {
        if (this.pending.delete(request_id)) reject(new Error(`mpv did not respond to ${String(cmd[0])}`))
      }, 5000)
    })
  }

  private waitForEvent(event: string, timeoutMs: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.off(`event:${event}`, onEvent)
        reject(new Error(`Timed out waiting for mpv ${event}`))
      }, timeoutMs)
      const onEvent = (): void => {
        clearTimeout(timer)
        resolve()
      }
      this.once(`event:${event}`, onEvent)
    })
  }

  private async loadFile(file: string, startSeconds?: number): Promise<void> {
    const loaded = this.waitForEvent('file-loaded', 15000)
    await this.command(['loadfile', file, 'replace'])
    await loaded
    if (startSeconds != null) await this.command(['set_property', 'time-pos', startSeconds])
  }

  /** Jumps to a moment, opening the movie first if it isn't the current one. */
  async seekTo(mpvPath: string, mediaPath: string | null, seconds: number): Promise<void> {
    const sameMedia = !mediaPath || mediaPath === this.status.mediaPath
    if (this.isConnected && sameMedia) {
      await this.command(['set_property', 'time-pos', seconds])
    } else if (mediaPath) {
      if (!existsSync(mediaPath)) throw new Error(`Movie file not found: ${mediaPath}`)
      await this.open(mpvPath, mediaPath, seconds)
    } else {
      throw new Error('This note has no movie file attached.')
    }
    await this.command(['set_property', 'pause', false]).catch(() => undefined)
  }

  async addSubtitle(file: string): Promise<void> {
    await this.command(['sub-add', file, 'select'])
  }

  /** Practice controls. */
  async control(c: { action: 'play' } | { action: 'pause' } | { action: 'seek'; seconds: number } | { action: 'rate'; rate: number }): Promise<void> {
    if (c.action === 'play') await this.command(['set_property', 'pause', false])
    else if (c.action === 'pause') await this.command(['set_property', 'pause', true])
    else if (c.action === 'rate') await this.command(['set_property', 'speed', c.rate])
    else await this.command(['set_property', 'time-pos', Math.max(0, c.seconds)])
  }

  async togglePause(): Promise<void> {
    await this.command(['cycle', 'pause'])
  }

  private emitStatus(): void {
    this.lastTimeEmit = Date.now()
    this.emit('status', this.status)
  }

  private reset(): void {
    for (const p of this.pending.values()) p.reject(new Error('mpv closed'))
    this.pending.clear()
    this.socket?.destroy()
    this.socket = null
    this.proc = null
    this.buffer = ''
    this.lastSubtitleKey = ''
    this.status = MpvClient.emptyStatus()
    this.emitStatus()
  }

  quit(): void {
    if (this.isConnected) this.socket!.write(JSON.stringify({ command: ['quit'] }) + '\n')
    const proc = this.proc
    setTimeout(() => proc?.kill(), 500)
  }
}
