import { spawn, type ChildProcess } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { existsSync } from 'node:fs'
import net from 'node:net'
import { basename, extname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { PlayerStatus, SubtitleLine, SubtitleStatus } from '@shared/types'
import type { Player, PlayerControl } from './Player'
import { activeCueIndex, type Cue } from './subtitles/parsers'
import { findSidecarSubtitles, loadSubtitleFile, readMkvSubtitles, type MkvReadHandle } from './subtitles/loader'

export function detectVlcPath(): string | null {
  const candidates = [
    join(process.env.ProgramFiles ?? 'C:\\Program Files', 'VideoLAN', 'VLC', 'vlc.exe'),
    join(process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'VideoLAN', 'VLC', 'vlc.exe')
  ]
  return candidates.find((p) => existsSync(p)) ?? null
}

interface VlcStatusJson {
  state?: 'playing' | 'paused' | 'stopped' | string
  time?: number
  length?: number
  position?: number
  information?: { category?: { meta?: { filename?: string } } }
}

export interface VlcOptions {
  spawnFn?: typeof spawn
  /** Extra VLC command-line arguments (tests use '--intf=dummy'). */
  extraArgs?: string[]
  pollMs?: number
}

const emptyStatus = (): PlayerStatus => ({
  player: 'vlc',
  running: false,
  connected: false,
  mediaPath: null,
  mediaTitle: null,
  timePos: null,
  paused: false,
  subtitles: { kind: 'idle' }
})

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer()
    srv.once('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address() as net.AddressInfo
      srv.close(() => resolve(port))
    })
  })
}

/**
 * Drives VLC through its built-in HTTP interface. VLC does not report subtitle
 * text, so the app loads the subtitles itself (an .srt/.ass/.vtt next to the
 * movie, or the English text track inside an .mkv) and shows whichever cue
 * matches VLC's current playback time.
 */
export class VlcClient extends EventEmitter implements Player {
  status: PlayerStatus = emptyStatus()
  private proc: ChildProcess | null = null
  private port = 0
  private password = ''
  private pollTimer: NodeJS.Timeout | null = null
  private polling = false
  private cues: Cue[] = []
  private lastCue = -1
  private mkv: MkvReadHandle | null = null
  private loadSeq = 0
  private lastStatusEmit = 0
  /** After switching movies, VLC briefly still reports the old file; ignore it until the new one is playing. */
  private pendingFile: { name: string; since: number } | null = null

  constructor(private readonly opts: VlcOptions = {}) {
    super()
  }

  get isRunning(): boolean {
    return !!this.proc && this.proc.exitCode === null && this.status.connected
  }

  async open(vlcPath: string, file?: string, startSeconds?: number): Promise<PlayerStatus> {
    if (!file) {
      if (!this.isRunning) await this.launch(vlcPath)
      return this.status
    }
    // Switching files inside a running VLC (in_play) can freeze VLC while a subtitle
    // is on screen (reproduced with VLC 3.0.24), so a new movie gets a fresh VLC.
    if (this.proc) this.stopProcess()
    this.setMedia(file)
    await this.launch(vlcPath, file, startSeconds)
    return this.status
  }

  /** Ends the current VLC without resetting the app's view, because a new one is about to start. */
  private stopProcess(): void {
    if (this.pollTimer) clearInterval(this.pollTimer)
    this.pollTimer = null
    const proc = this.proc
    this.proc = null
    this.status = { ...this.status, running: false, connected: false }
    proc?.kill()
  }

  private async launch(vlcPath: string, file?: string, startSeconds?: number): Promise<void> {
    this.port = await freePort()
    this.password = randomBytes(12).toString('hex')
    const args = [
      '--extraintf=http',
      '--http-host=127.0.0.1',
      `--http-port=${this.port}`,
      `--http-password=${this.password}`,
      '--no-qt-privacy-ask',
      '--no-one-instance',
      '--no-playlist-enqueue',
      ...(this.opts.extraArgs ?? [])
    ]
    if (startSeconds && startSeconds > 0) args.push(`--start-time=${startSeconds.toFixed(2)}`)
    if (file) args.push(file)

    let spawnError: Error | null = null
    const proc = (this.opts.spawnFn ?? spawn)(vlcPath, args, { stdio: 'ignore', windowsHide: false })
    proc.on('error', (err: NodeJS.ErrnoException) => {
      spawnError =
        err.code === 'ENOENT'
          ? new Error(`VLC was not found at "${vlcPath}". Install VLC or set its path in Settings.`)
          : err
    })
    proc.on('exit', () => {
      if (this.proc === proc) this.reset()
    })
    this.proc = proc

    let ok = false
    for (let attempt = 0; attempt < 80 && !ok; attempt++) {
      if (spawnError) {
        this.proc = null
        throw spawnError
      }
      try {
        await this.request({})
        ok = true
      } catch {
        await new Promise((r) => setTimeout(r, 150))
      }
    }
    if (!ok) {
      proc.kill()
      this.proc = null
      throw new Error('Could not connect to VLC. Close any open VLC windows and try again.')
    }
    this.status = { ...this.status, player: 'vlc', running: true, connected: true }
    this.pollTimer = setInterval(() => void this.poll(), this.opts.pollMs ?? 200)
    this.emitStatus()
  }

