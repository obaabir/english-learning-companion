import { GoogleGenAI, Modality, type LiveServerMessage, type Session } from '@google/genai'
import { liveFunctionDeclarations, LIVE_SYSTEM_INSTRUCTION, validateToolCall, type LiveEvent, type LiveFailure } from '@shared/liveTools'

/**
 * Voice Mode: a real-time spoken conversation with the Gemini Live API. Runs in the main process so
 * the API key never reaches the window. The window streams microphone sound (16 kHz PCM) here and
 * plays the spoken answers (24 kHz PCM) sent back. Live models are tried in order; one that this
 * key can't use is skipped. A connection lasts about 10 minutes: it is resumed automatically.
 */
export const LIVE_MODELS = ['gemini-3.8-live', 'gemini-3.1-flash-live-preview', 'gemini-2.5-flash-native-audio-preview-12-2025']

export class LiveError extends Error {
  constructor(
    message: string,
    readonly reason: LiveFailure
  ) {
    super(message)
  }
}

/** Sorts a Live API refusal into something the user can act on. */
export function classifyLiveError(text: string): LiveError {
  const t = text || 'The connection closed.'
  if (/billing|payment|prepay/i.test(t)) return new LiveError('Google says this voice model needs billing on your Google project. Nothing was enabled. Use Basic voice mode instead (free).', 'billing')
  if (/quota|RESOURCE_EXHAUSTED|429|exceeded|rate limit/i.test(t))
    return new LiveError('The free Gemini Live quota is used up for now (it resets later). Basic voice mode still works.', 'quota')
  if (/api key|API_KEY|PERMISSION_DENIED|unauthenticated|401|403/i.test(t)) return new LiveError('Gemini refused the API key. Check it in Settings.', 'auth')
  if (/not found|not supported|unsupported|is not available|404|invalid model|model/i.test(t)) return new LiveError(`This voice model isn't available for your key (${t.slice(0, 120)}).`, 'model')
  if (/ENOTFOUND|ECONN|EAI_AGAIN|network|timed? ?out|socket|getaddrinfo|1006/i.test(t)) return new LiveError("Couldn't reach Gemini Live (check the internet connection).", 'network')
  return new LiveError(`Gemini Live stopped: ${t.slice(0, 160)}`, 'other')
}

export interface LiveDeps {
  getKey: () => string | null
  emit: (e: LiveEvent) => void
  /** Runs a validated tool call and returns its result for the model. */
  runTool: (name: string, args: Record<string, string>) => Promise<Record<string, unknown>>
  /** Tests only: a local fake Live server instead of Google. */
  baseUrl?: string
  models?: string[]
}

export class LiveVoice {
  private session: Session | null = null
  private model: string | null = null
  private handle: string | null = null
  private active = false
  /** Bumped on every (re)connection so late events from an old connection are ignored. */
  private generation = 0
  private reconnecting = false

  constructor(private readonly deps: LiveDeps) {}

  get running(): boolean {
    return this.active
  }

  /** Opens a session with the first Live model this key can use. */
  async start(): Promise<{ model: string }> {
    if (this.active) await this.end('restart')
    const key = this.deps.getKey()
    if (!key) throw new LiveError('Add your Gemini API key in Settings to use Voice Mode.', 'auth')
    this.active = true
    this.handle = null
    this.deps.emit({ type: 'state', state: 'connecting' })
    let last: LiveError | null = null
    for (const model of this.deps.models ?? LIVE_MODELS) {
      try {
        this.session = await this.connect(model, null)
        this.model = model
        this.deps.emit({ type: 'state', state: 'open', model })
        return { model }
      } catch (err) {
        last = err instanceof LiveError ? err : classifyLiveError(err instanceof Error ? err.message : String(err))
        if (!this.active) break
        if (last.reason !== 'model') break
      }
    }
    this.active = false
    const error = last ?? new LiveError('No Gemini Live model is available for this key.', 'model')
    this.deps.emit({ type: 'state', state: 'closed', reason: error.reason, message: error.message })
    throw error
  }

  sendAudio(base64Pcm16k: string): void {
    if (!this.active || this.reconnecting) return
    try {
      this.session?.sendRealtimeInput({ audio: { data: base64Pcm16k, mimeType: 'audio/pcm;rate=16000' } })
    } catch {
      // the connection is closing; the close handler reports it
    }
  }

  /** Muting: tells the model the microphone stream has paused (so it answers what it already heard). */
  pauseAudio(): void {
    if (!this.active) return
    try {
      this.session?.sendRealtimeInput({ audioStreamEnd: true })
    } catch {
      // ignore
    }
  }

  /** A typed message in the same conversation (for when speaking isn't possible). */
  sendText(text: string): void {
    if (!this.active || !text.trim()) return
    this.session?.sendRealtimeInput({ text: text.trim().slice(0, 2000) })
  }

  async end(why: 'user' | 'restart' | 'quit' = 'user'): Promise<void> {
    const was = this.active
    this.active = false
    this.generation++
    const s = this.session
    this.session = null
    this.handle = null
    try {
      s?.close()
    } catch {
      // already closed
    }
    if (was && why !== 'restart') this.deps.emit({ type: 'state', state: 'closed', reason: 'ended' })
  }

