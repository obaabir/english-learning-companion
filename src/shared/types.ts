export type NoteKind =
  | 'word'
  | 'phrase'
  | 'idiom'
  | 'phrasal'
  | 'collocation'
  | 'sentence'
  | 'structure'
  | 'grammar'
  | 'general'
  | 'ielts_error'

export const NOTE_KINDS: { value: NoteKind; label: string }[] = [
  { value: 'sentence', label: 'Sentence' },
  { value: 'word', label: 'Word' },
  { value: 'phrase', label: 'Phrase' },
  { value: 'idiom', label: 'Idiom' },
  { value: 'phrasal', label: 'Phrasal verb' },
  { value: 'collocation', label: 'Collocation' },
  { value: 'structure', label: 'Sentence structure' },
  { value: 'grammar', label: 'Grammar note' },
  { value: 'general', label: 'General note' },
  { value: 'ielts_error', label: 'IELTS error' }
]

/** Google Doc destinations. Each category remembers its own doc. */
export type DocCategory = 'article_vocab' | 'movie_vocab' | 'idioms' | 'structures' | 'grammar' | 'general' | 'ielts'

export const DOC_CATEGORIES: { value: DocCategory; label: string }[] = [
  { value: 'article_vocab', label: 'Article Vocabulary' },
  { value: 'movie_vocab', label: 'Movie Vocabulary' },
  { value: 'idioms', label: 'Idioms and Expressions' },
  { value: 'structures', label: 'Sentence Structures' },
  { value: 'grammar', label: 'Grammar Notes' },
  { value: 'general', label: 'General English Notes' },
  { value: 'ielts', label: 'IELTS Error Log' }
]

/** Where a saved item came from. */
export type SourceType = 'article' | 'movie' | 'youtube' | 'ielts' | 'import' | 'other'

export function sourceTypeOf(n: { articleId?: number | null; mediaPath?: string | null; ieltsRef?: string | null; sourceType?: SourceType | null }): SourceType {
  if (n.sourceType === 'import') return 'import'
  if (n.articleId) return 'article'
  if (n.ieltsRef) return 'ielts'
  if (n.mediaPath) return /^https?:\/\//.test(n.mediaPath) ? 'youtube' : 'movie'
  return 'other'
}

/**
 * Which Google Doc category an item goes to: idioms/phrasal verbs, structures, grammar and IELTS
 * errors have their own docs; words, collocations and sentences go to Article or Movie Vocabulary
 * by where they came from, otherwise to General English Notes.
 */
export function docCategoryForNote(n: { kind: NoteKind; articleId?: number | null; mediaPath?: string | null; ieltsRef?: string | null }): DocCategory {
  switch (n.kind) {
    case 'idiom':
    case 'phrasal':
      return 'idioms'
    case 'structure':
      return 'structures'
    case 'grammar':
      return 'grammar'
    case 'general':
      return 'general'
    case 'ielts_error':
      return 'ielts'
  }
  const source = sourceTypeOf(n)
  return source === 'article' ? 'article_vocab' : source === 'movie' || source === 'youtube' ? 'movie_vocab' : 'general'
}

/**
 * Identity used to avoid saving the same item twice: same text, same type, same sentence and same
 * source. The same word from a different sentence (possibly a different meaning) stays separate.
 */
