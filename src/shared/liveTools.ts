/**
 * Voice Mode (Gemini Live) tools: the ONLY things the voice model can make the app do. Each tool is
 * declared here with its arguments; every call is checked against this list before anything runs.
 * No tool runs code, opens files or programs, or deletes anything.
 */

export const LIVE_SECTIONS = [
  'home',
  'movie',
  'youtube',
  'speaking_coach',
  'articles',
  'practice',
  'flashcards',
  'games',
  'vocabulary_book',
  'ielts',
  'notes',
  'english_vocabulary',
  'idioms',
  'sentence_structures',
  'error_log',
  'english_world',
  'prompts',
  'settings'
] as const
export type LiveSection = (typeof LIVE_SECTIONS)[number]

export const LIVE_SAVE_KINDS = ['word', 'phrase', 'idiom', 'phrasal', 'collocation', 'sentence', 'structure', 'grammar'] as const

type Param = { type: 'STRING'; description: string; enum?: readonly string[] }
interface ToolDef {
  name: string
  description: string
  params: Record<string, Param>
  required?: string[]
  /** Runs in the main process (clock, weather); otherwise in the app window. */
  main?: boolean
}

const TOOLS: ToolDef[] = [
  {
    name: 'get_current_time',
    description: "The current time and date from this computer's clock. Always use this for time or date questions; never guess.",
    params: { timezone: { type: 'STRING', description: 'IANA time zone, only if the user names a place or zone (e.g. "Europe/London"). Leave empty for the user’s own time.' } },
    main: true
  },
  {
    name: 'get_weather',
    description:
      'Live weather from Open-Meteo: current conditions and today’s forecast. Always use this for weather questions; never invent weather. If it says a location is needed, ask the user for the city.',
    params: { city: { type: 'STRING', description: 'City name if the user said one; otherwise leave empty to use their saved city.' } },
    main: true
  },
  {
    name: 'get_selected_item',
    description:
      'The word, phrase or sentence the user has selected in the app right now (Movie, YouTube, Articles or an explanation), with its original sentence and source. Use it when the user says "this", "this word", "explain this", or asks about the selected item.',
    params: {}
  },
  {
    name: 'open_section',
    description: 'Opens a section of the app.',
    params: { section: { type: 'STRING', description: 'The section to open.', enum: LIVE_SECTIONS } },
    required: ['section']
  },
  { name: 'go_back', description: 'Goes back to the previous screen of the app.', params: {} },
  {
    name: 'control_movie',
    description: 'Controls the movie player (VLC/mpv) used by Movie Mode: play, pause, or open a movie file (the user picks the file).',
    params: { action: { type: 'STRING', description: 'What to do.', enum: ['play', 'pause', 'open'] } },
    required: ['action']
  },
  { name: 'refresh_section', description: 'Reloads the section on screen (when it looks stuck or out of date).', params: {} },
  { name: 'start_revision', description: 'Opens Flashcards and starts today’s revision (review) session.', params: {} },
  {
    name: 'save_selected_item',
    description:
      'Saves the selected item to the user’s vocabulary collection (Notes; flashcards and games use the same collection). Only when the user asks to save. Choose the kind that fits the selection.',
    params: { kind: { type: 'STRING', description: 'What the selected text is.', enum: LIVE_SAVE_KINDS } },
    required: ['kind']
  },
  {
    name: 'add_selected_to_flashcards',
    description: 'Saves the selected item (if not saved yet) and makes its flashcard. Only when the user asks for a flashcard.',
    params: {}
  },
  {
    name: 'show_mistakes',
    description: 'The user’s mistakes: how often they forgot a word in revision and grammar mistakes from Sentence Practice. Opens Flashcards.',
    params: { word: { type: 'STRING', description: 'The word or phrase, if the user named one (or "this" = the selected item).' } }
  },
  { name: 'end_voice_session', description: 'Ends Voice Mode when the user says goodbye or asks to stop the conversation.', params: {} }
]

export const LIVE_TOOL_NAMES = TOOLS.map((t) => t.name)
export const MAIN_LIVE_TOOLS = new Set(TOOLS.filter((t) => t.main).map((t) => t.name))

