import { create } from 'zustand'
import { isWakeOnly } from '@shared/voice'
import type { LiveEvent, LiveFailure } from '@shared/liveTools'
import { normTerm } from '@shared/vocab'
import { invoke, on, errorMessage } from '@renderer/lib/api'
import { useApp, type Page } from '@renderer/stores/app'
import { useIntents } from '@renderer/stores/intents'
import { recordingToWavBase64 } from '@renderer/features/practice/audio'
import { useFsp } from '@renderer/features/flashcards/fsp/fspStore'
import { topMistakes, fspToday } from '@renderer/features/flashcards/fsp/fspLogic'
import { currentSelection, handleText, runAction } from './voiceActions'
import { normalizeWav, recordCommand, speak, stopSpeaking, useVoice } from './voiceStore'
import { PcmPlayer, startMic, type Mic } from './liveAudio'

/**
 * Voice Mode: a spoken conversation. "Live" uses Gemini Live (real-time: streaming speech in,
 * spoken answers out, interruptions, follow-ups). "Basic" is the fallback when Live can't be used:
 * the app listens for one sentence at a time (offline Windows recognition), answers, speaks, and
 * listens again — it is NOT real-time and can't be interrupted by talking.
 */
export type VoiceModeStatus = 'off' | 'connecting' | 'listening' | 'thinking' | 'speaking' | 'reconnecting' | 'error'

export interface TranscriptEntry {
  role: 'user' | 'model'
  text: string
  done: boolean
}

interface VoiceModeSettings {
  /** IANA time zone for "what time is it"; empty = this computer's zone. */
  timezone: string
  /** The user agreed that Voice Mode streams microphone sound to Google (shown once). */
  consented: boolean
  showTranscript: boolean
}

const KEY = 'elc.voicemode.v1'
const DEFAULTS: VoiceModeSettings = { timezone: '', consented: false, showTranscript: false }
function load(): VoiceModeSettings {
  try {
    return { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<VoiceModeSettings>) }
  } catch {
    return DEFAULTS
  }
}

interface VoiceModeState {
  open: boolean
  /** Waiting for the one-time "this uses Google's servers" agreement. */
  askConsent: boolean
  mode: 'live' | 'basic' | null
  status: VoiceModeStatus
  model: string | null
  muted: boolean
  level: number
  error: { message: string; reason: LiveFailure | 'mic' } | null
  transcript: TranscriptEntry[]
  activity: { text: string; ok: boolean } | null
  settings: VoiceModeSettings
  setSettings: (s: Partial<VoiceModeSettings>) => void
}

export const useVoiceMode = create<VoiceModeState>((set, get) => ({
  open: false,
  askConsent: false,
  mode: null,
  status: 'off',
  model: null,
  muted: false,
  level: 0,
  error: null,
  transcript: [],
  activity: null,
  settings: load(),
  setSettings: (s) => {
    const settings = { ...get().settings, ...s }
    set({ settings })
    try {
      localStorage.setItem(KEY, JSON.stringify(settings))
    } catch {
      // this session only
    }
  }
}))

const patch = (p: Partial<VoiceModeState>): void => useVoiceMode.setState(p)
export const voiceModeActive = (): boolean => {
  const s = useVoiceMode.getState().status
  return s !== 'off' && s !== 'error'
}

let mic: Mic | null = null
let thinking = false
const player = new PcmPlayer((speaking) => {
  if (useVoiceMode.getState().mode !== 'live') return
  if (speaking) patch({ status: 'speaking' })
  else if (useVoiceMode.getState().status === 'speaking') patch({ status: thinking ? 'thinking' : 'listening' })
})

function addTranscript(role: 'user' | 'model', text: string): void {
  const list = [...useVoiceMode.getState().transcript]
  const last = list[list.length - 1]
  if (last && last.role === role && !last.done) list[list.length - 1] = { ...last, text: last.text + text }
  else list.push({ role, text: text.trimStart(), done: false })
  patch({ transcript: list.slice(-40) })
}
function closeTranscript(): void {
  patch({ transcript: useVoiceMode.getState().transcript.map((t) => (t.done ? t : { ...t, done: true })) })
}

/** Opens the Voice Mode panel (nothing is recorded until Start is pressed). */
export function openVoiceMode(): void {
  patch({ open: true })
}

