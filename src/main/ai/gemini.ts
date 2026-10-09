import { GoogleGenAI, MediaResolution, ThinkingLevel, type Content, type Schema, type ThinkingConfig } from '@google/genai'
import type { FlashcardBack, Note, NoteData, StudyContext } from '@shared/types'
import { EXTRACT_INSTRUCTION, FLASHCARD_INSTRUCTION, FLASHCARDS_SCHEMA, NOTE_DATA_SCHEMA, TRANSCRIPT_INSTRUCTION, TRANSCRIPT_SCHEMA } from './schemas'

export const DEFAULT_MODEL = 'gemini-flash-latest'

/** Builds the user message for an Explain / Chat request from the selection and its movie context. */
export function buildStudyMessage(ctx: StudyContext): string {
  const parts = [`Text: "${ctx.text.trim()}"`]
  if (ctx.sentence && ctx.sentence.trim() !== ctx.text.trim()) {
    parts.push(`It comes from this sentence: "${ctx.sentence.trim()}"`)
  }
  if (ctx.before?.length) parts.push(`Previous lines:\n${ctx.before.map((l) => `- ${l}`).join('\n')}`)
  if (ctx.after?.length) parts.push(`Next lines:\n${ctx.after.map((l) => `- ${l}`).join('\n')}`)
  if (ctx.mediaTitle) parts.push(`Source: ${ctx.mediaTitle}`)
  return parts.join('\n\n')
}

/** Temporary server-side failures worth retrying: overloaded model (503), rate limit (429), gateway errors. */
export function isBusyError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err)
  return /\b(500|502|503|504|429)\b|UNAVAILABLE|RESOURCE_EXHAUSTED|overloaded|high demand|try again later/i.test(msg)
}

/** Retries fn on busy errors with exponential backoff (1.5 s, then 3 s by default). */
export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  opts: { delaysMs?: number[]; canRetry?: () => boolean } = {}
): Promise<T> {
  const delays = opts.delaysMs ?? [1500, 3000]
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn(attempt)
    } catch (err) {
      if (attempt >= delays.length || !isBusyError(err) || (opts.canRetry && !opts.canRetry())) throw err
      await new Promise((r) => setTimeout(r, delays[attempt]))
    }
  }
}

/** Pulls the innermost "message" out of a JSON-looking API error, so raw JSON is never shown. */
export function apiErrorMessage(msg: string): string | null {
  const matches = [...msg.matchAll(/"message"\s*:\s*"((?:[^"\\]|\\.)*)"/g)]
  const last = matches.at(-1)?.[1]
  if (!last) return null
  return last.replace(/\\+[nt]/g, ' ').replace(/\\+"/g, '"').replace(/\s+/g, ' ').trim()
}

export function friendlyError(err: unknown): Error {
  const msg = err instanceof Error ? err.message : String(err)
  if (/\b503\b|UNAVAILABLE|overloaded|high demand/i.test(msg)) {
    return new Error("Gemini is very busy right now (Google's servers are overloaded). The app already retried. Please try again in a minute.")
  }
  if (/API key not valid|API_KEY_INVALID/i.test(msg)) return new Error('Your Gemini API key is not valid. Check it in Settings.')
  // Newer "AQ." keys from AI Studio are sometimes rejected this way on some accounts.
  if (/ACCESS_TOKEN_TYPE_UNSUPPORTED|UNAUTHENTICATED|\b401\b/i.test(msg)) {
    return new Error(
      'Google rejected this API key (401). Copy the key again with the "Copy key" button and re-save it. If it still fails, delete the key in AI Studio and create a new one.'
    )
  }
  if (/not found|is not supported/i.test(msg) && /model/i.test(msg)) {
    return new Error('That Gemini model is not available. Pick another model in Settings.')
  }
  if (/quota|RESOURCE_EXHAUSTED|\b429\b/i.test(msg)) return new Error('Gemini rate limit or quota reached. Wait a moment and try again.')
  const inner = apiErrorMessage(msg)
  if (inner) return new Error(`Gemini error: ${inner}`)
  return err instanceof Error ? err : new Error(msg)
}

