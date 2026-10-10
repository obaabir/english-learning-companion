import type {
  AppSettings,
  Chat,
  ChatMessage,
  DocCategory,
  Flashcard,
  FlashcardStats,
  GoogleDocInfo,
  TranscriptLine,
  YouTubeVideo,
  MovieNotesInfo,
  PracticeRating,
  CalendarDay,
  RemixSet,
  RoomHome,
  ShadowLine,
  PracticeStats,
  PronounceResult,
  PlayerStatus,
  NewNoteInput,
  Note,
  NoteFilter,
  NoteKind,
  Prompt,
  ReviewRating,
  SettingsUpdate,
  StudyContext,
  SubtitleLine
} from './types'
import type { FspCardType, FspCheckInput, FspCheckResult, FspErrorType, FspLesson } from './fsp'

/**
 * Every renderer → main call. Keys are IPC channel names; the preload exposes a
 * single typed `invoke` so adding a method here is the only wiring needed.
 */
export interface Api {
  'settings:get': () => Promise<AppSettings>
  'settings:update': (update: SettingsUpdate) => Promise<AppSettings>
  'settings:pickMpvPath': () => Promise<AppSettings>
  'settings:pickVlcPath': () => Promise<AppSettings>

  'player:open': (filePath?: string) => Promise<PlayerStatus>
  'player:addSubtitle': (filePath?: string) => Promise<PlayerStatus>
  'player:status': () => Promise<PlayerStatus>
  'player:togglePause': () => Promise<void>
  'player:seekTo': (args: { mediaPath: string | null; seconds: number }) => Promise<void>
  /** Practice controls for the open movie. */
  'player:control': (
    c: { action: 'play' } | { action: 'pause' } | { action: 'seek'; seconds: number } | { action: 'rate'; rate: number }
  ) => Promise<void>

  /** IPA, Bangla sound hint and Bangla tips for hard sounds (free CMU dictionary). */
  'practice:pronounce': (text: string) => Promise<PronounceResult>
  'practice:record': (r: {
    lineKey: string
    mediaPath: string | null
    mediaTitle: string | null
    start: number | null
    end: number | null
    text: string
    listenReps?: number
    speakReps?: number
    rating?: PracticeRating
  }) => Promise<void>
  'practice:stats': () => Promise<PracticeStats>
  /** Gemini listens to a short recording and returns the words it heard. */
  'practice:transcribeSpeech': (args: { audioBase64: string; mimeType: string }) => Promise<string>
  /** Short Bangla meaning of a line (Speak panel "?"). */
  'practice:meaning': (text: string) => Promise<string>
  /** "AI voice": Windows' built-in English voice reads the text (WAV, base64). */
  'practice:voice': (text: string) => Promise<string>

  /** Practice Room. */
  'room:shadowed': (args: { line: Pick<ShadowLine, 'id' | 'text' | 'mediaPath' | 'mediaTitle' | 'start' | 'end'>; reps: number }) => Promise<ShadowLine>
  'room:home': () => Promise<RoomHome>
  'room:review': (args: { id: string; rating: PracticeRating }) => Promise<ShadowLine>
  'room:calendar': (args: { year: number; month: number }) => Promise<CalendarDay[]>
  'room:day': (date: string) => Promise<ShadowLine[]>
  'room:setDailyCap': (cap: number) => Promise<void>
  'room:remix': (args: { date: string; refresh?: boolean }) => Promise<RemixSet>
  'room:yourTurn': (args: { sentence: string; phrases: string[] }) => Promise<{ corrected: string; tip_bn: string; ok: boolean }>

  'prompts:list': () => Promise<Prompt[]>
  'prompts:save': (p: { id?: number; name: string; instruction: string }) => Promise<Prompt>
  'prompts:delete': (id: number) => Promise<void>
  'prompts:setDefault': (id: number) => Promise<void>

  /** Streams deltas over the `ai:chunk` event; resolves with the full text. */
  'ai:explain': (args: { requestId: string; promptId: number | null; context: StudyContext }) => Promise<string>
  'ai:listModels': () => Promise<string[]>

