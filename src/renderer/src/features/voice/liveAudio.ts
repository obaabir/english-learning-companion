/**
 * Voice Mode sound: the microphone as 16 kHz 16-bit PCM pieces (what Gemini Live expects), and a
 * player for the spoken answers (24 kHz 16-bit PCM) that plays pieces back to back and can stop at
 * once when the user interrupts. The microphone is used only while a Voice Mode session is on.
 */

/** Float samples at `rate` → 16 kHz 16-bit PCM (averaging, so it doesn't alias). */
export function toPcm16k(input: Float32Array, rate: number): Int16Array {
  const ratio = rate / 16000
  const n = Math.floor(input.length / ratio)
  const out = new Int16Array(n)
  for (let i = 0; i < n; i++) {
    const from = Math.floor(i * ratio)
    const to = Math.min(input.length, Math.max(from + 1, Math.floor((i + 1) * ratio)))
    let sum = 0
    for (let j = from; j < to; j++) sum += input[j]
    const v = Math.max(-1, Math.min(1, sum / (to - from)))
    out[i] = v < 0 ? v * 0x8000 : v * 0x7fff
  }
  return out
}

export function bytesToBase64(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

export function base64ToInt16(b64: string): Int16Array {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length - (bin.length % 2))
  for (let i = 0; i < bytes.length; i++) bytes[i] = bin.charCodeAt(i)
  return new Int16Array(bytes.buffer)
}

export interface Mic {
  setMuted: (muted: boolean) => void
  stop: () => void
}

/**
 * Starts the microphone (asks for permission the first time). Sends a piece about every 85 ms.
 * Echo cancellation stays on so the assistant's own voice isn't heard as the user talking.
 */
export async function startMic(onChunk: (pcmBase64: string) => void, onLevel?: (rms: number) => void): Promise<Mic> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
  const ctx = new AudioContext()
  const source = ctx.createMediaStreamSource(stream)
  // ScriptProcessor: works under the app's strict content policy (no separate worklet file needed).
  const proc = ctx.createScriptProcessor(4096, 1, 1)
  let muted = false
  proc.onaudioprocess = (e) => {
    const input = e.inputBuffer.getChannelData(0)
    if (onLevel) {
      let sum = 0
      for (let i = 0; i < input.length; i += 4) sum += input[i] * input[i]
      onLevel(muted ? 0 : Math.sqrt(sum / (input.length / 4)))
    }
    if (muted) return
    const pcm = toPcm16k(input, ctx.sampleRate)
    onChunk(bytesToBase64(new Uint8Array(pcm.buffer)))
  }
  source.connect(proc)
  // The processor only runs when connected to the output; it writes silence there.
  proc.connect(ctx.destination)
  let stopped = false
  return {
    setMuted: (m) => {
      muted = m
    },
    stop: () => {
      if (stopped) return
      stopped = true
      proc.onaudioprocess = null
      source.disconnect()
      proc.disconnect()
      stream.getTracks().forEach((t) => t.stop())
      void ctx.close()
    }
  }
}

/** Plays the spoken answer as it streams in. */
export class PcmPlayer {
  private ctx: AudioContext | null = null
  private next = 0
  private sources = new Set<AudioBufferSourceNode>()

  constructor(private readonly onSpeaking: (speaking: boolean) => void) {}

  get speaking(): boolean {
    return this.sources.size > 0
  }

  play(b64: string): void {
    const pcm = base64ToInt16(b64)
    if (!pcm.length) return
    this.ctx ??= new AudioContext()
    const ctx = this.ctx
    const buf = ctx.createBuffer(1, pcm.length, 24000)
    const ch = buf.getChannelData(0)
    for (let i = 0; i < pcm.length; i++) ch[i] = pcm[i] / 0x8000
    const src = ctx.createBufferSource()
    src.buffer = buf
    src.connect(ctx.destination)
    // Back to back with a tiny lead so the first piece doesn't click.
    const at = Math.max(ctx.currentTime + 0.03, this.next)
    src.start(at)
    this.next = at + buf.duration
    const wasSpeaking = this.speaking
    this.sources.add(src)
    if (!wasSpeaking) this.onSpeaking(true)
    src.onended = () => {
      this.sources.delete(src)
      if (!this.speaking) this.onSpeaking(false)
    }
  }

  /** Stops speaking at once (the user interrupted, muted the answer, or ended). */
  stop(): void {
    const had = this.speaking
    for (const s of this.sources) {
      s.onended = null
      try {
        s.stop()
      } catch {
        // not started yet
      }
    }
    this.sources.clear()
    this.next = 0
    if (had) this.onSpeaking(false)
  }

  close(): void {
    this.stop()
    void this.ctx?.close()
    this.ctx = null
  }
}