  private async request(params: Record<string, string>): Promise<VlcStatusJson> {
    const query = Object.entries(params)
      .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
      .join('&')
    const res = await fetch(`http://127.0.0.1:${this.port}/requests/status.json${query ? '?' + query : ''}`, {
      headers: { Authorization: 'Basic ' + Buffer.from(':' + this.password).toString('base64') },
      signal: AbortSignal.timeout(2000)
    })
    if (!res.ok) throw new Error(`VLC responded ${res.status}`)
    return (await res.json()) as VlcStatusJson
  }

  private async poll(): Promise<void> {
    if (this.polling) return
    this.polling = true
    try {
      this.onVlcStatus(await this.request({}))
    } catch {
      // VLC busy or closing; the process exit handler resets state.
    } finally {
      this.polling = false
    }
  }

  /** Playback time in seconds, using `position` for sub-second precision (VLC's `time` is whole seconds). */
  static playbackTime(s: VlcStatusJson): number | null {
    if (typeof s.time !== 'number') return null
    if (typeof s.position === 'number' && s.length && s.length > 0) {
      return Math.min(Math.max(s.position * s.length, s.time), s.time + 0.999)
    }
    return s.time
  }

  private onVlcStatus(s: VlcStatusJson): void {
    if (this.pendingFile) {
      const playing = s.information?.category?.meta?.filename
      // Give up waiting after 8 s in case VLC reports the name differently.
      if (playing === this.pendingFile.name || Date.now() - this.pendingFile.since > 8000) this.pendingFile = null
      else return
    }
    const stopped = s.state === 'stopped'
    const t = stopped ? null : VlcClient.playbackTime(s)
    const paused = s.state === 'paused'
    const pausedChanged = paused !== this.status.paused
    this.status = { ...this.status, timePos: t, paused }
    if (pausedChanged || Date.now() - this.lastStatusEmit > 250) this.emitStatus()
    if (t != null) this.syncSubtitle(t)
  }

  private syncSubtitle(t: number): void {
    const i = activeCueIndex(this.cues, t)
    if (i === this.lastCue) return
    this.lastCue = i
    if (i < 0) return
    const cue = this.cues[i]
    const mediaPath = this.status.mediaPath ?? ''
    const line: SubtitleLine = {
      id: `${mediaPath}@${cue.start.toFixed(2)}`,
      text: cue.text,
      start: cue.start,
      end: cue.end,
      mediaPath,
      mediaTitle: this.status.mediaTitle ?? ''
    }
    this.emit('subtitle', line)
  }

  private setMedia(file: string): void {
    this.status = {
      ...this.status,
      mediaPath: file,
      mediaTitle: basename(file, extname(file)),
      timePos: null
    }
    this.lastCue = -1
    this.pendingFile = { name: basename(file), since: Date.now() }
    void this.loadSubtitles(file)
  }

  private setSubtitles(subtitles: SubtitleStatus): void {
    this.status = { ...this.status, subtitles }
    this.emitStatus()
  }

