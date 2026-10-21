import type { GameMode } from './games'
import type { NoteKind } from './types'

/** App sections that voice can open (same ids as the app's navigation). */
export type VoicePage =
  | 'home'
  | 'speaking'
  | 'vocabbook'
  | 'movie'
  | 'youtube'
  | 'room'
  | 'articles'
  | 'world'
  | 'notes'
  | 'vocabulary'
  | 'idioms'
  | 'structures'
  | 'flashcards'
  | 'games'
  | 'ielts'
  | 'errors'
  | 'prompts'
  | 'settings'

/** What a spoken (or typed) command asks the app to do. */
export type VoiceAction =
  | { type: 'explain'; bangla: boolean }
  | { type: 'save'; kind: NoteKind; label: string }
  | { type: 'flashcard' }
  | { type: 'open'; page: VoicePage; label: string }
  /** Back to the previous screen. */
  | { type: 'back' }
  /** The movie player (VLC / mpv): play, pause, or open a movie. */
  | { type: 'player'; command: 'play' | 'pause' | 'open' }
  /** Reload the section on screen. */
  | { type: 'refresh' }
  | { type: 'revision'; start: boolean }
  | { type: 'game'; mode: GameMode; label: string }
  | { type: 'read'; what: 'sentence' | 'word' | 'selection' }
  | { type: 'weather'; city: string | null }
  | { type: 'time' }
  | { type: 'date' }
  | { type: 'stop' }
  | { type: 'help' }
  /** Destructive: always confirmed before it runs. */
  | { type: 'deleteChat' }
  /** A general question for Gemini (through the app's chat). */
  | { type: 'ask'; question: string }
  /** Not clear: the assistant asks which one was meant. */
  | { type: 'clarify'; question: string; options: { label: string; action: VoiceAction }[] }
  | { type: 'unsupported'; message: string }
  | { type: 'unknown' }

const PAGES: { page: VoicePage; label: string; words: RegExp }[] = [
  { page: 'home', label: 'Home', words: /\bhome\b|\bmain (page|screen)\b|\bdashboard\b/ },
  { page: 'speaking', label: 'Speaking Coach', words: /\bspeaking( coach)?\b|\btranscripts?\b/ },
  { page: 'vocabbook', label: 'Vocabulary Book', words: /\b(vocabulary|word) book\b/ },
  { page: 'articles', label: 'Articles', words: /\barticles?\b|\breader\b|\bbrowser\b/ },
  { page: 'ielts', label: 'IELTS', words: /\bielts\b|\bi e l t s\b|\beye? elts\b/ },
  { page: 'errors', label: 'Error Log', words: /\berror log\b|\bmistakes?\b/ },
  { page: 'movie', label: 'Movie Mode', words: /\bmovies?\b|\bmovie mode\b|\bsubtitles?\b/ },
  { page: 'youtube', label: 'YouTube', words: /\byou ?tube\b/ },
  { page: 'room', label: 'Practice', words: /\bpractice\b|\bpractise\b/ },
  { page: 'world', label: 'English World', words: /\benglish world\b|\bcommunity\b/ },
  { page: 'vocabulary', label: 'English Vocabulary', words: /\bvocabulary\b|\bwords\b/ },
  { page: 'idioms', label: 'Idioms and Expressions', words: /\bidioms?\b|\bexpressions?\b|\bphrasal verbs?\b/ },
  { page: 'structures', label: 'Sentence Structures', words: /\bstructures?\b/ },
  { page: 'flashcards', label: 'Flashcards', words: /\bflash ?cards?\b/ },
  { page: 'games', label: 'Games', words: /\bgames?\b/ },
  { page: 'notes', label: 'Notes', words: /\bnotes?\b|\blibrary\b/ },
  { page: 'prompts', label: 'Prompts', words: /\bprompts?\b/ },
  { page: 'settings', label: 'Settings', words: /\bsettings?\b/ }
]

const GAMES: { mode: GameMode; label: string; words: RegExp }[] = [
  { mode: 'vocab-match', label: 'Vocabulary matching', words: /\bvocabulary\b|\bmatching\b|\bword game\b/ },
  { mode: 'meaning-match', label: 'Word to meaning', words: /\bmeaning\b/ },
  { mode: 'ordering', label: 'Sentence ordering', words: /\border(ing)?\b/ },
  { mode: 'blanks', label: 'Fill in the blanks', words: /\bblanks?\b|\bfill\b/ },
  { mode: 'choose', label: 'Choose the correct sentence', words: /\bchoose\b|\bcorrect sentence\b/ },
  { mode: 'idiom', label: 'Idiom completion', words: /\bidioms?\b/ },
  { mode: 'grammar', label: 'Grammar identification', words: /\bgrammar\b/ },
  { mode: 'error', label: 'Error correction', words: /\berrors?\b|\bcorrection\b/ },
  { mode: 'write', label: 'Write your own sentence', words: /\bwrite\b|\bwriting\b/ },
  { mode: 'context', label: 'Context quiz', words: /\bquiz\b|\bcontext\b/ }
]