/** Starts a conversation: Live when possible; asks once before sending the microphone to Google. */
export async function startVoiceMode(prefer: 'live' | 'basic' = 'live'): Promise<void> {
  if (voiceModeActive()) return
  const hasKey = !!useApp.getState().settings?.hasGeminiKey
  if (prefer === 'live' && !hasKey) {
    patch({ open: true, error: { message: 'Voice Mode (real-time) needs your free Gemini API key (Settings). You can use Basic voice mode without it.', reason: 'auth' } })
    return
  }
  if (prefer === 'live' && !useVoiceMode.getState().settings.consented) {
    patch({ open: true, askConsent: true })
    return
  }
  stopSpeaking()
  patch({ open: true, askConsent: false, error: null, activity: null, transcript: [], muted: false, mode: prefer, status: 'connecting', model: null })
  if (prefer === 'basic') return void basicLoop()
  // The microphone first: if it is blocked, no session is opened at all.
  try {
    mic = await startMic(
      (pcm) => void invoke('live:audio', pcm).catch(() => undefined),
      (level) => patch({ level })
    )
  } catch (err) {
    return micFailed(err)
  }
  try {
    const v = useVoice.getState().settings
    const { model } = await invoke('live:start', { city: v.city, timezone: useVoiceMode.getState().settings.timezone })
    if (useVoiceMode.getState().mode === 'live' && useVoiceMode.getState().status === 'connecting') patch({ status: 'listening', model })
  } catch (err) {
    stopLocal()
    // The reason comes with the "closed" event; keep the clearest message.
    if (!useVoiceMode.getState().error) patch({ status: 'error', error: { message: errorMessage(err), reason: 'other' } })
  }
}

function micFailed(err: unknown): void {
  stopLocal()
  const msg = errorMessage(err)
  patch({
    status: 'error',
    mode: null,
    level: 0,
    error: {
      reason: 'mic',
      message: /permission|notallowed|denied|not allowed|NotFound|could not start|Requested device/i.test(msg)
        ? 'The microphone is blocked or missing, so Voice Mode can’t listen. Everything else in the app still works — you can type in the chat instead.'
        : `The microphone could not start: ${msg}`
    }
  })
}

function stopLocal(): void {
  mic?.stop()
  mic = null
  player.stop()
  thinking = false
  basicStop?.()
  stopSpeaking()
}

/** Ends the conversation immediately: the microphone is released and nothing more is sent. */
export async function endVoiceMode(): Promise<void> {
  const wasLive = useVoiceMode.getState().mode === 'live'
  patch({ status: 'off', mode: null, level: 0, muted: false })
  stopLocal()
  closeTranscript()
  if (wasLive) await invoke('live:end').catch(() => undefined)
}

export function toggleMute(): void {
  const muted = !useVoiceMode.getState().muted
  patch({ muted, level: 0 })
  mic?.setMuted(muted)
  if (muted && useVoiceMode.getState().mode === 'live') void invoke('live:pause').catch(() => undefined)
}

/** Stops the answer being spoken (the conversation goes on). */
export function stopAnswer(): void {
  player.stop()
  stopSpeaking()
}

/** Typed into the live conversation (optional). */
export function sendTyped(text: string): void {
  if (useVoiceMode.getState().mode !== 'live' || !text.trim()) return
  addTranscript('user', text.trim())
  closeTranscript()
  thinking = true
  patch({ status: 'thinking' })
  void invoke('live:text', text.trim())
}

// ---- events from the Live session
function onLiveEvent(e: LiveEvent): void {
  const s = useVoiceMode.getState()
  if (s.mode !== 'live') return
  switch (e.type) {
    case 'state':
      if (e.state === 'open') patch({ status: player.speaking ? 'speaking' : 'listening', model: e.model ?? s.model })
      else if (e.state === 'reconnecting') patch({ status: 'reconnecting' })
      else if (e.state === 'closed') {
        stopLocal()
        closeTranscript()
        if (e.reason === 'ended' || !e.reason) patch({ status: 'off', mode: null, level: 0 })
        else patch({ status: 'error', mode: null, level: 0, error: { message: e.message ?? 'Voice Mode stopped.', reason: e.reason } })
      }
      return
    case 'audio':
      thinking = false
      player.play(e.data)
      return
    case 'transcript':
      addTranscript(e.role, e.text)
      if (e.role === 'user' && !player.speaking) {
        thinking = true
        patch({ status: 'thinking' })
      }
      return
    case 'interrupted':
      // The user started talking: stop the answer straight away.
      player.stop()
      thinking = false
      closeTranscript()
      patch({ status: 'listening' })
      return
    case 'turnComplete':
      thinking = false
      closeTranscript()
      if (!player.speaking && useVoiceMode.getState().status !== 'off') patch({ status: 'listening' })
      return
    case 'tool':
      if (e.status === 'running') {
        thinking = true
        if (!player.speaking) patch({ status: 'thinking' })
      } else patch({ activity: { text: activityText(e.name, e.args, e.result), ok: e.status === 'done' } })
      return
  }
}

