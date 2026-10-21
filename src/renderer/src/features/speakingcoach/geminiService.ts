/**
 * Speaking Coach: EVERY Gemini call of this section lives in this one file.
 *
 * Beta setup: the browser calls the Gemini REST API directly with the key you paste in the section's
 * Settings box (kept in localStorage, never in the code). To move to a backend / paid key later, change
 * only this file: keep the exported functions and make them call your server instead.
 */
import { completeSegments, validateSegments, type RawSegment } from './transcriptFormat'

/** The one place to change the model. Same alias as the rest of the app: always the current Flash model (free tier, accepts audio). */
export const SPEAKING_COACH_MODEL = 'gemini-flash-latest'

/**
 * When a model's free limit is used up (429), the transcript goes to the next free model at once
 * (each model has its own free limit) instead of waiting a minute. Only when all of them are limited
 * does it wait and try again.
 */
const TRANSCRIBE_MODELS = [SPEAKING_COACH_MODEL, 'gemini-flash-lite-latest', 'gemini-2.5-flash', 'gemini-2.5-flash-lite']
/** Model → time (ms) until which it is known to be rate-limited or unavailable. */
const limitedUntil = new Map<string, number>()

const API = 'https://generativelanguage.googleapis.com'
const KEY_STORAGE = 'elc.speakingCoach.geminiKey'
/** Above this, audio can't be sent inline (only used if the File API upload isn't available). */
const INLINE_LIMIT = 18 * 1024 * 1024
/**
 * Up to this size a part is sent inside the request itself (one request instead of upload → wait →
 * transcribe → delete). Base64 makes it ~4/3 larger, which stays under Gemini's 20 MB request limit.
 * Every part this section makes (≤ 10 min of 32 kbps mono MP3 ≈ 2.4 MB) fits.
 */
const INLINE_FAST_LIMIT = 14 * 1024 * 1024
const MAX_RETRIES = 3

// ---------- API key (localStorage) ----------

export function getApiKey(): string | null {
  try {
    return localStorage.getItem(KEY_STORAGE)?.trim() || null
  } catch {
    return null
  }
}

export function setApiKey(key: string | null): void {
  if (key && key.trim()) localStorage.setItem(KEY_STORAGE, key.trim())
  else localStorage.removeItem(KEY_STORAGE)
}

// ---------- Errors and retries ----------

export type GeminiErrorKind = 'rate_limit' | 'busy' | 'auth' | 'model' | 'invalid_json' | 'network' | 'blocked' | 'bad_request' | 'other'

export class GeminiError extends Error {
  constructor(
    message: string,
    readonly kind: GeminiErrorKind,
    readonly retryAfterSec?: number
  ) {
    super(message)
    this.name = 'GeminiError'
  }
}

export function isAbortError(err: unknown): boolean {
  return (err as { name?: string } | null)?.name === 'AbortError'
}

/** Shown while waiting before an automatic retry. */
export interface WaitInfo {
  secondsLeft: number
  attempt: number
  maxAttempts: number
  reason: 'rate_limit' | 'busy'
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException('Stopped', 'AbortError'))
    const onAbort = (): void => {
      clearTimeout(timer)
      reject(new DOMException('Stopped', 'AbortError'))
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

/** Runs fn; on a rate limit (429) or busy server (5xx) waits and tries again, up to 3 times. */
async function withRetries<T>(fn: () => Promise<T>, signal?: AbortSignal, onWait?: (w: WaitInfo) => void): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn()
    } catch (err) {
      if (!(err instanceof GeminiError) || (err.kind !== 'rate_limit' && err.kind !== 'busy')) throw err
      if (attempt >= MAX_RETRIES) {
        if (err.kind === 'rate_limit') throw err
        throw new GeminiError('Gemini is busy right now. Try again in a minute.', 'busy')
      }
      const fallback = err.kind === 'rate_limit' ? [15, 30, 60][attempt] : [5, 15, 30][attempt]
      const wait = Math.min(60, Math.max(3, Math.ceil(err.retryAfterSec ?? fallback)))
      for (let left = wait; left > 0; left--) {
        onWait?.({ secondsLeft: left, attempt: attempt + 1, maxAttempts: MAX_RETRIES, reason: err.kind })
        await sleep(1000, signal)
      }
    }
  }
}