  /** Finds subtitles for a movie: a matching subtitle file first, then the MKV's own text track. */
  private async loadSubtitles(file: string): Promise<void> {
    const seq = ++this.loadSeq
    this.mkv?.cancel()
    this.mkv = null
    this.cues = []
    this.lastCue = -1
    const current = (): boolean => seq === this.loadSeq

    for (const sidecar of await findSidecarSubtitles(file)) {
      try {
        const cues = await loadSubtitleFile(sidecar)
        if (!current()) return
        if (cues.length) {
          this.cues = cues
          this.setSubtitles({ kind: 'text', codec: basename(sidecar), count: cues.length })
          return
        }
      } catch {
        // unreadable file; try the next one
      }
    }
    if (!current()) return

    if (!['.mkv', '.webm', '.mka'].includes(extname(file).toLowerCase())) {
      this.setSubtitles({ kind: 'none' })
      return
    }

    this.setSubtitles({ kind: 'loading', source: 'Embedded subtitles', count: 0 })
    const handle = readMkvSubtitles(file, {
      onBatch: (batch) => {
        if (!current()) return
        this.cues = [...this.cues, ...batch].sort((a, b) => a.start - b.start)
        this.lastCue = -1
        this.setSubtitles({ kind: 'loading', source: 'Embedded subtitles', count: this.cues.length })
      }
    })
    this.mkv = handle
    try {
      const { cues, track } = await handle.done
      if (!current()) return
      if (!track || !cues.length) {
        this.setSubtitles({ kind: 'none' })
        return
      }
      this.cues = cues
      this.lastCue = -1
      // Track names are often just the release group (e.g. "CINEFREAK.TOP"), so keep the label short.
      const label = 'Embedded'
      this.setSubtitles({ kind: 'text', codec: label, lang: track.language, count: cues.length })
    } catch (err) {
      console.warn('Reading MKV subtitles failed:', err)
      if (current()) this.setSubtitles({ kind: 'none' })
    } finally {
      if (this.mkv === handle) this.mkv = null
    }
  }

  async addSubtitle(file: string): Promise<void> {
    const cues = await loadSubtitleFile(file)
    if (!cues.length) throw new Error('No subtitles could be read from that file.')
    this.loadSeq++
    this.mkv?.cancel()
    this.mkv = null
    this.cues = cues
    this.lastCue = -1
    this.setSubtitles({ kind: 'text', codec: basename(file), count: cues.length })
    // Also show it inside VLC (best-effort).
    await this.request({ command: 'addsubtitle', val: pathToFileURL(file).href }).catch(() => undefined)
  }

  /** Practice controls. Seeks use the position fraction for sub-second accuracy. */
  async control(c: PlayerControl): Promise<void> {
    if (!this.isRunning) throw new Error('VLC is not running. Open a movie first.')
    if (c.action === 'play') await this.request({ command: 'pl_forceresume' })
    else if (c.action === 'pause') await this.request({ command: 'pl_forcepause' })
    else if (c.action === 'rate') await this.request({ command: 'rate', val: String(c.rate) })
    else {
      const s = await this.request({})
      const length = s.length ?? 0
      const val = length > 0 ? `${((Math.max(0, c.seconds) / length) * 100).toFixed(4)}%` : String(Math.floor(Math.max(0, c.seconds)))
      await this.request({ command: 'seek', val })
      this.lastCue = -1
    }
    void this.poll()
  }

  async togglePause(): Promise<void> {
    if (!this.isRunning) throw new Error('VLC is not running. Open a movie first.')
    await this.request({ command: 'pl_pause' })
    void this.poll()
  }

  async seekTo(vlcPath: string, mediaPath: string | null, seconds: number): Promise<void> {
    const sameMedia = !mediaPath || mediaPath === this.status.mediaPath
    if (this.isRunning && sameMedia) {
      await this.request({ command: 'seek', val: String(Math.floor(seconds)) })
      if (this.status.paused) await this.request({ command: 'pl_forceresume' }).catch(() => undefined)
    } else if (mediaPath) {
      if (!existsSync(mediaPath)) throw new Error(`Movie file not found: ${mediaPath}`)
      await this.open(vlcPath, mediaPath, seconds)
    } else {
      throw new Error('This note has no movie file attached.')
    }
    this.lastCue = -1
    void this.poll()
  }

  private emitStatus(): void {
    this.lastStatusEmit = Date.now()
    this.emit('status', this.status)
  }

  private reset(): void {
    if (this.pollTimer) clearInterval(this.pollTimer)
    this.pollTimer = null
    this.mkv?.cancel()
    this.mkv = null
    this.loadSeq++
    this.pendingFile = null
    this.proc = null
    this.cues = []
    this.lastCue = -1
    this.status = emptyStatus()
    this.emitStatus()
  }

  quit(): void {
    const proc = this.proc
    this.reset()
    proc?.kill()
  }
}