function activityText(name: string, args: Record<string, string>, result?: Record<string, unknown>): string {
  const msg = typeof result?.message === 'string' ? result.message : typeof result?.error === 'string' ? result.error : ''
  const label: Record<string, string> = {
    get_current_time: 'Checked the time (this computer’s clock)',
    get_weather: `Checked the weather${args.city ? ` in ${args.city}` : ''} (Open-Meteo)`,
    get_selected_item: 'Read your selection',
    open_section: `Opened ${args.section?.replace('_', ' ')}`,
    start_revision: 'Started revision',
    save_selected_item: 'Saved the selection',
    add_selected_to_flashcards: 'Flashcard',
    show_mistakes: 'Your mistakes',
    end_voice_session: 'Ending Voice Mode'
  }
  return result?.ok === false ? msg || 'That didn’t work.' : msg && name !== 'get_weather' && name !== 'get_current_time' ? msg : (label[name] ?? name)
}

// ---- app tools the voice model may use (already validated in the main process; checked again here)
const SECTIONS: Record<string, { page: Page; label: string }> = {
  articles: { page: 'articles', label: 'Articles' },
  flashcards: { page: 'flashcards', label: 'Flashcards' },
  games: { page: 'games', label: 'Games' },
  notes: { page: 'notes', label: 'Notes' },
  movie: { page: 'movie', label: 'Movie Mode' },
  youtube: { page: 'youtube', label: 'YouTube' },
  practice: { page: 'room', label: 'Practice' },
  settings: { page: 'settings', label: 'Settings' },
  vocabulary_book: { page: 'vocabbook', label: 'Vocabulary Book Learning' }
}

export async function runLiveTool(name: string, args: Record<string, string>): Promise<Record<string, unknown>> {
  const app = useApp.getState()
  switch (name) {
    case 'get_selected_item': {
      const sel = currentSelection()
      if (!sel) return { ok: false, error: 'Nothing is selected. Ask the user to select a word or sentence in Movie Mode, YouTube, Articles or an explanation.' }
      return { ok: true, text: sel.text, original_sentence: sel.sentence, section: app.page, suggested_kind: sel.suggestedKind, from_chat_topic: !!sel.fromChat }
    }
    case 'open_section': {
      const target = SECTIONS[args.section]
      if (target === undefined) return { ok: false, error: 'Unknown section.' }
      app.setPage(target.page)
      return { ok: true, message: `Opened ${target.label}.` }
    }
    case 'start_revision': {
      const r = await runAction({ type: 'revision', start: true }, null)
      return { ok: !!r?.ok, message: r?.reply ?? '' }
    }
    case 'save_selected_item': {
      const sel = currentSelection()
      if (!sel || sel.fromChat) return { ok: false, error: 'Nothing is selected to save. Ask the user to select the word or sentence first.' }
      const r = await runAction({ type: 'save', kind: args.kind as never, label: 'your vocabulary collection (Notes)' }, sel)
      return { ok: !!r?.ok, message: r?.reply ?? '', collection: 'regular vocabulary collection (Notes) — Flashcards and Games use the same items' }
    }
    case 'add_selected_to_flashcards': {
      const sel = currentSelection()
      if (!sel || sel.fromChat) return { ok: false, error: 'Nothing is selected. Ask the user to select the word or phrase first.' }
      const r = await runAction({ type: 'flashcard' }, sel)
      return { ok: !!r?.ok, message: r?.reply ?? '' }
    }
    case 'show_mistakes':
      return showMistakes(args.word)
    case 'end_voice_session':
      return { ok: true, message: 'Voice Mode will end after your goodbye.' }
    default:
      return { ok: false, error: `Unknown tool "${name}".` }
  }
}