/** Turns a failed HTTP response into a GeminiError with a plain-English message. */
async function toGeminiError(res: Response): Promise<GeminiError> {
  let body: { error?: { message?: string; status?: string; details?: { '@type'?: string; retryDelay?: string; reason?: string }[] } } = {}
  try {
    body = await res.json()
  } catch {
    // not JSON
  }
  const msg = body.error?.message ?? res.statusText
  const details = body.error?.details ?? []
  const retry = details.find((d) => d['@type']?.endsWith('RetryInfo'))?.retryDelay
  const retryAfterSec = retry ? parseFloat(retry) : undefined
  if (res.status === 429) {
    // Say which limit it was (Gemini names it in the message): none for this model, per day, or per minute.
    const which = /limit: ?0/.test(msg) ? 'this model has no free quota for your key' : /per ?day|PerDay/i.test(msg) ? 'daily free limit used up' : 'per-minute free limit'
    return new GeminiError(`Free limit reached (${which}). Try again in a few minutes.`, 'rate_limit', retryAfterSec)
  }
  if (res.status >= 500) return new GeminiError('Gemini is busy right now. Try again in a minute.', 'busy', retryAfterSec)
  const keyProblem = details.some((d) => d.reason === 'API_KEY_INVALID') || /api key/i.test(msg)
  if (keyProblem || res.status === 401 || res.status === 403) return new GeminiError('Gemini rejected your API key. Check it in Settings.', 'auth')
  if (res.status === 404) return new GeminiError(`Gemini model "${SPEAKING_COACH_MODEL}" was not found. Change SPEAKING_COACH_MODEL in geminiService.ts.`, 'model')
  return new GeminiError(`Gemini error (${res.status}): ${msg}`, res.status === 400 ? 'bad_request' : 'other')
}

async function call(url: string, init: RequestInit, signal?: AbortSignal): Promise<Response> {
  let res: Response
  try {
    res = await fetch(url, { ...init, signal })
  } catch (err) {
    if (isAbortError(err)) throw err
    throw new GeminiError("Couldn't reach Gemini. Check your internet connection.", 'network')
  }
  if (!res.ok) throw await toGeminiError(res)
  return res
}

function requireKey(): string {
  const key = getApiKey()
  if (!key) throw new GeminiError('Paste your Gemini API key in Settings first.', 'auth')
  return key
}

// ---------- File API ----------

interface UploadedFile {
  name: string
  uri: string
  mimeType: string
  state?: string
}

/** Uploads audio with the Gemini File API (resumable upload). Null when this browser can't use the upload URL. */
async function uploadFile(audio: Blob, mimeType: string, displayName: string, signal?: AbortSignal): Promise<UploadedFile | null> {
  const key = requireKey()
  const start = await call(
    `${API}/upload/v1beta/files`,
    {
      method: 'POST',
      headers: {
        'x-goog-api-key': key,
        'X-Goog-Upload-Protocol': 'resumable',
        'X-Goog-Upload-Command': 'start',
        'X-Goog-Upload-Header-Content-Length': String(audio.size),
        'X-Goog-Upload-Header-Content-Type': mimeType,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ file: { display_name: displayName } })
    },
    signal
  )
  const uploadUrl = start.headers.get('x-goog-upload-url')
  if (!uploadUrl) return null
  const done = await call(
    uploadUrl,
    {
      method: 'POST',
      headers: { 'X-Goog-Upload-Offset': '0', 'X-Goog-Upload-Command': 'upload, finalize' },
      body: audio
    },
    signal
  )
  const json = (await done.json()) as { file?: UploadedFile }
  if (!json.file?.uri) throw new GeminiError('Gemini did not accept the audio upload.', 'other')
  return json.file
}