  'chats:list': () => Promise<Chat[]>
  'chats:create': (args: {
    promptId: number | null
    context: StudyContext
    mediaPath?: string | null
    timestampSec?: number | null
    /** Seed the chat with an existing explanation so follow-ups have it. */
    explanationMd?: string | null
  }) => Promise<Chat>
  'chats:messages': (chatId: number) => Promise<ChatMessage[]>
  'chats:send': (args: { requestId: string; chatId: number; text: string }) => Promise<ChatMessage>
  'chats:delete': (chatId: number) => Promise<void>

  'notes:create': (input: NewNoteInput) => Promise<Note>
  'notes:list': (filter?: NoteFilter) => Promise<Note[]>
  'notes:get': (id: number) => Promise<Note | null>
  'notes:updateKind': (args: { id: number; kind: NoteKind }) => Promise<Note>
  'notes:delete': (id: number) => Promise<void>
  'notes:syncToDocs': (id: number) => Promise<Note>
  'notes:reanalyze': (id: number) => Promise<Note>
  'notes:mediaTitles': () => Promise<string[]>
  /** Movies with saved notes (identified by file path) and their Google Docs. */
  'notes:movies': () => Promise<MovieNotesInfo[]>
  'notes:updateUserNote': (args: { id: number; userNote: string }) => Promise<Note>
  /** Appends a movie's notes that are not yet in its Google Doc. */
  'notes:syncMovie': (mediaPath: string) => Promise<{ added: number; alreadyThere: number; failed: number; error: string | null }>

  'flashcards:stats': () => Promise<FlashcardStats>
  'flashcards:generate': (args?: { noteIds?: number[] }) => Promise<{ created: number }>
  'flashcards:due': (limit?: number) => Promise<Flashcard[]>
  'flashcards:list': () => Promise<Flashcard[]>
  'flashcards:review': (args: { id: number; rating: ReviewRating }) => Promise<Flashcard>
  'flashcards:delete': (id: number) => Promise<void>

  'google:connect': () => Promise<AppSettings>
  'google:disconnect': () => Promise<AppSettings>
  'google:listDocs': (query?: string) => Promise<GoogleDocInfo[]>
  'google:createDoc': (args: { title: string; category: DocCategory }) => Promise<AppSettings>
  'google:setTarget': (args: { category: DocCategory; doc: GoogleDocInfo }) => Promise<AppSettings>
  'google:openDoc': (docId: string) => Promise<void>
  /** Sends notes not yet in Google Docs (e.g. saved while offline). */
  'google:syncPending': () => Promise<{ added: number; error: string | null }>

  /** Checks a YouTube link (title, channel, thumbnail, any saved transcript). */
  'youtube:info': (link: string) => Promise<YouTubeVideo>
  /** Makes or resumes the AI transcript; progress arrives on 'youtube:transcriptProgress'. */
  'youtube:transcribe': (args: { videoId: string; durationSec: number | null }) => Promise<YouTubeVideo>
  'youtube:recent': () => Promise<YouTubeVideo[]>
  'youtube:savePosition': (args: { videoId: string; seconds: number }) => Promise<void>
  'google:setMovieDoc': (args: { mediaPath: string; mediaTitle: string; doc: GoogleDocInfo }) => Promise<MovieNotesInfo['doc']>
  'google:createMovieDoc': (args: { mediaPath: string; mediaTitle: string; title: string }) => Promise<MovieNotesInfo['doc']>

  /** Flash Sentence Practice (Flashcards section). */
  'fsp:check': (input: FspCheckInput) => Promise<FspCheckResult>
  'fsp:example': (args: { term: string; type: FspCardType; meaningBn: string }) => Promise<string>
  'fsp:lesson': (args: { type: FspErrorType; label: string; samples: { wrong: string; fix: string }[] }) => Promise<FspLesson>
}

/** Main → renderer push events. */
export interface Events {
  'player:status': PlayerStatus
  'player:subtitle': SubtitleLine
  'ai:chunk': { requestId: string; delta: string }
  /** A note's background Google Docs save finished. */
  'notes:docsResult': { noteId: number; ok: boolean; error: string | null }
  'youtube:transcriptProgress': { videoId: string; transcript: TranscriptLine[]; chunksDone: number; totalChunks: number; complete: boolean }
}

export type ApiChannel = keyof Api
export type EventChannel = keyof Events

export interface PreloadBridge {
  invoke<K extends ApiChannel>(channel: K, ...args: Parameters<Api[K]>): ReturnType<Api[K]>
  on<K extends EventChannel>(channel: K, listener: (payload: Events[K]) => void): () => void
}
