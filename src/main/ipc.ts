import { BrowserWindow, dialog, ipcMain, shell } from 'electron'
import type { Content } from '@google/genai'
import type { Api, ApiChannel, EventChannel, Events } from '@shared/ipcContract'
import type { AppSettings, DocCategory, Note, PlayerKind } from '@shared/types'
import type { Db } from './db'
import { getDocTarget, getMovieDoc, getSetting, listDocTargets, setDocTarget, setMovieDoc, setSetting } from './db/repos/settings'
import { deletePrompt, listPrompts, resolvePrompt, savePrompt, setDefaultPrompt } from './db/repos/prompts'
import {
  deleteNote,
  getNote,
  insertNote,
  listMediaTitles,
  listNoteMovies,
  listNotes,
  updateUserNote,
  updateNoteData,
  updateNoteKind
} from './db/repos/notes'
import { deleteChat, getChat, insertChat, insertMessage, listChats, listMessages } from './db/repos/chats'
import {
  deleteFlashcard,
  flashcardStats,
  insertFlashcard,
  listDueFlashcards,
  listFlashcards,
  noteIdsWithoutFlashcards,
  reviewFlashcard
} from './db/repos/flashcards'
import { hasSecret, setSecret } from './secrets'
import { detectMpvPath } from './mpv/MpvClient'
import { detectVlcPath } from './player/VlcClient'
import type { Player } from './player/Player'
import { YouTubeService } from './youtube/YouTubeService'
import { pronounce } from './practice/pronounce'
import { practiceStats, recordPractice } from './db/repos/practice'
import { PracticeRoom } from './practice/room'
import { windowsVoiceWav } from './practice/voice'
import { setDailyCap } from './db/repos/room'
import { listRecentVideos, saveVideoPosition } from './db/repos/youtube'
import { buildStudyMessage, DEFAULT_MODEL, fallbackFlashcard, type GeminiService } from './ai/gemini'
import type { GoogleService } from './google/GoogleService'
import { createNoteSync } from './notesSync'

interface Services {
  db: Db
  players: Record<PlayerKind, Player>
  gemini: GeminiService
  google: GoogleService
  window: () => BrowserWindow | null
}

const VIDEO_EXTENSIONS = ['mkv', 'mp4', 'avi', 'mov', 'webm', 'm4v', 'wmv', 'flv', 'ts', 'mpg', 'mpeg']
const SUBTITLE_EXTENSIONS = ['srt', 'ass', 'ssa', 'vtt']

function handle<K extends ApiChannel>(channel: K, fn: (...args: Parameters<Api[K]>) => ReturnType<Api[K]> | Awaited<ReturnType<Api[K]>>): void {
  ipcMain.handle(channel, (_e, ...args) => fn(...(args as Parameters<Api[K]>)))
}

export function send<K extends EventChannel>(win: BrowserWindow | null, channel: K, payload: Events[K]): void {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload)
}

export function mpvPath(db: Db): string {
  return getSetting(db, 'mpvPath') || detectMpvPath() || 'mpv'
}

export function vlcPath(db: Db): string {
  return getSetting(db, 'vlcPath') || detectVlcPath() || 'vlc'
}

/** VLC is the default player; mpv remains available in Settings. */
export function playerKind(db: Db): PlayerKind {
  return getSetting(db, 'player') === 'mpv' ? 'mpv' : 'vlc'
}