/** Waits until an uploaded file is ACTIVE (audio usually is right away). */
async function waitUntilActive(file: UploadedFile, signal?: AbortSignal): Promise<void> {
  const key = requireKey()
  let state = file.state
  for (let i = 0; state !== 'ACTIVE'; i++) {
    if (state === 'FAILED') throw new GeminiError('Gemini could not process this audio part.', 'other')
    if (i >= 150) throw new GeminiError('Gemini took too long to process the audio. Retry this part.', 'busy')
    await sleep(2000, signal)
    const res = await call(`${API}/v1beta/${file.name}`, { headers: { 'x-goog-api-key': key } }, signal)
    state = ((await res.json()) as { state?: string }).state
  }
}

/** Uploaded files expire after 48 h anyway; this just tidies up straight away. */
function deleteUploadedFile(name: string): void {
  const key = getApiKey()
  if (key) void fetch(`${API}/v1beta/${name}`, { method: 'DELETE', headers: { 'x-goog-api-key': key } }).catch(() => undefined)
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '')
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

// ---------- generateContent ----------

type Part = { text: string } | { fileData: { mimeType: string; fileUri: string } } | { inlineData: { mimeType: string; data: string } }

/** One generateContent call that must answer JSON. Returns the raw JSON text. */
async function generateJsonText(parts: Part[], responseSchema: object, signal?: AbortSignal, model = SPEAKING_COACH_MODEL): Promise<string> {
  const key = requireKey()
  const res = await call(
    `${API}/v1beta/models/${model}:generateContent`,
    {
      method: 'POST',
      headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts }],
        generationConfig: { responseMimeType: 'application/json', responseSchema }
      })
    },
    signal
  )
  const json = (await res.json()) as {
    promptFeedback?: { blockReason?: string }
    candidates?: { finishReason?: string; content?: { parts?: { text?: string; thought?: boolean }[] } }[]
  }
  if (json.promptFeedback?.blockReason) throw new GeminiError(`Gemini refused this audio (${json.promptFeedback.blockReason}).`, 'blocked')
  const text = (json.candidates?.[0]?.content?.parts ?? [])
    .filter((p) => typeof p.text === 'string' && !p.thought)
    .map((p) => p.text)
    .join('')
  if (!text.trim()) throw new GeminiError('Gemini returned an empty answer.', 'invalid_json')
  return text
}

// ---------- CALL 1: verbatim transcription ----------

const TRANSCRIBE_PROMPT =
  'You are a strict verbatim transcriber. Transcribe this audio EXACTLY as spoken. Keep every grammar mistake, wrong word, wrong tense, missing article, repetition, false start, self-correction and filler (um, uh, like, you know). Do NOT correct, improve, paraphrase or summarize anything, even if it sounds wrong. If a word is unclear write [unclear]. Return JSON only: {"segments":[{"start":"mm:ss","end":"mm:ss","text":"..."}]}. One segment per sentence or natural pause.'

const SEGMENTS_SCHEMA = {
  type: 'OBJECT',
  properties: {
    segments: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: { start: { type: 'STRING' }, end: { type: 'STRING' }, text: { type: 'STRING' } },
        required: ['start', 'end', 'text'],
        propertyOrdering: ['start', 'end', 'text']
      }
    }
  },
  required: ['segments']
}

export interface TranscribeOptions {
  signal?: AbortSignal
  onStage?: (stage: 'uploading' | 'transcribing') => void
  onWait?: (w: WaitInfo) => void
  /** Lines already finished while Gemini is still writing (times relative to the part). */
  onPartial?: (segments: RawSegment[]) => void
}

/** Where the time of one part went (milliseconds, measured). */
export interface PartTiming {
  /** inline = sent inside the request; upload = File API upload + wait + transcribe. */
  route: 'inline' | 'upload'
  thinking: ThinkingMode
  /** Preparing the audio for the request (base64) or uploading it and waiting until it is ready. */
  sendMs: number
  /** From asking for the transcript until the first words arrived. */
  firstTextMs: number | null
  /** The whole part, start to end. */
  totalMs: number
}

/**
 * Thinking is not needed to write down speech and makes long answers much slower, so it is switched
 * off first; if the model refuses that, "minimal", and only then the model's default. The accepted
 * setting is remembered for the session.
 */