  private connect(model: string, handle: string | null): Promise<Session> {
    const gen = ++this.generation
    const ai = new GoogleGenAI({ apiKey: this.deps.getKey() ?? '', ...(this.deps.baseUrl ? { httpOptions: { baseUrl: this.deps.baseUrl } } : {}) })
    return new Promise<Session>((resolve, reject) => {
      let ready = false
      const fail = (err: LiveError): void => {
        if (ready) return
        ready = true
        clearTimeout(timer)
        reject(err)
      }
      // connect() waits for the server's "setup complete", which never comes if the server refuses.
      const timer = setTimeout(() => fail(new LiveError("Gemini Live didn't answer in time (check the internet connection).", 'network')), 20_000)
      ai.live
        .connect({
          model,
          config: {
            responseModalities: [Modality.AUDIO],
            systemInstruction: LIVE_SYSTEM_INSTRUCTION,
            inputAudioTranscription: {},
            outputAudioTranscription: {},
            tools: [{ functionDeclarations: liveFunctionDeclarations() as never }],
            // Longer than the 15-minute limit: older parts of the conversation are condensed.
            contextWindowCompression: { slidingWindow: {} },
            sessionResumption: handle ? { handle } : {}
          },
          callbacks: {
            onmessage: (m) => {
              if (gen === this.generation) void this.onMessage(m, gen)
            },
            onerror: (e) => {
              const msg = (e as { message?: string })?.message ?? 'connection error'
              if (!ready) fail(classifyLiveError(msg))
            },
            onclose: (e) => {
              const reason = `${(e as { reason?: string })?.reason ?? ''} ${(e as { code?: number })?.code ?? ''}`.trim()
              if (!ready) return fail(classifyLiveError(reason))
              if (gen === this.generation) void this.onClosed(reason)
            }
          }
        })
        .then((session) => {
          if (ready) {
            // Too late (timed out or ended meanwhile).
            session.close()
            return
          }
          ready = true
          clearTimeout(timer)
          if (!this.active) {
            session.close()
            return reject(new LiveError('Voice Mode was ended.', 'ended'))
          }
          resolve(session)
        })
        .catch((err) => fail(classifyLiveError(err instanceof Error ? err.message : String(err))))
    })
  }

  private async onMessage(m: LiveServerMessage, gen: number): Promise<void> {
    const sc = m.serverContent
    if (sc) {
      if (sc.interrupted) this.deps.emit({ type: 'interrupted' })
      if (sc.inputTranscription?.text) this.deps.emit({ type: 'transcript', role: 'user', text: sc.inputTranscription.text })
      for (const p of sc.modelTurn?.parts ?? []) {
        if (p.inlineData?.data && /audio/i.test(p.inlineData.mimeType ?? 'audio/pcm')) this.deps.emit({ type: 'audio', data: p.inlineData.data })
      }
      if (sc.outputTranscription?.text) this.deps.emit({ type: 'transcript', role: 'model', text: sc.outputTranscription.text })
      if (sc.turnComplete) this.deps.emit({ type: 'turnComplete' })
    }
    if (m.sessionResumptionUpdate?.resumable && m.sessionResumptionUpdate.newHandle) this.handle = m.sessionResumptionUpdate.newHandle
    if (m.goAway) void this.reconnect()
    if (m.toolCall?.functionCalls?.length) {
      const responses = []
      for (const call of m.toolCall.functionCalls) {
        const check = validateToolCall(call.name, call.args)
        let response: Record<string, unknown>
        if (!check.ok) response = { ok: false, error: check.error }
        else {
          this.deps.emit({ type: 'tool', name: check.name, args: check.args, status: 'running' })
          try {
            response = await this.deps.runTool(check.name, check.args)
          } catch (err) {
            response = { ok: false, error: err instanceof Error ? err.message : String(err) }
          }
          this.deps.emit({ type: 'tool', name: check.name, args: check.args, status: response.ok === false ? 'error' : 'done', result: response })
        }
        responses.push({ id: call.id, name: call.name, response })
      }
      if (gen !== this.generation || !this.active) return
      try {
        this.session?.sendToolResponse({ functionResponses: responses })
      } catch {
        // connection closed meanwhile
      }
      if (responses.some((r) => r.name === 'end_voice_session' && (r.response as { ok?: boolean }).ok !== false)) {
        // Let the goodbye be spoken first.
        setTimeout(() => void this.end('user'), 4000)
      }
    }
  }

  /** The server is about to close this connection (time limit): continue on a new one. */
  private async reconnect(): Promise<void> {
    if (!this.active || this.reconnecting || !this.model) return
    this.reconnecting = true
    this.deps.emit({ type: 'state', state: 'reconnecting', model: this.model })
    const old = this.session
    try {
      this.session = await this.connect(this.model, this.handle)
      try {
        old?.close()
      } catch {
        // ignore
      }
      this.deps.emit({ type: 'state', state: 'open', model: this.model })
    } catch (err) {
      const e = err instanceof LiveError ? err : classifyLiveError(String(err))
      this.active = false
      this.deps.emit({ type: 'state', state: 'closed', reason: e.reason, message: e.message })
    } finally {
      this.reconnecting = false
    }
  }

  private async onClosed(reason: string): Promise<void> {
    if (!this.active || this.reconnecting) return
    // Closed by the server: resume the same conversation once if possible.
    if (this.handle && !/quota|RESOURCE_EXHAUSTED|billing|PERMISSION/i.test(reason)) return this.reconnect()
    const e = classifyLiveError(reason)
    this.active = false
    this.session = null
    this.deps.emit({ type: 'state', state: 'closed', reason: e.reason, message: e.message })
  }
}