const SAVE_KINDS: { kind: NoteKind; label: string; words: RegExp }[] = [
  { kind: 'structure', label: 'sentence structures', words: /\bstructure\b/ },
  { kind: 'phrasal', label: 'phrasal verbs', words: /\bphrasal\b/ },
  { kind: 'idiom', label: 'idioms', words: /\bidiom\b/ },
  { kind: 'collocation', label: 'collocations', words: /\bcollocation\b/ },
  { kind: 'grammar', label: 'grammar notes', words: /\bgrammar\b/ },
  { kind: 'sentence', label: 'sentences', words: /\bsentence\b/ },
  { kind: 'word', label: 'vocabulary', words: /\bword\b|\bvocabulary\b/ },
  { kind: 'general', label: 'general notes', words: /\bnote\b/ }
]

const WAKE = /^(hey|hi|ok|okay|hello)?\s*jarvis\b[,\s]*/

export function normalizeCommand(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9\s-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(WAKE, '')
    .replace(/^(please|can you|could you|would you|i want to|i want you to|lets|let us)\s+/, '')
    .replace(/\s+please$/, '')
    .trim()
}

/** True when only the wake phrase was said ("hey jarvis"). */
export function isWakeOnly(raw: string): boolean {
  const t = raw.toLowerCase().replace(/[^a-z\s]/g, ' ').trim()
  return WAKE.test(t) && normalizeCommand(raw) === ''
}

export function parseCommand(raw: string): VoiceAction {
  const t = normalizeCommand(raw)
  if (!t) return { type: 'unknown' }

  if (/^(stop|cancel|never ?mind|quiet|shut up|thats all)\b/.test(t)) return { type: 'stop' }
  if (/^(help|what can you do|what can i say|commands)\b/.test(t)) return { type: 'help' }

  // Destructive commands: only the current chat can be deleted by voice, and only after confirming.
  if (/^(delete|remove|clear|erase)\b/.test(t)) {
    if (/\bchat\b|\bconversation\b/.test(t)) return { type: 'deleteChat' }
    return { type: 'unsupported', message: 'For safety, notes and cards can only be deleted with the buttons, not by voice.' }
  }

  if (/\b(read|say|speak|pronounce)\b.*\b(aloud|out loud|this|it|sentence|word)\b|^read\b/.test(t)) {
    return { type: 'read', what: /\bsentence\b/.test(t) ? 'sentence' : /\bword\b/.test(t) ? 'word' : 'selection' }
  }

  if (/^(explain|translate|what does this mean|meaning of this)\b/.test(t)) return { type: 'explain', bangla: /\bbangla\b|\bbengali\b|\bbangle\b/.test(t) || /^translate\b/.test(t) }

  if (/\b(flash ?cards?|flash card)\b/.test(t) && /^(add|make|create|put|save|turn)\b/.test(t)) return { type: 'flashcard' }

  // Navigation and the movie player.
  if (/^(go )?back\b|^previous (page|screen)$/.test(t)) return { type: 'back' }
  if (/^(go |take me )?home( page| screen)?$/.test(t)) return { type: 'open', page: 'home', label: 'Home' }
  if (/^(refresh|reload)\b/.test(t)) return { type: 'refresh' }
  if (/^pause\b|^stop the (movie|video|film)\b/.test(t)) return { type: 'player', command: 'pause' }
  if (/^(play|resume|continue)( the)?( movie| video| film)?$/.test(t)) return { type: 'player', command: 'play' }
  if (/^(open|play|start|choose|pick) (a |the )?(new )?(movie|film)( file)?$/.test(t)) return { type: 'player', command: 'open' }

  if (/^(save|add|keep|store)\b/.test(t)) {
    const k = SAVE_KINDS.find((s) => s.words.test(t))
    if (k) return { type: 'save', kind: k.kind, label: k.label }
    return {
      type: 'clarify',
      question: 'Save it as what?',
      options: (['word', 'sentence', 'structure', 'idiom', 'phrasal'] as const).map((kind) => {
        const s = SAVE_KINDS.find((x) => x.kind === kind)!
        return { label: s.label[0].toUpperCase() + s.label.slice(1), action: { type: 'save', kind, label: s.label } }
      })
    }
  }

  if (/\brevision\b|\brevise\b|\breview\b|\bdue today\b/.test(t)) return { type: 'revision', start: /^(start|begin|do|lets do)\b/.test(t) }

  if (/\b(game|play|quiz)\b/.test(t) && !/^(open|show|go to)\s+(the\s+)?games?$/.test(t)) {
    const g = GAMES.find((x) => x.words.test(t.replace(/\b(start|play|a|the|game)\b/g, ' ')))
    if (g) return { type: 'game', mode: g.mode, label: g.label }
    return {
      type: 'clarify',
      question: 'Which game?',
      options: GAMES.slice(0, 6).map((x) => ({ label: x.label, action: { type: 'game', mode: x.mode, label: x.label } }))
    }
  }

  if (/\bweather\b|\btemperature\b|\b(will|is) it rain/.test(t)) {
    const m = t.match(/\b(?:in|at|for)\s+([a-z][a-z\s-]{1,40})$/)
    return { type: 'weather', city: m ? m[1].replace(/\b(today|now|tomorrow)\b/g, '').trim() || null : null }
  }
  if (/\bwhat time\b|^time$|\bthe time\b/.test(t)) return { type: 'time' }
  if (/\b(what day|todays date|the date|what date)\b/.test(t)) return { type: 'date' }

  if (/^(open|show|go to|take me to|switch to|start)\b/.test(t) || /\b(my|saved)\s+notes\b/.test(t)) {
    const target = t.replace(/^(open|show|go to|take me to|switch to|start)\s+/, '')
    const p = PAGES.find((x) => x.words.test(target))
    if (p) return { type: 'open', page: p.page, label: p.label }
    return {
      type: 'clarify',
      question: 'Which section should I open?',
      options: PAGES.filter((x) => ['articles', 'movie', 'youtube', 'notes', 'flashcards', 'games'].includes(x.page)).map((x) => ({
        label: x.label,
        action: { type: 'open', page: x.page, label: x.label }
      }))
    }
  }

  // Anything else that sounds like a question goes to Gemini through the app's chat.
  if (t.split(' ').length >= 2) return { type: 'ask', question: raw.replace(WAKE, '').trim() }
  return { type: 'unknown' }
}