export function registerIpc(s: Services): void {
  const { db, players, gemini, google } = s
  const player = (): Player => players[playerKind(db)]
  const exePath = (): string => (playerKind(db) === 'vlc' ? vlcPath(db) : mpvPath(db))

  const settings = (): AppSettings => ({
    player: playerKind(db),
    vlcPath: vlcPath(db),
    autoExplain: getSetting(db, 'autoExplain') !== 'false',
    autoSaveToDocs: autoSaveToDocs(),
    mpvPath: mpvPath(db),
    geminiModel: getSetting(db, 'geminiModel') || DEFAULT_MODEL,
    googleClientId: getSetting(db, 'googleClientId') ?? '',
    hasGeminiKey: hasSecret(db, 'geminiApiKey'),
    hasGoogleSecret: hasSecret(db, 'googleClientSecret'),
    googleConnected: google.connected,
    googleAccount: google.account,
    docTargets: listDocTargets(db)
  })

  // ---- settings
  handle('settings:get', () => settings())
  handle('settings:update', (u) => {
    if (u.player !== undefined && u.player !== playerKind(db)) {
      // Close the previous player when switching.
      player().quit()
      setSetting(db, 'player', u.player)
    }
    if (u.vlcPath !== undefined) setSetting(db, 'vlcPath', u.vlcPath.trim() || null)
    if (u.autoExplain !== undefined) setSetting(db, 'autoExplain', String(u.autoExplain))
    if (u.autoSaveToDocs !== undefined) setSetting(db, 'autoSaveToDocs', String(u.autoSaveToDocs))
    if (u.mpvPath !== undefined) setSetting(db, 'mpvPath', u.mpvPath.trim() || null)
    if (u.geminiModel !== undefined) setSetting(db, 'geminiModel', u.geminiModel.trim() || null)
    if (u.geminiApiKey !== undefined) setSecret(db, 'geminiApiKey', u.geminiApiKey.trim() || null)
    if (u.googleClientId !== undefined) {
      setSetting(db, 'googleClientId', u.googleClientId.trim() || null)
      google.resetClient()
    }
    if (u.googleClientSecret !== undefined) {
      setSecret(db, 'googleClientSecret', u.googleClientSecret.trim() || null)
      google.resetClient()
    }
    return settings()
  })
  handle('settings:pickMpvPath', async () => {
    const res = await dialog.showOpenDialog(s.window()!, {
      title: 'Locate mpv.exe',
      properties: ['openFile'],
      filters: [{ name: 'mpv', extensions: ['exe'] }]
    })
    if (!res.canceled && res.filePaths[0]) setSetting(db, 'mpvPath', res.filePaths[0])
    return settings()
  })

  handle('settings:pickVlcPath', async () => {
    const res = await dialog.showOpenDialog(s.window()!, {
      title: 'Locate vlc.exe',
      properties: ['openFile'],
      filters: [{ name: 'VLC', extensions: ['exe'] }]
    })
    if (!res.canceled && res.filePaths[0]) setSetting(db, 'vlcPath', res.filePaths[0])
    return settings()
  })

  // ---- media player (VLC or mpv)
  handle('player:open', async (filePath) => {
    let file = filePath
    if (!file) {
      const res = await dialog.showOpenDialog(s.window()!, {
        title: 'Open a movie',
        properties: ['openFile'],
        filters: [
          { name: 'Videos', extensions: VIDEO_EXTENSIONS },
          { name: 'All files', extensions: ['*'] }
        ]
      })
      if (res.canceled || !res.filePaths[0]) return player().status
      file = res.filePaths[0]
    }
    return player().open(exePath(), file)
  })
  handle('player:addSubtitle', async (filePath) => {
    let file = filePath
    if (!file) {
      const res = await dialog.showOpenDialog(s.window()!, {
        title: 'Add a subtitle file',
        properties: ['openFile'],
        filters: [{ name: 'Subtitles', extensions: SUBTITLE_EXTENSIONS }]
      })
      if (res.canceled || !res.filePaths[0]) return player().status
      file = res.filePaths[0]
    }
    await player().addSubtitle(file)
    return player().status
  })
  handle('player:status', () => player().status)
  handle('player:control', (c) => player().control(c))
  handle('practice:pronounce', (text) => pronounce(text))
  handle('practice:record', (r) => recordPractice(db, r))
  handle('practice:stats', () => practiceStats(db))
  handle('practice:transcribeSpeech', ({ audioBase64, mimeType }) => gemini.transcribeSpeech(audioBase64, mimeType))
  handle('practice:meaning', (text) => gemini.meaningBn(text))
  handle('practice:voice', (text) => windowsVoiceWav(text))

  // ---- Practice Room
  const room = new PracticeRoom(db, gemini)
  handle('room:shadowed', ({ line, reps }) => room.shadowed(line, reps))
  handle('room:home', () => room.home())
  handle('room:review', ({ id, rating }) => room.review(id, rating))
  handle('room:calendar', ({ year, month }) => room.calendar(year, month))
  handle('room:day', (date) => room.day(date))
  handle('room:setDailyCap', (cap) => setDailyCap(db, cap))
  handle('room:remix', ({ date, refresh }) => room.remix(date, refresh))
  handle('room:yourTurn', ({ sentence, phrases }) => gemini.yourTurn(sentence, phrases))
  handle('player:togglePause', () => player().togglePause())
  handle('player:seekTo', ({ mediaPath, seconds }) => {
    if (mediaPath && /^https?:\/\//i.test(mediaPath)) throw new Error('Open this video from the YouTube page.')
    return player().seekTo(exePath(), mediaPath, seconds)
  })

  // ---- prompts
  handle('prompts:list', () => listPrompts(db))
  handle('prompts:save', (p) => savePrompt(db, p))
  handle('prompts:delete', (id) => deletePrompt(db, id))
  handle('prompts:setDefault', (id) => setDefaultPrompt(db, id))

  // ---- AI
  handle('ai:explain', async ({ requestId, promptId, context }) => {
    const prompt = resolvePrompt(db, promptId)
    return gemini.stream({
      systemInstruction: prompt?.instruction,
      contents: [{ role: 'user', parts: [{ text: buildStudyMessage(context) }] }],
      onDelta: (delta) => send(s.window(), 'ai:chunk', { requestId, delta }),
      fast: true
    })
  })
  handle('ai:listModels', () => gemini.listModels())

  // ---- chats
  handle('chats:list', () => listChats(db))
  handle('chats:create', ({ promptId, context, mediaPath, timestampSec, explanationMd }) => {
    const topic = context.text.trim()
    const chat = insertChat(db, {
      title: !topic ? 'New chat' : topic.length > 80 ? topic.slice(0, 77) + '…' : topic,
      promptId: resolvePrompt(db, promptId)?.id ?? null,
      contextText: context.text,
      contextSentence: context.sentence ?? null,
      mediaPath: mediaPath ?? null,
      mediaTitle: context.mediaTitle ?? null,
      timestampSec: timestampSec ?? null
    })
    if (!topic) return chat
    // Seed the conversation so every follow-up keeps the selection in context.
    insertMessage(db, chat.id, 'user', `I want to talk about this English:\n\n${buildStudyMessage(context)}`)
    insertMessage(
      db,
      chat.id,
      'model',
      explanationMd?.trim() || 'Sure! Ask me anything about its meaning, vocabulary, grammar, tone or how to use it.'
    )
    return chat
  })
  handle('chats:messages', (chatId) => listMessages(db, chatId))
  handle('chats:send', async ({ requestId, chatId, text }) => {
    const chat = getChat(db, chatId)
    if (!chat) throw new Error('Chat not found.')
    const history = listMessages(db, chatId)
    insertMessage(db, chatId, 'user', text)
    const contents: Content[] = [...history, { role: 'user' as const, content: text }].map((m) => ({
      role: m.role,
      parts: [{ text: m.content }]
    }))
    const reply = await gemini.stream({
      systemInstruction: resolvePrompt(db, chat.promptId)?.instruction,
      contents,
      onDelta: (delta) => send(s.window(), 'ai:chunk', { requestId, delta })
    })
    return insertMessage(db, chatId, 'model', reply)
  })
  handle('chats:delete', (chatId) => deleteChat(db, chatId))

  // ---- notes
  const extract = async (n: Pick<Note, 'kind' | 'text' | 'contextSentence' | 'explanationMd'>) => {
    if (!gemini.configured) return null
    try {
      return await gemini.extractNoteData({ kind: n.kind, text: n.text, sentence: n.contextSentence, explanationMd: n.explanationMd })
    } catch (err) {
      console.warn('Note extraction failed:', err)
      return null
    }
  }

  const { syncNote, syncMovie, syncPending } = createNoteSync(db, (docId, entry) => google.appendEntry(docId, entry))
  /** On by default: Google Docs is the learner's storage once connected. */
  function autoSaveToDocs(): boolean {
    return getSetting(db, 'autoSaveToDocs') !== 'false'
  }
  /** Background catch-up of notes that aren't in Google Docs yet. Never throws. */
  const catchUp = (): void => {
    if (!google.connected || !autoSaveToDocs()) return
    void syncPending().catch((err) => console.warn('Google Docs catch-up failed:', err))
  }

  /** Creates the default notes documents in the learner's Google Drive if none are chosen yet. */
  const ensureDefaultDocs = async (): Promise<void> => {
    const defaults: [DocCategory, string][] = [
      ['movie', 'English Learning Companion — Vocabulary & Sentences'],
      ['structures', 'English Learning Companion — Sentence Structures']
    ]
    for (const [category, title] of defaults) {
      if (getDocTarget(db, category)) continue
      const doc = await google.createDoc(title)
      setDocTarget(db, { category, docId: doc.id, title: doc.title })
    }
  }

  handle('notes:create', async (input) => {
    if (!input.text.trim()) throw new Error('Nothing to save.')
    // Save locally right away so the button never waits on Gemini or Google.
    const note = insertNote(db, input, null)
    const toDocs = input.saveToDocs || (autoSaveToDocs() && google.connected)
    void finishNote(note.id, toDocs)
    return note
  })

  /** Background: add Gemini's analysis to the note, then append it to Google Docs if wanted. */
  const finishNote = async (id: number, toDocs: boolean): Promise<void> => {
    const note = getNote(db, id)
    if (!note) return
    const data = await extract(note)
    if (data) updateNoteData(db, id, data)
    if (!toDocs) return
    try {
      const synced = await syncNote(id)
      send(s.window(), 'notes:docsResult', { noteId: id, ok: !synced.gdocError && !!synced.gdocSyncedAt, error: synced.gdocError })
    } catch (err) {
      send(s.window(), 'notes:docsResult', { noteId: id, ok: false, error: err instanceof Error ? err.message : String(err) })
    }
  }
  handle('notes:list', (filter) => listNotes(db, filter))
  handle('notes:get', (id) => getNote(db, id))
  handle('notes:updateKind', ({ id, kind }) => {
    updateNoteKind(db, id, kind)
    return getNote(db, id)!
  })
  handle('notes:delete', (id) => deleteNote(db, id))
  handle('notes:syncToDocs', (id) => syncNote(id))
  handle('notes:reanalyze', async (id) => {
    const note = getNote(db, id)
    if (!note) throw new Error('Note not found.')
    if (!gemini.configured) throw new Error('Add your Gemini API key in Settings first.')
    updateNoteData(
      db,
      id,
      await gemini.extractNoteData({ kind: note.kind, text: note.text, sentence: note.contextSentence, explanationMd: note.explanationMd })
    )
    return getNote(db, id)!
  })
  handle('notes:mediaTitles', () => listMediaTitles(db))
  handle('notes:movies', () =>
    listNoteMovies(db).map((m) => {
      const doc = getMovieDoc(db, m.mediaPath)
      return { ...m, doc: doc ? { docId: doc.docId, title: doc.docTitle } : null }
    })
  )
  handle('notes:updateUserNote', ({ id, userNote }) => {
    updateUserNote(db, id, userNote)
    return getNote(db, id)!
  })
  handle('notes:syncMovie', (mediaPath) => syncMovie(mediaPath))

  // ---- flashcards
  handle('flashcards:stats', () => flashcardStats(db))
  handle('flashcards:generate', async (args) => {
    const pending = new Set(noteIdsWithoutFlashcards(db))
    const ids = (args?.noteIds ?? [...pending]).filter((id) => pending.has(id))
    const notes = ids.map((id) => getNote(db, id)).filter((n): n is Note => !!n)
    let created = 0
    for (let i = 0; i < notes.length; i += 15) {
      const batch = notes.slice(i, i + 15)
      let generated = new Map<number, ReturnType<typeof fallbackFlashcard>>()
      if (gemini.configured) {
        try {
          generated = await gemini.generateFlashcards(batch)
        } catch (err) {
          if (i === 0 && !batch.some((n) => n.data)) throw err
          console.warn('Flashcard generation failed, using note data:', err)
        }
      }
      for (const note of batch) {
        const card = generated.get(note.id) ?? fallbackFlashcard(note)
        insertFlashcard(db, note.id, card.front, card.back)
        created++
      }
    }
    return { created }
  })
  handle('flashcards:due', (limit) => listDueFlashcards(db, limit))
  handle('flashcards:list', () => listFlashcards(db))
  handle('flashcards:review', ({ id, rating }) => reviewFlashcard(db, id, rating))
  handle('flashcards:delete', (id) => deleteFlashcard(db, id))

  // ---- Google
  handle('google:connect', async () => {
    await google.connect()
    // Ready to use straight away: create the notes documents, then send any notes saved before.
    await ensureDefaultDocs()
    catchUp()
    return settings()
  })
  handle('google:syncPending', () => syncPending())

  // ---- YouTube (Watch & Learn)
  const youtube = new YouTubeService(db, gemini, (p) => send(s.window(), 'youtube:transcriptProgress', p))
  handle('youtube:info', (link) => youtube.info(link))
  handle('youtube:transcribe', ({ videoId, durationSec }) => youtube.transcribe(videoId, durationSec))
  handle('youtube:recent', () => listRecentVideos(db))
  handle('youtube:savePosition', ({ videoId, seconds }) => saveVideoPosition(db, videoId, seconds))
  setTimeout(catchUp, 3000)
  handle('google:disconnect', async () => {
    await google.disconnect()
    return settings()
  })
  handle('google:listDocs', (query) => google.listDocs(query))
  handle('google:createDoc', async ({ title, category }) => {
    const doc = await google.createDoc(title)
    setDocTarget(db, { category, docId: doc.id, title: doc.title })
    catchUp()
    return settings()
  })
  handle('google:setTarget', ({ category, doc }) => {
    setDocTarget(db, { category, docId: doc.id, title: doc.title })
    catchUp()
    return settings()
  })
  handle('google:setMovieDoc', ({ mediaPath, mediaTitle, doc }) => {
    setMovieDoc(db, { mediaPath, mediaTitle, docId: doc.id, docTitle: doc.title })
    return { docId: doc.id, title: doc.title }
  })
  handle('google:createMovieDoc', async ({ mediaPath, mediaTitle, title }) => {
    const doc = await google.createDoc(title.trim() || `${mediaTitle} — English Notes`)
    setMovieDoc(db, { mediaPath, mediaTitle, docId: doc.id, docTitle: doc.title })
    return { docId: doc.id, title: doc.title }
  })
  handle('google:openDoc', (docId) => shell.openExternal(`https://docs.google.com/document/d/${encodeURIComponent(docId)}/edit`))
}