export function noteDedupeKey(n: {
  kind: NoteKind
  text: string
  contextSentence?: string | null
  articleId?: number | null
  mediaPath?: string | null
  ieltsRef?: string | null
  collection?: 'regular' | 'book'
}): string {
  const norm = (s: string | null | undefined): string =>
    (s ?? '')
      .toLowerCase()
      .replace(/[“”"‘’'`.,!?;:()[\]…—–-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  const source = n.articleId ? `article:${n.articleId}` : n.ieltsRef ? `ielts:${norm(n.ieltsRef)}` : n.mediaPath ? `media:${n.mediaPath}` : ''
  // Regular items keep their existing keys; another collection (Vocabulary Book) never matches them.
  const key = [n.kind, norm(n.text), norm(n.contextSentence), source].join('|')
  return n.collection && n.collection !== 'regular' ? `${n.collection}|${key}` : key
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
  /** The key word/phrase to learn from the text (dictionary form) and its meaning. */
  target_term?: string
  target_meaning_bn?: string
  target_meaning_en?: string
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
  /** The article it was saved from (Articles section). */
  articleId?: number | null
  /** Stable ID that never changes (also written into Google Docs to prevent duplicates). */
  uid?: string
  sourceType?: SourceType
  /** Article address or YouTube link. */
  sourceUrl?: string | null
  /** The IELTS question an error belongs to. */
  ieltsRef?: string | null
  /** Google Docs: in the doc, waiting, or failed (with gdocError). */
  syncStatus?: 'synced' | 'pending' | 'failed'
  /** Set by notes:create when the same item was already saved (nothing new was added). */
  duplicate?: boolean
  /** The word or phrase to learn (the flashcard front). null = not chosen yet. */
  target?: string | null
  /** 'regular' learning collection, or the separate Vocabulary Book collection. */
  collection?: 'regular' | 'book'
  /** Its flashcard (revision status), when it has one; shared = the same word and meaning saved earlier already has this card. */
  flashcard?: { id: number; due: string; reps: number; lapses: number; intervalDays: number; mastered: boolean; shared?: boolean } | null
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
  articleId?: number | null
  ieltsRef?: string | null
  /** Your own Bangla meaning (e.g. from an imported list); kept when Gemini analyses the item. */
  meaningBn?: string | null
  /** Where it came from, when it isn't an article/movie/YouTube/IELTS (e.g. an imported list). */
  sourceType?: 'import'
  /** Defaults to the regular learning collection. */
  collection?: 'regular' | 'book'
  /** Also append the note to the category's Google Doc. */
  saveToDocs?: boolean
}

export interface NoteFilter {
  kinds?: NoteKind[]
  search?: string
  /** Stable movie identity: the movie's file path. */
  mediaPath?: string
  mediaTitle?: string
  articleId?: number
  collection?: 'regular' | 'book'
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
  /** What the learner had highlighted when asking (user messages only). */
  focus?: ChatFocus | null
}

/** The exact text a chat question is about, with where it came from. */
export interface ChatFocus {
  /** The highlighted word, phrase, idiom or structure. */
  text: string
  /** The original subtitle/sentence being studied. */
  sentence?: string | null
  /** The part of the explanation, chat answer or article around the highlight. */
  excerpt?: string | null
  source: 'explanation' | 'chat' | 'article'
  /** Article selections: where it was read, and the explanation already given for it. */
  articleTitle?: string | null
  articleDomain?: string | null
  explanation?: string | null
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
  /** Revision schedule (Day 1 → Day 3 → Day 7 → …). */
  step?: number
  intervalDays?: number
  ease?: number
  lastReviewedAt?: string | null
  lastRating?: ReviewRating | null
  mastered?: boolean
  /** The saved item it was made from: original context and source (kept with the card). */
  source?: FlashcardSource
  /** The item has no target word/phrase yet (an old sentence card): the front shows the sentence until one is chosen. */
  needsTarget?: boolean
}

export interface FlashcardSource {
  kind: NoteKind
  /** The original sentence the item came from (source text, not AI). */
  contextSentence: string | null
  mediaTitle: string | null
  sourceUrl: string | null
  timestampSec: number | null
  /** AI-generated examples and explanation from the saved note. */
  examples: { en: string; bn: string }[]
  grammar: { pattern: string; explanation: string }[]
  /** The saved text (for a sentence item: the whole original sentence). */
  text?: string
  /** Bangla translation of the original sentence (sentence items). */
  sentenceMeaningBn?: string | null
}

/** Changes to a flashcard: the English front (the item's target word/phrase) and, optionally, its back. */
export interface FlashcardEdit {
  id: number
  front?: string
  meaningBn?: string
  meaningEn?: string
  example?: string
  exampleBn?: string
}

/** Again, Difficult, Good, Easy. */
export type ReviewRating = 1 | 2 | 3 | 4

export const REVIEW_RATINGS: { rating: ReviewRating; label: string }[] = [
  { rating: 1, label: 'Again' },
  { rating: 2, label: 'Difficult' },
  { rating: 3, label: 'Good' },
  { rating: 4, label: 'Easy' }
]

/** Item types that get flashcards (general notes and IELTS errors don't). */
export const FLASHCARD_KINDS: NoteKind[] = ['word', 'phrase', 'idiom', 'phrasal', 'collocation', 'sentence', 'structure', 'grammar']

export interface RevisionDashboard {
  counts: { dueToday: number; overdue: number; upcoming: number; recent: number; forgotten: number; mastered: number; total: number }
  dueToday: Flashcard[]
  overdue: Flashcard[]
  upcoming: Flashcard[]
  recent: Flashcard[]
  forgotten: Flashcard[]
  mastered: Flashcard[]
}

/** AI practice material made from saved sentences (the saved sentence itself stays the original). */
export interface PracticeItem {
  id: number
  /** Choose the correct sentence: wrong versions of the original. Error correction: one wrong version. */
  wrong: string[]
  errors: { wrong: string; right: string; why: string }[]
  why: string
  structure: string
}

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

/** Practice Room: a shadowed line and its spaced-review schedule. */
export interface ShadowLine {
  id: string
  text: string
  mediaPath: string | null
  mediaTitle: string | null
  start: number | null
  end: number | null
  /** Local date (YYYY-MM-DD) it was first shadowed. */
  dateShadowed: string
  reps: number
  /** 0 = 3-day rung, 1 = 7, 2 = 14, 3 = 30; 4 = mastered. */
  rung: number
  nextDue: string | null
  status: 'new' | 'learning' | 'mastered'
  ratings: { date: string; rating: PracticeRating }[]
  shadowDays: string[]
}

export interface StreakState {
  streak: number
  lastCheckedDay: string | null
  /** Shields used per month (YYYY-MM). */
  shieldsUsed: Record<string, number>
  shieldDays: string[]
}

export interface RoomHome {
  today: string
  dayNumber: number
  streak: number
  shieldsLeft: number
  shadowedToday: number
  practisedToday: boolean
  /** Today's capped queue, oldest first. */
  queue: ShadowLine[]
  dailyCap: number
  totalLines: number
}

export interface CalendarDay {
  date: string
  dot: 'none' | 'shadowed' | 'due' | 'done' | 'upcoming'
  /** Lines first shadowed that day. */
  learned: number
  due: number
}

export interface RemixSet {
  date: string
  phrases: { phrase: string; meaning_bn: string }[]
  sentences: { en: string; bn: string }[]
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

/** Google Docs sync overview (Settings → Google Docs). */
export interface SyncOverview {
  categories: { category: DocCategory; label: string; docTitle: string | null; synced: number; pending: number; failed: number }[]
  failed: { id: number; text: string; kind: NoteKind; error: string; category: DocCategory }[]
}