/** Declarations in the Gemini function-calling format. */
export function liveFunctionDeclarations(): { name: string; description: string; parameters?: object }[] {
  return TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    ...(Object.keys(t.params).length
      ? {
          parameters: {
            type: 'OBJECT',
            properties: Object.fromEntries(Object.entries(t.params).map(([k, p]) => [k, { type: p.type, description: p.description, ...(p.enum ? { enum: [...p.enum] } : {}) }])),
            ...(t.required ? { required: t.required } : {})
          }
        }
      : {})
  }))
}

export type ToolCheck = { ok: true; name: string; args: Record<string, string> } | { ok: false; error: string }

/** Checks a tool call from the model: a known tool, only its own arguments, the right types and values. */
export function validateToolCall(name: unknown, args: unknown): ToolCheck {
  const def = TOOLS.find((t) => t.name === name)
  if (!def) return { ok: false, error: `Unknown tool "${String(name)}". Only the listed app tools can be used.` }
  const raw = args && typeof args === 'object' && !Array.isArray(args) ? (args as Record<string, unknown>) : {}
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(raw)) {
    const p = def.params[k]
    if (!p) return { ok: false, error: `"${def.name}" has no argument "${k}".` }
    if (v === null || v === undefined || v === '') continue
    if (typeof v !== 'string') return { ok: false, error: `"${k}" must be text.` }
    const value = v.trim().slice(0, 80)
    if (p.enum && !p.enum.includes(value)) return { ok: false, error: `"${k}" must be one of: ${p.enum.join(', ')}.` }
    if (value) out[k] = value
  }
  for (const k of def.required ?? []) if (!out[k]) return { ok: false, error: `"${def.name}" needs "${k}".` }
  return { ok: true, name: def.name, args: out }
}

/** How the voice model behaves. */
export const LIVE_SYSTEM_INSTRUCTION = `You are Jarvis, the friendly voice companion inside "English Learning Companion", a desktop app for a Bangla-speaking learner of English. You talk by voice.

How to talk:
- Speak naturally and briefly (usually one to three sentences). Give longer explanations only when asked.
- Speak English by default. When you explain a word, phrase or grammar point, give its Bangla meaning too (say the Bangla word), then a simple English meaning and one short example. If the user speaks Bangla, you may answer in Bangla.
- Remember what was said earlier in this conversation and answer follow-up questions in that context.
- When the user wants to practise English, have a real conversation: ask questions, and gently correct mistakes (say the correct version and why, briefly).

Facts and actions:
- Time or date: always call get_current_time. Weather: always call get_weather; say clearly which part is the current conditions and which part is today's forecast (an estimate). Never invent weather or time.
- "This", "this word", "the selected word": call get_selected_item first.
- App actions (open any section, go back, go home = open_section "home", play/pause/open a movie, refresh, start revision, save, make a flashcard, show mistakes): use the tools. When the user asks to open or do something in the app, do it right away with the tool, then say briefly what you did. Only say an action is done if the tool result says ok. If a tool reports a problem, tell the user simply what to do.
- Save or make flashcards only when the user asks. Nothing can be deleted by voice.
- If the user says goodbye or asks to stop talking, call end_voice_session.`

/** Why a Voice Mode session could not start or stopped. */
export type LiveFailure = 'quota' | 'billing' | 'model' | 'auth' | 'network' | 'other' | 'ended'

/** What the Live session reports to the window. */
export type LiveEvent =
  | { type: 'state'; state: 'connecting' | 'open' | 'reconnecting' | 'closed'; model?: string; reason?: LiveFailure; message?: string }
  /** Spoken answer: 16-bit PCM, 24 kHz, base64. */
  | { type: 'audio'; data: string }
  /** Words heard / spoken so far (pieces; the window joins them). */
  | { type: 'transcript'; role: 'user' | 'model'; text: string }
  /** The user started talking over the answer: stop playing it. */
  | { type: 'interrupted' }
  | { type: 'turnComplete' }
  | { type: 'tool'; name: string; args: Record<string, string>; status: 'running' | 'done' | 'error'; result?: Record<string, unknown> }