export type ThinkingMode = 'off' | 'minimal' | 'default'
const THINKING: { mode: ThinkingMode; config?: object }[] = [{ mode: 'off', config: { thinkingBudget: 0 } }, { mode: 'minimal', config: { thinkingLevel: 'MINIMAL' } }, { mode: 'default' }]
const acceptedThinking = new Map<string, number>()
const thinkingRejected = (err: unknown): boolean =>
  err instanceof GeminiError && err.kind === 'bad_request' && /thinking|budget|level|not supported|unsupported|invalid/i.test(err.message)

/** Streams one JSON answer (Server-Sent Events), calling onText with the text so far. Returns the full text. */
async function streamJsonText(
  parts: Part[],
  responseSchema: object,
  thinkingConfig: object | undefined,
  signal: AbortSignal | undefined,
  onText: (soFar: string) => void,
  model = SPEAKING_COACH_MODEL
): Promise<string> {
  const key = requireKey()
  const res = await call(
    `${API}/v1beta/models/${model}:streamGenerateContent?alt=sse`,
    {
      method: 'POST',
      headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts }],
        generationConfig: { responseMimeType: 'application/json', responseSchema, ...(thinkingConfig ? { thinkingConfig } : {}) }
      })
    },
    signal
  )
  if (!res.body) return generateJsonText(parts, responseSchema, signal, model)
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let text = ''
  for (;;) {
    let chunk: ReadableStreamReadResult<Uint8Array>
    try {
      chunk = await reader.read()
    } catch (err) {
      if (isAbortError(err)) throw err
      throw new GeminiError("Couldn't reach Gemini. Check your internet connection.", 'network')
    }
    if (chunk.done) break
    buffer += decoder.decode(chunk.value, { stream: true })
    let nl: number
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl).trim()
      buffer = buffer.slice(nl + 1)
      if (!line.startsWith('data:')) continue
      let json: { promptFeedback?: { blockReason?: string }; candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] } }[] }
      try {
        json = JSON.parse(line.slice(5))
      } catch {
        continue
      }
      if (json.promptFeedback?.blockReason) throw new GeminiError(`Gemini refused this audio (${json.promptFeedback.blockReason}).`, 'blocked')
      const add = (json.candidates?.[0]?.content?.parts ?? [])
        .filter((p) => typeof p.text === 'string' && !p.thought)
        .map((p) => p.text)
        .join('')
      if (add) {
        text += add
        onText(text)
      }
    }
  }
  if (!text.trim()) throw new GeminiError('Gemini returned an empty answer.', 'invalid_json')
  return text
}

/** Streams with thinking off (or the lightest setting this model accepts). */
async function transcriptTextWith(model: string, parts: Part[], signal: AbortSignal | undefined, onText: (soFar: string) => void): Promise<{ text: string; thinking: ThinkingMode }> {
  for (let i = acceptedThinking.get(model) ?? 0; ; i++) {
    try {
      const text = await streamJsonText(parts, SEGMENTS_SCHEMA, THINKING[i].config, signal, onText, model)
      acceptedThinking.set(model, i)
      return { text, thinking: THINKING[i].mode }
    } catch (err) {
      if (i < THINKING.length - 1 && thinkingRejected(err)) continue
      throw err
    }
  }
}

/**
 * The first free model that isn't rate-limited writes the transcript. A model that answers 429 (or
 * doesn't exist for this key) is skipped at once and the next one is asked. If every model is limited,
 * the shortest wait Gemini asked for is passed on, so the caller waits once and tries again.
 */