/** Phrases the offline Windows recognizer listens for (commands are matched exactly; accurate). */
export const COMMAND_PHRASES: string[] = (() => {
  const base = [
    'explain this word in bangla',
    'explain this in bangla',
    'explain this sentence in bangla',
    'explain this word',
    'explain this',
    'translate this',
    'save this word to vocabulary',
    'save this word',
    'save this to vocabulary',
    'save this sentence structure',
    'save this structure',
    'save this sentence',
    'save this idiom',
    'save this phrasal verb',
    'save this collocation',
    'save this grammar note',
    'save this',
    'add this to flashcards',
    'make a flashcard',
    'read this sentence aloud',
    'read this aloud',
    'read this word aloud',
    'read it aloud',
    'show todays revision',
    'show today\'s revision',
    'show my revision',
    'start revision',
    'start my revision',
    'start a vocabulary game',
    'start the vocabulary game',
    'play a vocabulary game',
    'start a game',
    'play a game',
    'start sentence ordering',
    'start a quiz',
    'show my saved notes',
    'show my notes',
    'open my notes',
    'whats the weather',
    'what\'s the weather',
    'what time is it',
    'what day is it',
    'whats the date',
    'stop',
    'cancel',
    'help',
    'what can you do',
    'delete this chat',
    'go back',
    'back',
    'go home',
    'pause the movie',
    'pause',
    'play the movie',
    'resume',
    'open a movie',
    'refresh',
    'open i e l t s',
    'open the ielts section'
  ]
  for (const p of PAGES) base.push(`open ${p.label.toLowerCase()}`, `go to ${p.label.toLowerCase()}`)
  for (const g of GAMES) base.push(`start ${g.label.toLowerCase()}`)
  const all = new Set<string>()
  for (const b of base) for (const w of ['', 'hey jarvis ', 'jarvis ']) all.add(`${w}${b}`)
  // The wake phrase alone ("Hey Jarvis") is also understood offline; it means "I'm about to ask".
  for (const w of ['hey jarvis', 'jarvis', 'ok jarvis']) all.add(w)
  return [...all]
})()

