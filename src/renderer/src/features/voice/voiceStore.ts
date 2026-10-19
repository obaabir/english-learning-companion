import { create } from 'zustand'
import type { VoiceAction } from '@shared/voice'
import { invoke } from '@renderer/lib/api'

export type VoiceStatus = 'idle' | 'listening' | 'processing' | 'success' | 'error'

export interface VoiceSettings {
  /** Speak replies aloud (free browser voice). */
  speak: boolean
  /** When Windows can't match a command, let Gemini write down what was said (uses free Gemini quota). */
  gemini: boolean
  /** City for "what's the weather". */
  city: string
  /** Turn "Hey Jarvis" on when the app opens (only if you choose this). */
  wakeOnStart: boolean
}

const KEY = 'elc.voice.v1'
const DEFAULTS: VoiceSettings = { speak: true, gemini: true, city: '', wakeOnStart: false }

function loadSettings(): VoiceSettings {
  try {
    return { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<VoiceSettings>) }
  } catch {
    return DEFAULTS
  }
}

interface VoiceState {
  open: boolean
  status: VoiceStatus
  /** What was heard (or typed), and by which engine. */
  heard: { text: string; engine: 'windows' | 'gemini' | 'typed' | 'none' } | null
  /** The assistant's answer (may contain Markdown from Gemini). */
  reply: string | null
  clarify: { question: string; options: { label: string; action: VoiceAction }[] } | null
  confirm: { question: string; confirmLabel: string; run: () => Promise<string> } | null
  /** Waiting for a city name after "what's the weather?". */
  awaitingCity: boolean
  wake: 'off' | 'starting' | 'on' | 'error'
  wakeMessage: string | null
  settings: VoiceSettings
  setOpen: (open: boolean) => void
  patch: (p: Partial<Omit<VoiceState, 'settings' | 'patch' | 'setOpen' | 'setSettings'>>) => void
  setSettings: (s: Partial<VoiceSettings>) => void
}

export const useVoice = create<VoiceState>((set, get) => ({
  open: false,
  status: 'idle',
  heard: null,
  reply: null,
  clarify: null,
  confirm: null,
  awaitingCity: false,
  wake: 'off',
  wakeMessage: null,
  settings: loadSettings(),
  setOpen: (open) => set({ open }),
  patch: (p) => set(p),
  setSettings: (s) => {
    const settings = { ...get().settings, ...s }
    set({ settings })
    try {
      localStorage.setItem(KEY, JSON.stringify(settings))
    } catch {
      // keep for this session
    }
  }
}))

/** Plain text for speaking: no Markdown marks, and only if it is mostly English (the voices are English). */
export function speakable(text: string): string | null {
  const plain = text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[#*_>`|]/g, ' ')
    .replace(/\[(.*?)\]\(.*?\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
  if (!plain) return null
  const letters = plain.replace(/[^\p{L}]/gu, '')
  const latin = letters.replace(/[^A-Za-z]/g, '')
  if (letters.length && latin.length / letters.length < 0.8) return null
  const cut = plain.length > 320 ? plain.slice(0, plain.lastIndexOf('.', 320) + 1 || 320) : plain
  return cut
}

let audio: HTMLAudioElement | null = null

/** Speaks with the free browser voice (Windows voices); falls back to the app's Windows voice. */
export async function speak(text: string): Promise<void> {
  stopSpeaking()
  const synth = window.speechSynthesis
  const voices = synth?.getVoices() ?? []
  const voice = voices.find((v) => v.lang === 'en-US' && /zira|aria|jenny/i.test(v.name)) ?? voices.find((v) => v.lang.startsWith('en'))
  if (synth && voice) {
    await new Promise<void>((resolve) => {
      const u = new SpeechSynthesisUtterance(text)
      u.voice = voice
      u.lang = voice.lang
      u.rate = 1
      u.onend = () => resolve()
      u.onerror = () => resolve()
      synth.speak(u)
    })
    return
  }
  try {
    const wav = await invoke('practice:voice', text)
    audio = new Audio(`data:audio/wav;base64,${wav}`)
    await audio.play()
  } catch {
    // speaking is optional
  }
}

export function stopSpeaking(): void {
  window.speechSynthesis?.cancel()
  audio?.pause()
  audio = null
}

/**
 * Records one command from the microphone, only after the user pressed the mic (or said "Hey
 * Jarvis" with that mode switched on). Stops by itself after a short silence, after 8 seconds, or
 * when stop() is called; the microphone is released straight away.
 */
export function recordCommand(): { done: Promise<Blob | null>; stop: () => void } {
  let stopFn = (): void => undefined
  const done = (async (): Promise<Blob | null> => {
    // Raw sound: the browser's gain boost clips speech and its noise filter changes it, and Windows'
    // recognizer (which has its own noise handling) then can't understand it.
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } })
    const ctx = new AudioContext()
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 1024
    ctx.createMediaStreamSource(stream).connect(analyser)
    const buf = new Float32Array(analyser.fftSize)
    const recorder = new MediaRecorder(stream)
    const chunks: Blob[] = []
    recorder.addEventListener('dataavailable', (e) => chunks.push(e.data))
    const finished = new Promise<void>((resolve) => recorder.addEventListener('stop', () => resolve()))
    recorder.start()
    const started = performance.now()
    let base = 0
    let samples = 0
    let spoke = false
    let quietSince = 0
    await new Promise<void>((resolve) => {
      stopFn = () => resolve()
      const tick = (): void => {
        if (recorder.state !== 'recording') return resolve()
        analyser.getFloatTimeDomainData(buf)
        let sum = 0
        for (const v of buf) sum += v * v
        const rms = Math.sqrt(sum / buf.length)
        const t = performance.now() - started
        if (t < 300) {
          base += rms
          samples++
        } else {
          const threshold = Math.max(0.015, (base / Math.max(1, samples)) * 2.5)
          if (rms > threshold) {
            spoke = true
            quietSince = 0
          } else if (spoke) quietSince ||= performance.now()
          if ((spoke && quietSince && performance.now() - quietSince > 1100) || t > 8000 || (!spoke && t > 5000)) return resolve()
        }
        setTimeout(tick, 80)
      }
      tick()
    })
    if (recorder.state === 'recording') recorder.stop()
    await finished
    stream.getTracks().forEach((tr) => tr.stop())
    void ctx.close()
    return spoke ? new Blob(chunks, { type: recorder.mimeType }) : null
  })()
  return { done, stop: () => stopFn() }
}

/**
 * Evens out the volume of a 16-bit PCM WAV (base64) so quiet and loud microphones both reach the
 * recognizer at a clear level (peak about 70%).
 */
export function normalizeWav(base64: string): string {
  const bin = atob(base64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  const view = new DataView(bytes.buffer)
  const n = Math.floor((bytes.length - 44) / 2)
  let peak = 0
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(view.getInt16(44 + i * 2, true)))
  if (peak < 200) return base64 // silence
  const gain = Math.min(8, (0.7 * 32767) / peak)
  if (Math.abs(gain - 1) < 0.1) return base64
  for (let i = 0; i < n; i++) view.setInt16(44 + i * 2, Math.max(-32768, Math.min(32767, Math.round(view.getInt16(44 + i * 2, true) * gain))), true)
  let out = ''
  for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(out)
}