async function showMistakes(word?: string): Promise<Record<string, unknown>> {
  const w = !word || /^(this|it|that)( word| phrase)?$/i.test(word) ? currentSelection()?.text ?? word ?? '' : word
  const cards = await invoke('flashcards:list')
  const errors = useFsp.getState().stats.errors
  useIntents.getState().request({ flashcardsMode: 'dashboard' })
  useApp.getState().setPage('flashcards')
  if (w) {
    const key = normTerm(w)
    const card = cards.find((c) => normTerm(c.front) === key)
    const grammar = errors.filter((e) => normTerm(e.wrong).includes(key)).slice(-5)
    return {
      ok: true,
      word: w,
      flashcard: card ? { forgotten_times: card.lapses, reviews: card.reps, next_review: card.due.slice(0, 10), mastered: !!card.mastered } : 'no flashcard for this word',
      sentence_practice_mistakes: grammar.map((e) => ({ wrong: e.wrong, correct: e.fix, type: e.type, date: e.date })),
      message: `Opened Flashcards. Mistakes for “${w}”.`
    }
  }
  return {
    ok: true,
    most_forgotten: cards
      .filter((c) => c.lapses > 0)
      .sort((a, b) => b.lapses - a.lapses)
      .slice(0, 5)
      .map((c) => ({ word: c.front, forgotten_times: c.lapses })),
    top_grammar_mistakes_this_week: topMistakes(errors, fspToday()),
    message: 'Opened Flashcards with your revision overview.'
  }
}

// ---- Basic mode (fallback): one sentence at a time, offline recognition, spoken answers
let basicStop: (() => void) | null = null

async function basicLoop(): Promise<void> {
  patch({ mode: 'basic', status: 'listening' })
  let silent = 0
  while (useVoiceMode.getState().mode === 'basic') {
    patch({ status: 'listening' })
    const selection = currentSelection()
    let blob: Blob | null
    try {
      const rec = recordCommand()
      basicStop = rec.stop
      blob = await rec.done
    } catch (err) {
      basicStop = null
      return micFailed(err)
    }
    basicStop = null
    if (useVoiceMode.getState().mode !== 'basic') return
    if (!blob) {
      // Nothing said twice: pause instead of keeping the microphone on.
      if (++silent >= 2) return void patch({ mode: null, status: 'off', activity: { text: 'Paused: nothing heard. Press Start to talk again.', ok: true } })
      continue
    }
    silent = 0
    patch({ status: 'thinking' })
    try {
      const audioBase64 = normalizeWav(await recordingToWavBase64(blob))
      const hasKey = !!useApp.getState().settings?.hasGeminiKey
      const r = await invoke('voice:recognize', { audioBase64, allowGemini: hasKey && useVoice.getState().settings.gemini })
      if (useVoiceMode.getState().mode !== 'basic') return
      if (!r.text.trim()) {
        await say('Sorry, I didn’t catch that.')
        continue
      }
      addTranscript('user', r.text)
      closeTranscript()
      if (isWakeOnly(r.text)) {
        await say('Yes?')
        continue
      }
      await handleText(r.text, r.engine, selection)
      const reply = useVoice.getState().reply
      if (reply) {
        addTranscript('model', reply)
        closeTranscript()
      }
      patch({ status: 'speaking' })
      await speechDone()
    } catch (err) {
      patch({ activity: { text: errorMessage(err), ok: false } })
    }
  }
}

async function say(text: string): Promise<void> {
  patch({ status: 'speaking' })
  if (useVoice.getState().settings.speak) await speak(text)
}

/** Waits until the spoken answer (started by the command) has finished. */
async function speechDone(): Promise<void> {
  await new Promise((r) => setTimeout(r, 400))
  const until = Date.now() + 60_000
  while (window.speechSynthesis?.speaking && Date.now() < until && useVoiceMode.getState().mode === 'basic') await new Promise((r) => setTimeout(r, 150))
  await new Promise((r) => setTimeout(r, 250))
}

/** Subscribes once to the Live session's events and tool requests. */
export function initVoiceMode(): () => void {
  const offEvent = on('live:event', onLiveEvent)
  const offTool = on('live:toolCall', ({ callId, name, args }) => {
    void runLiveTool(name, args)
      .catch((err) => ({ ok: false, error: errorMessage(err) }))
      .then((result) => invoke('live:toolResult', { callId, result }))
  })
  return () => {
    offEvent()
    offTool()
  }
}