/** Starts of commands that end in free words (e.g. a city name). */
export const COMMAND_TAILS = ['whats the weather in', 'what\'s the weather in', 'weather in', 'hey jarvis whats the weather in', 'hey jarvis what\'s the weather in']

/** The wake phrase alone, or wake phrase + command, for "Hey Jarvis" mode. */
export const WAKE_PHRASES = ['hey jarvis', 'jarvis', 'ok jarvis', ...COMMAND_PHRASES.filter((p) => p.startsWith('hey jarvis '))]

export const VOICE_EXAMPLES = [
  'Explain this word in Bangla',
  'Save this word to vocabulary',
  'Save this sentence structure',
  'Add this to flashcards',
  'Open Articles',
  'Open Speaking Coach',
  'Go back',
  'Go home',
  'Pause the movie',
  "Show today's revision",
  'Start a vocabulary game',
  'Show my saved notes',
  'Read this sentence aloud',
  "What's the weather in Dhaka?",
  'What time is it?'
]

export interface WeatherReport {
  place: string
  temperature: number
  feelsLike: number
  description: string
  high: number
  low: number
  rainChance: number | null
  wind: number
}

/** WMO weather codes (Open-Meteo) in plain words. */
export function weatherText(code: number): string {
  if (code === 0) return 'clear sky'
  if (code <= 2) return 'partly cloudy'
  if (code === 3) return 'overcast'
  if (code <= 48) return 'foggy'
  if (code <= 57) return 'drizzle'
  if (code <= 67) return 'rain'
  if (code <= 77) return 'snow'
  if (code <= 82) return 'rain showers'
  if (code <= 86) return 'snow showers'
  return 'thunderstorms'
}

export function weatherSentence(w: WeatherReport): string {
  const rain = w.rainChance != null ? `, ${w.rainChance}% chance of rain` : ''
  return `In ${w.place} it's ${Math.round(w.temperature)} degrees and ${w.description}, feels like ${Math.round(w.feelsLike)}. Today: high ${Math.round(w.high)}, low ${Math.round(w.low)}${rain}.`
}

/** Home page weather: current conditions plus when rain is expected (from the hourly forecast). */
export interface HomeWeather extends WeatherReport {
  /** Weather code for the icon. */
  code: number
  isDay: boolean
  /** The place's time zone (IANA) and the forecast's local "now" (YYYY-MM-DDTHH:MM). */
  timezone: string
  localTime: string
  /** First stretch in the next 18 hours where rain is likely, or null if none is forecast. */
  rain: RainWindow | null
  /** False when the forecast had no hourly rain data (then nothing is said about rain timing). */
  hourlyAvailable: boolean
  /** When this was fetched (ms since epoch). */
  fetchedAt: number
}

export interface RainWindow {
  /** Local times "HH:MM" at the place. */
  start: string
  end: string
  /** Highest chance (%) in the stretch. */
  chance: number
  /** True if the stretch starts tomorrow (local). */
  tomorrow: boolean
}

/** Rain is "likely" in an hour with at least this chance, or at least this much rain (mm). */
const RAIN_CHANCE = 50
const RAIN_MM = 0.3

/**
 * The first stretch of likely rain from now (local) over the next `hours` hours, from Open-Meteo hourly
 * arrays (local times). Null when no hour reaches the threshold.
 */
export function rainWindow(now: string, times: string[], chance: (number | null)[], mm: (number | null)[], hours = 18): RainWindow | null {
  const nowHour = now.slice(0, 13)
  let i = times.findIndex((t) => t.slice(0, 13) >= nowHour)
  if (i < 0) return null
  const last = Math.min(times.length, i + hours)
  const likely = (k: number): boolean => (chance[k] ?? 0) >= RAIN_CHANCE || (mm[k] ?? 0) >= RAIN_MM
  for (; i < last; i++) if (likely(i)) break
  if (i >= last) return null
  let j = i
  let max = chance[i] ?? 0
  while (j + 1 < times.length && likely(j + 1)) max = Math.max(max, chance[++j] ?? 0)
  const endHour = new Date(`${times[j]}:00Z`)
  endHour.setUTCHours(endHour.getUTCHours() + 1)
  return {
    start: times[i].slice(11, 16),
    end: endHour.toISOString().slice(11, 16),
    chance: Math.round(max),
    tomorrow: times[i].slice(0, 10) > now.slice(0, 10)
  }
}