async function transcriptText(parts: Part[], signal: AbortSignal | undefined, onText: (soFar: string) => void): Promise<{ text: string; thinking: ThinkingMode; model: string }> {
  let soonest: number | undefined
  let lastLimit: GeminiError | null = null
  const now = Date.now()
  const ready = TRANSCRIBE_MODELS.filter((m) => (limitedUntil.get(m) ?? 0) <= now)
  for (const model of ready.length ? ready : TRANSCRIBE_MODELS) {
    try {
      const r = await transcriptTextWith(model, parts, signal, onText)
      return { ...r, model }
    } catch (err) {
      if (!(err instanceof GeminiError) || (err.kind !== 'rate_limit' && err.kind !== 'model')) throw err
      const sec = err.kind === 'model' ? 3600 : (err.retryAfterSec ?? 60)
      limitedUntil.set(model, Date.now() + sec * 1000)
      if (err.kind === 'rate_limit') {
        lastLimit = err
        soonest = Math.min(soonest ?? Infinity, sec)
      }
    }
  }
  throw new GeminiError(`Free limit reached on every free Gemini model (${lastLimit?.message.match(/\((.*?)\)/)?.[1] ?? 'rate limit'}). Try again in a few minutes.`, 'rate_limit', lastLimit ? soonest : 60)
}

/**
 * Transcribes one audio part (≤ ~10 min) word for word. Times in the result are relative to the part.
 * Small parts go inside the request; bigger ones are uploaded (File API) first. The answer is streamed,
 * so finished lines can be shown while Gemini is still writing; the full JSON is then validated as
 * before (asked for once more if broken).
 */
export async function transcribeAudioPart(audio: Blob, mimeType: string, displayName: string, opts: TranscribeOptions = {}): Promise<{ segments: RawSegment[]; timing: PartTiming }> {
  const { signal, onStage, onWait, onPartial } = opts
  const t0 = performance.now()
  let uploaded: UploadedFile | null = null
  let audioPart: Part
  let route: PartTiming['route'] = 'inline'
  if (audio.size <= INLINE_FAST_LIMIT) {
    audioPart = { inlineData: { mimeType, data: await blobToBase64(audio) } }
  } else {
    route = 'upload'
    onStage?.('uploading')
    try {
      uploaded = await withRetries(() => uploadFile(audio, mimeType, displayName, signal), signal, onWait)
    } catch (err) {
      // Only if the upload itself can't be reached from this window: small parts can still be sent inline.
      if (!(err instanceof GeminiError && err.kind === 'network') || audio.size > INLINE_LIMIT) throw err
    }
    if (uploaded) {
      await waitUntilActive(uploaded, signal)
      audioPart = { fileData: { mimeType: uploaded.mimeType || mimeType, fileUri: uploaded.uri } }
    } else {
      if (audio.size > INLINE_LIMIT) throw new GeminiError('Could not upload the audio to Gemini.', 'network')
      audioPart = { inlineData: { mimeType, data: await blobToBase64(audio) } }
    }
  }
  const sendMs = performance.now() - t0
  try {
    onStage?.('transcribing')
    for (let attempt = 0; ; attempt++) {
      const asked = performance.now()
      let firstTextMs: number | null = null
      let shown = 0
      const result = await withRetries(
        () =>
          transcriptText([audioPart, { text: TRANSCRIBE_PROMPT }], signal, (soFar) => {
            firstTextMs ??= performance.now() - asked
            const partial = completeSegments(soFar)
            if (partial.length > shown) {
              shown = partial.length
              onPartial?.(partial)
            }
          }),
        signal,
        onWait
      ).catch((err) => {
        if (err instanceof GeminiError && err.kind === 'invalid_json') return null
        throw err
      })
      let parsed: unknown = null
      try {
        parsed = result ? JSON.parse(result.text) : null
      } catch {
        // broken JSON → retry below
      }
      const segments = validateSegments(parsed)
      if (segments && result) return { segments, timing: { route, thinking: result.thinking, sendMs, firstTextMs, totalMs: performance.now() - t0 } }
      if (attempt >= 1) throw new GeminiError('Gemini returned an unreadable transcript twice. Retry this part.', 'invalid_json')
    }
  } finally {
    if (uploaded) deleteUploadedFile(uploaded.name)
  }
}

/** Settings box "Test key": checks the key works and the model exists. */
export async function testApiKey(): Promise<void> {
  const key = requireKey()
  await call(`${API}/v1beta/models/${SPEAKING_COACH_MODEL}`, { headers: { 'x-goog-api-key': key } })
}
