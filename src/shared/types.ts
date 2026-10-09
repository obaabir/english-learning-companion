export type NoteKind = 'word' | 'phrase' | 'idiom' | 'sentence' | 'structure'

export const NOTE_KINDS: { value: NoteKind; label: string }[] = [
  { value: 'sentence', label: 'Sentence' },
  { value: 'word', label: 'Word' },
  { value: 'phrase', label: 'Phrase' },
  { value: 'idiom', label: 'Idiom / Phrasal verb' },
  { value: 'structure', label: 'Sentence structure' }
]

/** Google Doc destinations. Each category remembers its own doc. */
export type DocCategory = 'movie' | 'structures' | 'ielts'

export const DOC_CATEGORIES: { value: DocCategory; label: string }[] = [
  { value: 'movie', label: 'Movie English Notes' },
  { value: 'structures', label: 'Sentence Structure Notes' },
  { value: 'ielts', label: 'IELTS Error Log' }
]

/** Structure notes go to the structures doc; everything else to the movie doc. */
export function docCategoryForKind(kind: NoteKind): DocCategory {
  return kind === 'structure' ? 'structures' : 'movie'
}

export interface SubtitleLine {
  /** Stable key: media path + start time (or arrival order when no start time). */
  id: string
  text: string
  start: number | null
  end: number | null
  mediaPath: string
  mediaTitle: string
}

export type SubtitleStatus =
  | { kind: 'idle' }
  /** codec: short label of where subtitles come from, e.g. "subrip" or "Embedded (MKV)" */
  | { kind: 'text'; codec: string; lang?: string; count?: number }
  | { kind: 'loading'; source: string; count: number }
  | { kind: 'image'; codec: string; lang?: string }
  | { kind: 'none' }

export type PlayerKind = 'vlc' | 'mpv'

export interface PlayerStatus {
  player?: PlayerKind
  running: boolean
  connected: boolean
  mediaPath: string | null
  mediaTitle: string | null
  timePos: number | null
  paused: boolean
  subtitles: SubtitleStatus
}

export interface Prompt {
  id: number
  name: string
  instruction: string
  isDefault: boolean
  createdAt: string
  updatedAt: string
}

export interface TermItem {
  term: string
  meaning_bn: string
  note: string
}

export interface NoteData {
  meaning_bn: string
  meaning_en: string
  vocabulary: TermItem[]
  idioms_phrasal: TermItem[]
  grammar: { pattern: string; explanation: string }[]
  examples: { en: string; bn: string }[]
}

export interface Note {
  id: number
  kind: NoteKind
  text: string
  contextSentence: string | null
  explanationMd: string | null
  data: NoteData | null
  mediaPath: string | null
  mediaTitle: string | null
  timestampSec: number | null
  promptId: number | null
  gdocId: string | null
  gdocSyncedAt: string | null
  gdocError: string | null
  /** The learner's own note on this item. */
  userNote: string | null
  createdAt: string
}

export interface NewNoteInput {
  kind: NoteKind
  text: string
  contextSentence?: string | null
  explanationMd?: string | null
  mediaPath?: string | null
  mediaTitle?: string | null
  timestampSec?: number | null
  promptId?: number | null
  /** Also append the note to the category's Google Doc. */
  saveToDocs?: boolean
}

export interface NoteFilter {
  kinds?: NoteKind[]
  search?: string
  /** Stable movie identity: the movie's file path. */
  mediaPath?: string
  mediaTitle?: string
}

/** A movie with saved notes, and the Google Doc its notes go to (if chosen). */
export interface MovieNotesInfo {
  mediaPath: string
  mediaTitle: string
  noteCount: number
  doc: { docId: string; title: string } | null
}

export interface Chat {
  id: number
  title: string
  promptId: number | null
  contextText: string | null
  contextSentence: string | null
  mediaPath: string | null
  mediaTitle: string | null
  timestampSec: number | null
  createdAt: string
}