/** "Fast" settings tried in order: no thinking, minimal thinking, then the model's default. */
const FAST_MODES: (ThinkingConfig | undefined)[] = [{ thinkingBudget: 0 }, { thinkingLevel: ThinkingLevel.MINIMAL }, undefined]

/** True when the API rejected a thinking setting (the model doesn't support it). */
export function isThinkingConfigError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err)
  return /thinking|budget/i.test(msg) && /invalid|not supported|unsupported|only works|INVALID_ARGUMENT|\b400\b/i.test(msg)
}

/** Transcript request variants, from fastest/most precise to most basic. */
export const TRANSCRIPT_VARIANTS = [
  { noThinking: true, lowRes: true, clip: true, schema: true },
  { noThinking: false, lowRes: true, clip: true, schema: true },
  { noThinking: false, lowRes: false, clip: true, schema: true },
  { noThinking: false, lowRes: false, clip: false, schema: true },
  { noThinking: false, lowRes: false, clip: false, schema: false }
]

export function isInvalidArgument(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err)
  return /INVALID_ARGUMENT|invalid argument|\b400\b/i.test(msg)
}

/** Reads the transcript array from Gemini's reply (plain JSON or inside a code block). */
export function parseTranscriptJson(text: string | undefined): { start: number; end?: number; text: string }[] {
  const raw = (text ?? '').trim()
  const json = raw.startsWith('[') ? raw : (raw.match(/\[[\s\S]*\]/)?.[0] ?? '[]')
  const parsed = JSON.parse(json) as unknown
  return Array.isArray(parsed) ? (parsed as { start: number; end?: number; text: string }[]) : []
}

export class GeminiService {
  private cached: { key: string; client: GoogleGenAI } | null = null
  /** Per model: index into FAST_MODES that the API accepted. */
  private fastMode = new Map<string, number>()

  constructor(
    private readonly getKey: () => string | null,
    private readonly getModel: () => string
  ) {}

  get configured(): boolean {
    return !!this.getKey()
  }

  private client(): GoogleGenAI {
    const key = this.getKey()
    if (!key) throw new Error('Add your Gemini API key in Settings first.')
    if (this.cached?.key !== key) this.cached = { key, client: new GoogleGenAI({ apiKey: key }) }
    return this.cached.client
  }

  private model(): string {
    return this.getModel() || DEFAULT_MODEL
  }

  private fallbackCache: { model: string; fallback: string | null } | null = null

  /** A lighter model to use when the chosen one stays overloaded (picked from the models this key can use). */
  private async fallbackModel(): Promise<string | null> {
    const model = this.model()
    if (this.fallbackCache?.model === model) return this.fallbackCache.fallback
    let fallback: string | null = null
    try {
      const names = await this.listModels()
      const usable = names.filter((n) => n !== model && !/preview|exp|tts|image|audio|live|embedding/i.test(n))
      fallback = usable.find((n) => /flash-lite-latest/.test(n)) ?? usable.find((n) => /flash-lite/.test(n)) ?? usable.find((n) => /flash/.test(n)) ?? null
    } catch {
      fallback = null
    }
    this.fallbackCache = { model, fallback }
    return fallback
  }

  /** Runs a request with retries; if the model is still busy, tries once more with a lighter model. */
  private async resilient<T>(run: (model: string) => Promise<T>, canRetry: () => boolean = () => true): Promise<T> {
    try {
      return await withRetry(() => run(this.model()), { canRetry })
    } catch (err) {
      if (!isBusyError(err) || !canRetry()) throw friendlyError(err)
      const fallback = await this.fallbackModel()
      if (!fallback) throw friendlyError(err)
      console.warn(`Gemini model ${this.model()} is busy; falling back to ${fallback}`)
      try {
        return await run(fallback)
      } catch (err2) {
        throw friendlyError(err2)
      }
    }
  }

  /**
   * Fast mode: asks the model to skip (or minimise) its "thinking" step, which is what delays
   * the first words. Falls back automatically if a model doesn't accept the setting.
   */
  private async withFastThinking<T>(model: string, call: (thinking: ThinkingConfig | undefined) => Promise<T>): Promise<T> {
    for (let i = this.fastMode.get(model) ?? 0; ; i++) {
      try {
        const result = await call(FAST_MODES[i])
        this.fastMode.set(model, i)
        return result
      } catch (err) {
        // Some models reject the setting with a plain "invalid argument" (no mention of thinking).
        if (i < FAST_MODES.length - 1 && (isThinkingConfigError(err) || isInvalidArgument(err))) continue
        throw err
      }
    }
  }

  /** Streams a response, calling onDelta for each chunk; resolves with the full text. */
  async stream(args: { systemInstruction?: string; contents: Content[]; onDelta: (t: string) => void; fast?: boolean }): Promise<string> {
    let sentAny = false
    // Only retry while nothing has been shown yet, so text is never duplicated.
    return this.resilient(async (model) => {
      const open = (thinkingConfig: ThinkingConfig | undefined) =>
        this.client().models.generateContentStream({
          model,
          contents: args.contents,
          config:
            args.systemInstruction || thinkingConfig
              ? { ...(args.systemInstruction ? { systemInstruction: args.systemInstruction } : {}), ...(thinkingConfig ? { thinkingConfig } : {}) }
              : undefined
        })
      const stream = args.fast ? await this.withFastThinking(model, open) : await open(undefined)
      let full = ''
      for await (const chunk of stream) {
        const t = chunk.text
        if (t) {
          full += t
          sentAny = true
          args.onDelta(t)
        }
      }
      return full
    }, () => !sentAny)
  }

  private async json<T>(systemInstruction: string, prompt: string, schema: Schema, fast = false): Promise<T> {
    return this.resilient(async (model) => {
      const call = (thinkingConfig: ThinkingConfig | undefined) =>
        this.client().models.generateContent({
          model,
          contents: prompt,
          config: { systemInstruction, responseMimeType: 'application/json', responseSchema: schema, ...(thinkingConfig ? { thinkingConfig } : {}) }
        })
      const res = fast ? await this.withFastThinking(model, call) : await call(undefined)
      return JSON.parse(res.text ?? 'null') as T
    })
  }

  /** Turns a saved selection (and optional explanation) into structured note fields. */
  extractNoteData(args: { kind: string; text: string; sentence?: string | null; explanationMd?: string | null }): Promise<NoteData> {
    const parts = [`Type: ${args.kind}`, `Text: "${args.text}"`]
    if (args.sentence && args.sentence !== args.text) parts.push(`From the sentence: "${args.sentence}"`)
    if (args.explanationMd) parts.push(`Existing explanation:\n${args.explanationMd.slice(0, 6000)}`)
    return this.json<NoteData>(EXTRACT_INSTRUCTION, parts.join('\n\n'), NOTE_DATA_SCHEMA, true)
  }

  async generateFlashcards(notes: Note[]): Promise<Map<number, { front: string; back: FlashcardBack }>> {
    const payload = notes.map((n) => ({
      note_id: n.id,
      kind: n.kind,
      text: n.text,
      sentence: n.contextSentence ?? undefined,
      meaning_bn: n.data?.meaning_bn,
      vocabulary: n.data?.vocabulary.map((v) => v.term),
      idioms: n.data?.idioms_phrasal.map((v) => v.term)
    }))
    const cards = await this.json<
      { note_id: number; front: string; meaning_bn: string; meaning_en: string; example: string; example_bn: string; note: string }[]
    >(FLASHCARD_INSTRUCTION, JSON.stringify(payload), FLASHCARDS_SCHEMA)
    const out = new Map<number, { front: string; back: FlashcardBack }>()
    for (const c of cards ?? []) {
      if (!c.front?.trim()) continue
      out.set(c.note_id, {
        front: c.front.trim(),
        back: { meaning_bn: c.meaning_bn, meaning_en: c.meaning_en, example: c.example, example_bn: c.example_bn, note: c.note }
      })
    }
    return out
  }

  /** Per model: which transcript request variant Gemini accepted (see TRANSCRIPT_VARIANTS). */
  private transcriptVariant = new Map<string, number>()