export interface ChatMessage {
  id: number
  chatId: number
  role: 'user' | 'model'
  content: string
  createdAt: string
}

export interface FlashcardBack {
  meaning_bn: string
  meaning_en: string
  example: string
  example_bn: string
  note: string
}

export interface Flashcard {
  id: number
  noteId: number
  front: string
  back: FlashcardBack
  due: string
  state: number
  reps: number
  lapses: number
  createdAt: string
}

/** Matches ts-fsrs Rating values for grades. */
export type ReviewRating = 1 | 2 | 3 | 4

export interface FlashcardStats {
  total: number
  due: number
  notesWithoutCards: number
}

export interface DocTarget {
  category: DocCategory
  docId: string
  title: string
}

export interface GoogleDocInfo {
  id: string
  title: string
  modifiedTime?: string
}

export interface AppSettings {
  player: PlayerKind
  vlcPath: string
  /** Explain a subtitle automatically as soon as it is clicked. */
  autoExplain: boolean
  /** Every saved note also goes to Google Docs automatically (Docs as storage). */
  autoSaveToDocs: boolean
  mpvPath: string
  geminiModel: string
  googleClientId: string
  hasGeminiKey: boolean
  hasGoogleSecret: boolean
  googleConnected: boolean
  googleAccount: string | null
  docTargets: DocTarget[]
}

export interface SettingsUpdate {
  player?: PlayerKind
  vlcPath?: string
  autoExplain?: boolean
  autoSaveToDocs?: boolean
  mpvPath?: string
  geminiModel?: string
  googleClientId?: string
  /** Empty string clears the stored secret. */
  geminiApiKey?: string
  googleClientSecret?: string
}

/** Context sent with Explain / Chat requests. */
export interface StudyContext {
  /** The selected text (sentence, word or phrase). */
  text: string
  /** Full subtitle sentence when the selection is a word/phrase inside it. */
  sentence?: string | null
  /** Neighbouring subtitle lines for context. */
  before?: string[]
  after?: string[]
  mediaTitle?: string | null
}

/** One line of a YouTube transcript, times in seconds from the start of the video. */
export interface TranscriptLine {
  start: number
  end: number
  text: string
}

export type YouTubeLevel = 'Easy' | 'Medium' | 'Hard'

/** Practice layer (Repeat ×N / Speak ×N). */
export interface PronouncedWord {
  word: string
  /** IPA from the CMU dictionary, or null if the word isn't in it. */
  ipa: string | null
  /** Rough Bangla spelling of the sounds (a hint). */
  bangla: string | null
  /** Hard sounds in this word, e.g. ['v', 'th (ð)']. */
  traps: string[]
}

export interface PronounceResult {
  words: PronouncedWord[]
  tips: { sound: string; tip: string }[]
}

export type PracticeRating = 'Easy' | 'OK' | 'Hard'

export interface PracticeLine {
  lineKey: string
  mediaPath: string | null
  mediaTitle: string | null
  start: number | null
  end: number | null
  text: string
  listenReps: number
  speakReps: number
  rating: PracticeRating | null
}

export interface PracticeStats {
  linesPractised: number
  listenReps: number
  speakReps: number
  hardLines: PracticeLine[]
}

export interface YouTubeVideo {
  videoId: string
  url: string
  title: string
  channel: string
  thumbnailUrl: string | null
  durationSec: number | null
  /** 'ai' = made by Gemini from the video (may contain errors). */
  transcriptSource: 'ai' | null
  transcript: TranscriptLine[]
  transcriptComplete: boolean
  level: YouTubeLevel | null
  lastPositionSec: number
}

export function formatTimestamp(sec: number | null | undefined): string {
  if (sec == null || !Number.isFinite(sec)) return ''
  const total = Math.max(0, Math.floor(sec))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${pad(h)}:${pad(m)}:${pad(s)}`
}