  /**
   * AI transcript of a public YouTube video (or one clip of it), made by Gemini from the link.
   * Google's own feature: the video is read on Google's side; nothing is downloaded here.
   * If Gemini rejects the request as an "invalid argument", simpler variants are tried in turn
   * and the one that works is remembered.
   */
  async transcribeYouTube(url: string, clip?: { startSec: number; endSec: number }): Promise<{ start: number; end?: number; text: string }[]> {
    const fmt = (s: number): string => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`
    return this.resilient(async (model) => {
      for (let i = this.transcriptVariant.get(model) ?? 0; ; i++) {
        const v = TRANSCRIPT_VARIANTS[i]
        const useClip = clip && v.clip
        const prompt = useClip
          ? `Transcribe the speech in this part of the video, from ${fmt(clip.startSec)} to ${fmt(clip.endSec)}. Times must be seconds from the beginning of the full video.`
          : clip
            ? `Transcribe only the speech between ${fmt(clip.startSec)} and ${fmt(clip.endSec)} of this video. Times must be seconds from the beginning of the video.`
            : 'Transcribe all speech in this video.'
        try {
          const res = await this.client().models.generateContent({
            model,
            contents: [
              {
                role: 'user',
                parts: [
                  {
                    fileData: { fileUri: url },
                    ...(useClip ? { videoMetadata: { startOffset: `${Math.floor(clip.startSec)}s`, endOffset: `${Math.ceil(clip.endSec)}s` } } : {})
                  },
                  { text: v.schema ? prompt : `${prompt}\nReply with only a JSON array of {"start": seconds, "end": seconds, "text": "..."} objects.` }
                ]
              }
            ],
            config: {
              systemInstruction: TRANSCRIPT_INSTRUCTION,
              ...(v.schema ? { responseMimeType: 'application/json', responseSchema: TRANSCRIPT_SCHEMA } : {}),
              // Only the speech matters: low video detail keeps it fast and within free limits.
              ...(v.lowRes ? { mediaResolution: MediaResolution.MEDIA_RESOLUTION_LOW } : {}),
              ...(v.noThinking ? { thinkingConfig: { thinkingBudget: 0 } } : {})
            }
          })
          this.transcriptVariant.set(model, i)
          return parseTranscriptJson(res.text)
        } catch (err) {
          if (i < TRANSCRIPT_VARIANTS.length - 1 && isInvalidArgument(err)) continue
          throw err
        }
      }
    })
  }

  /**
   * Writes down exactly what a learner said in a short recording (Speak practice).
   * The expected line is NOT sent, so the result isn't biased towards a match.
   */
  async transcribeSpeech(audioBase64: string, mimeType: string): Promise<string> {
    return this.resilient(async (model) => {
      const call = (thinkingConfig: ThinkingConfig | undefined) =>
        this.client().models.generateContent({
          model,
          contents: [
            {
              role: 'user',
              parts: [
                { inlineData: { mimeType, data: audioBase64 } },
                { text: 'Write down exactly the English words spoken in this recording, nothing else. Do not correct grammar or guess unclear words. If nothing is said, reply with an empty line.' }
              ]
            }
          ],
          config: thinkingConfig ? { thinkingConfig } : undefined
        })
      const res = await this.withFastThinking(model, call)
      return (res.text ?? '').trim()
    })
  }

  async listModels(): Promise<string[]> {
    try {
      const names: string[] = []
      const pager = await this.client().models.list()
      for await (const m of pager) {
        if (m.name && (!m.supportedActions || m.supportedActions.includes('generateContent'))) {
          names.push(m.name.replace(/^models\//, ''))
        }
      }
      return names.filter((n) => n.startsWith('gemini')).sort()
    } catch (err) {
      throw friendlyError(err)
    }
  }
}

/** Card built from note data alone, used when Gemini is unavailable. */
export function fallbackFlashcard(note: Note): { front: string; back: FlashcardBack } {
  const ex = note.data?.examples[0]
  return {
    front: note.text,
    back: {
      meaning_bn: note.data?.meaning_bn ?? '',
      meaning_en: note.data?.meaning_en ?? '',
      example: ex?.en ?? note.contextSentence ?? '',
      example_bn: ex?.bn ?? '',
      note: note.data?.grammar[0]?.explanation ?? ''
    }
  }
}
