import { BrowserWindow, dialog, ipcMain, net, shell } from 'electron'
import { app } from 'electron'
import { join } from 'node:path'
import { EwService } from './ew/EwService'
import type { Content } from '@google/genai'
import type { Api, ApiChannel, EventChannel, Events } from '@shared/ipcContract'
import type { AppSettings, DocCategory, Note, PlayerKind } from '@shared/types'
import type { ExplainAnalysis } from '@shared/explainAnalysis'
import type { Db } from './db'
import { getDocTarget, getMovieDoc, getSetting, listDocTargets, setDocTarget, setMovieDoc, setSetting } from './db/repos/settings'
import { deletePrompt, listPrompts, resolvePrompt, savePrompt, setDefaultPrompt } from './db/repos/prompts'
import {
  deleteNote,
  getNote,
  findDuplicateNote,
  insertNote,
  listMediaTitles,
  listNoteMovies,
  listNotes,
  setNoteTarget,
  updateUserNote,
  updateNoteData,
  updateNoteKind
} from './db/repos/notes'
import { deleteChat, getChat, insertChat, insertMessage, listChats, listMessages } from './db/repos/chats'
import {
  deleteFlashcard,
  editFlashcard,
  flashcardStats,
  insertFlashcard,
  listDueFlashcards,
  revisionDashboard,
  listFlashcards,
  noteIdsWithoutFlashcards,
  reviewFlashcard
} from './db/repos/flashcards'
import { getSecret, hasSecret, setSecret } from './secrets'
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
import { buildFocusedQuestion, buildStudyMessage, EXPLAIN_LIST_NOTE, DEFAULT_MODEL, fallbackFlashcard, type GeminiService } from './ai/gemini'
import type { GoogleService } from './google/GoogleService'
import { createNoteSync } from './notesSync'
import { getArticleDetail, listArticles, recordArticle, setArticleNote } from './db/repos/articles'
import { buildArticleExplain } from './ai/article'
import { recognizeWav, WakeListener } from './voice/recognizer'
import { getHomeWeather, getWeather } from './voice/weather'
import { createReading } from './reading/service'
import { addReadingTarget, deleteReadingSession, getReadingSession, listReadingSessions, saveReadingSession, setReadingPosition } from './db/repos/reading'
import { LiveVoice } from './voice/live'
import { currentTime, weatherForVoice } from './voice/liveMainTools'
import { initialTarget, isTargetLike, normTerm } from '@shared/vocab'
import { ensureTargetAndCard, withFlashcard } from './learning'
import { createVocabBook, VB_DOC_DEFAULT_TITLE } from './vocabBook/service'
import {
  createBook,
  dashboard as vbDashboard,
  editItem as editVbItem,
  getItem as getVbItem,
  listBooks,
  listItems,
  listMistakes as listVbMistakes,
  listSources,
  mistakeReview,
  recordAnswer,
  sessionFor as vbSession,
  updateBook
} from './db/repos/vocabBook'
import { COMMAND_PHRASES, COMMAND_TAILS, WAKE_PHRASES } from '@shared/voice'

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
  handle('fsp:check', (input) => gemini.fspCheck(input))
  handle('fsp:example', (args) => gemini.fspExample(args))
  handle('fsp:lesson', (args) => gemini.fspLesson(args))
  const ew = new EwService(app.getPath('userData'))
  handle('ew:call', (req) => ew.call(req))
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
  // Explain: vocabulary, idioms and phrasal verbs of the selection (kept for this session, so asking again is instant).
  const sentenceWordsCache = new Map<string, Promise<ExplainAnalysis>>()
  handle('ai:analyze', (args) => {
    if (!gemini.configured) throw new Error('Add your Gemini API key in Settings to see the vocabulary.')
    const norm = (s: string | null | undefined): string => (s ?? '').replace(/\s+/g, ' ').trim().toLowerCase()
    const key = `${norm(args.text)}|${norm(args.sentence)}`
    let job = sentenceWordsCache.get(key)
    if (!job) {
      job = gemini.analyzeText(args)
      // A failed answer is not kept, so "Try again" asks Gemini again.
      job.catch(() => sentenceWordsCache.delete(key))
      if (sentenceWordsCache.size > 300) sentenceWordsCache.delete(sentenceWordsCache.keys().next().value!)
      sentenceWordsCache.set(key, job)
    }
    return job
  })
  handle('ai:explain', async ({ requestId, promptId, context }) => {
    const prompt = resolvePrompt(db, promptId)
    return gemini.stream({
      systemInstruction: prompt?.instruction,
      contents: [{ role: 'user', parts: [{ text: buildStudyMessage(context) + EXPLAIN_LIST_NOTE }] }],
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
  handle('chats:send', async ({ requestId, chatId, text, focus }) => {
    const chat = getChat(db, chatId)
    if (!chat) throw new Error('Chat not found.')
    const history = listMessages(db, chatId)
    insertMessage(db, chatId, 'user', text, focus)
    // Each question carries the text that was highlighted when it was asked, so later turns keep it too.
    const contents: Content[] = [...history, { role: 'user' as const, content: text, focus }].map((m) => ({
      role: m.role,
      parts: [{ text: m.role === 'user' ? buildFocusedQuestion(m.content, m.focus) : m.content }]
    }))
    const reply = await gemini.stream({
      systemInstruction: resolvePrompt(db, chat.promptId)?.instruction,
      contents,
      onDelta: (delta) => send(s.window(), 'ai:chunk', { requestId, delta })
    })
    return insertMessage(db, chatId, 'model', reply)
  })
  handle('chats:delete', (chatId) => deleteChat(db, chatId))

  // ---- articles (in-app browser / pasted text)
  handle('articles:record', (input) => recordArticle(db, input))
  handle('articles:list', () => listArticles(db))
  handle('articles:get', (id) => getArticleDetail(db, id))
  handle('articles:setNote', ({ id, note }) => setArticleNote(db, id, note))
  handle('articles:explain', async ({ requestId, ...args }) => {
    if (!args.text.trim()) throw new Error('Select a word or sentence first.')
    const { systemInstruction, message } = buildArticleExplain(args)
    return gemini.stream({
      systemInstruction,
      contents: [{ role: 'user', parts: [{ text: message }] }],
      onDelta: (delta) => send(s.window(), 'ai:chunk', { requestId, delta }),
      fast: true
    })
  })

  // ---- notes
  let extracting = 0
  const waiting: (() => void)[] = []
  const extract = async (n: Pick<Note, 'kind' | 'text' | 'contextSentence' | 'explanationMd'>) => {
    if (!gemini.configured) return null
    // At most two analyses at a time; the rest wait their turn.
    if (extracting >= 2) await new Promise<void>((resolve) => waiting.push(resolve))
    extracting++
    try {
      return await extractNow(n)
    } finally {
      extracting--
      waiting.shift()?.()
    }
  }
  const extractNow = async (n: Pick<Note, 'kind' | 'text' | 'contextSentence' | 'explanationMd'>) => {
    try {
      return await gemini.extractNoteData({ kind: n.kind, text: n.text, sentence: n.contextSentence, explanationMd: n.explanationMd })
    } catch (err) {
      console.warn('Note extraction failed:', err)
      return null
    }
  }

  const { syncNote, syncMovie, syncPending, overview } = createNoteSync(
    db,
    (docId, entry) => google.appendEntry(docId, entry),
    (docId, text) => google.docContains(docId, text)
  )
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
      ['movie_vocab', 'English Learning Companion — Vocabulary & Sentences'],
      ['structures', 'English Learning Companion — Sentence Structures']
    ]
    for (const [category, title] of defaults) {
      if (getDocTarget(db, category)) continue
      const doc = await google.createDoc(title)
      setDocTarget(db, { category, docId: doc.id, title: doc.title })
    }
  }

  /** Saved words or their cards changed: open lists (Revision, Flashcards) reload at once. */
  const learningChanged = (): void => send(s.window(), 'learning:changed', {})

  handle('notes:create', async (input) => {
    if (!input.text.trim()) throw new Error('Nothing to save.')
    // The same item (same text, type, sentence and source) is not saved twice; a different
    // sentence or source makes a separate record, so different meanings never merge.
    const existing = findDuplicateNote(db, input)
    if (existing) {
      if (input.saveToDocs && !existing.gdocSyncedAt) void finishNote(existing.id, true)
      return { ...existing, duplicate: true }
    }
    // Save locally right away so the button never waits on Gemini or Google.
    const note = insertNote(db, input, null)
    learningChanged()
    const toDocs = input.saveToDocs || (autoSaveToDocs() && google.connected)
    void finishNote(note.id, toDocs)
    return note
  })

  /** Background: add Gemini's analysis to the note, its target and flashcard, then append it to Google Docs if wanted. */
  const finishNote = async (id: number, toDocs: boolean): Promise<void> => {
    const note = getNote(db, id)
    if (!note) return
    const data = await extract(note)
    if (data) {
      // Your own Bangla meaning (e.g. from an imported list) is kept.
      if (note.data?.meaning_bn?.trim()) data.meaning_bn = note.data.meaning_bn
      updateNoteData(db, id, data)
    }
    try {
      ensureTargetAndCard(db, id)
    } catch (err) {
      console.warn('Could not make the flashcard:', err)
    }
    // The card (made once Gemini has chosen the word to learn) shows up straight away.
    learningChanged()
    if (!toDocs) return
    try {
      const synced = await syncNote(id)
      send(s.window(), 'notes:docsResult', { noteId: id, ok: !synced.gdocError && !!synced.gdocSyncedAt, error: synced.gdocError })
    } catch (err) {
      send(s.window(), 'notes:docsResult', { noteId: id, ok: false, error: err instanceof Error ? err.message : String(err) })
    }
  }
  // Each item comes with its flashcard (revision status): one record, seen the same everywhere.
  handle('notes:list', (filter) => listNotes(db, filter).map((n) => withFlashcard(db, n)))
  handle('notes:get', (id) => {
    const n = getNote(db, id)
    return n ? withFlashcard(db, n) : null
  })
  handle('notes:updateKind', ({ id, kind }) => {
    updateNoteKind(db, id, kind)
    learningChanged()
    return getNote(db, id)!
  })
  handle('notes:delete', (id) => {
    deleteNote(db, id)
    learningChanged()
  })
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
    let skipped = 0
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
        const g = generated.get(note.id)
        // The front is the word/phrase to learn: the item's target, or the key expression Gemini chose
        // (which then becomes the target). Never the whole sentence.
        const target = note.target ?? (g && isTargetLike(g.front) && normTerm(g.front) !== normTerm(note.text) ? g.front : initialTarget(note))
        if (!target) {
          skipped++
          continue
        }
        if (!note.target) setNoteTarget(db, note.id, target)
        const fb = fallbackFlashcard({ ...note, target })
        const back = g && normTerm(g.front) === normTerm(target) ? g.back : fb.back
        insertFlashcard(db, note.id, target, back)
        created++
      }
    }
    learningChanged()
    return { created, skipped }
  })
  handle('flashcards:edit', (edit) => {
    const card = editFlashcard(db, edit)
    learningChanged()
    return card
  })
  handle('flashcards:due', (limit) => listDueFlashcards(db, limit))
  handle('flashcards:list', () => listFlashcards(db))
  handle('flashcards:review', ({ id, rating }) => reviewFlashcard(db, id, rating))
  handle('flashcards:delete', (id) => {
    deleteFlashcard(db, id)
    learningChanged()
  })
  handle('revision:dashboard', () => revisionDashboard(db))

  // ---- Reading Companion (Articles): prepared passages of physical books
  const reading = createReading({ gemini, imagesDir: join(app.getPath('userData'), 'reading', 'pages') })
  handle('reading:list', () => listReadingSessions(db))
  handle('reading:get', (id) => getReadingSession(db, id))
  handle('reading:save', (input) => saveReadingSession(db, input))
  handle('reading:position', ({ id, page, paragraph }) => setReadingPosition(db, id, page, paragraph))
  handle('reading:addTarget', ({ id, target }) => addReadingTarget(db, id, target))
  handle('reading:delete', (id) => deleteReadingSession(db, id))
  handle('reading:readPage', (args) => reading.readPage(args))
  handle('reading:pageImage', (file) => reading.pageImage(file))

  // ---- Vocabulary Book Learning (separate module: own tables, deck, schedule, mistakes, Google Doc)
  const vb = createVocabBook(db, {
    gemini,
    google,
    imagesDir: join(app.getPath('userData'), 'vocab-book', 'images'),
    autoSync: () => google.connected && autoSaveToDocs(),
    onChange: (bookId) => send(s.window(), 'vb:changed', { bookId })
  })
  handle('vb:books', () => listBooks(db))
  handle('vb:createBook', ({ title, dailyNew }) => createBook(db, title, dailyNew))
  handle('vb:updateBook', ({ id, ...patch }) => updateBook(db, id, patch))
  handle('vb:items', (bookId) => listItems(db, bookId))
  handle('vb:sources', (bookId) => listSources(db, bookId))
  handle('vb:sourceImage', (file) => vb.sourceImage(file))
  handle('vb:extractImage', (args) => vb.extractImage(args))
  handle('vb:extractText', (args) => vb.extractText(args))
  handle('vb:import', (args) => {
    const r = vb.importReviewed(args)
    return { added: r.added.length, skipped: r.skipped, firstSeq: r.added[0]?.seq ?? null, lastSeq: r.added.at(-1)?.seq ?? null }
  })
  handle('vb:enrich', (ids) => vb.enrich(ids))
  handle('vb:editItem', (edit) => editVbItem(db, edit))
  handle('vb:session', (bookId) => vbSession(db, bookId))
  handle('vb:mistakeReview', (bookId) => mistakeReview(db, bookId))
  handle('vb:answer', (answer) => recordAnswer(db, answer))
  handle('vb:checkSentence', async ({ itemId, sentence }) => {
    const item = getVbItem(db, itemId)
    if (!item) throw new Error('Word not found.')
    if (!gemini.configured) return { available: false, correct: false, corrected: '', explanation: 'Add your Gemini key in Settings to have sentences checked.' }
    const r = await gemini.fspCheck({
      term: item.term,
      type: item.term.includes(' ') ? 'phrase' : 'word',
      meaningBn: item.meaningBn,
      sentence,
      challenge: `Use "${item.term}" correctly with this meaning: ${item.definitionEn || item.meaningBn}`,
      context: null
    })
    const correct = r.status === 'correct' && r.usesTargetCorrectly
    const explanation = [r.errors.map((e) => `${e.wrongText} → ${e.fix}: ${e.ruleBangla}`).join('\n'), r.optionalTip].filter(Boolean).join('\n')
    return { available: true, correct, corrected: r.corrected, explanation }
  })
  handle('vb:dashboard', (bookId) => vbDashboard(db, bookId))
  handle('vb:mistakes', ({ bookId, itemId }) => listVbMistakes(db, bookId, itemId))
  handle('vb:doc', () => vb.getDoc())
  handle('vb:setDoc', (doc) => vb.setDoc(doc))
  handle('vb:createDoc', async (title) => vb.setDoc(await google.createDoc(title.trim() || VB_DOC_DEFAULT_TITLE)))
  handle('vb:sync', (bookId) => vb.syncBook(bookId))

  // ---- voice (free first: Windows offline recognition; Gemini only as a fallback)
  handle('voice:recognize', async ({ audioBase64, allowGemini }) => {
    let offline: Awaited<ReturnType<typeof recognizeWav>> | null = null
    let offlineError: unknown = null
    try {
      offline = await recognizeWav(audioBase64, { phrases: COMMAND_PHRASES, tails: COMMAND_TAILS, dictation: true })
    } catch (err) {
      offlineError = err
    }
    // A known command heard clearly: done, offline.
    if (offline && offline.text && offline.grammar !== 'dictation' && offline.confidence >= 0.5) {
      return { text: offline.text, engine: 'windows' as const, confidence: offline.confidence }
    }
    // Windows' free-speech (dictation) grammar sometimes competes with the commands, so that nothing is
    // recognized or a low-confidence jumble wins. Then try once more with the command phrases only, and
    // accept only a clear match (a confident free-speech result is a real question and goes on below).
    if (offline && (!offline.text || offline.confidence < (offline.grammar === 'dictation' ? 0.6 : 0.5))) {
      try {
        const commandsOnly = await recognizeWav(audioBase64, { phrases: COMMAND_PHRASES, tails: COMMAND_TAILS, dictation: false })
        if (commandsOnly.text && commandsOnly.confidence >= 0.6) return { text: commandsOnly.text, engine: 'windows' as const, confidence: commandsOnly.confidence }
      } catch {
        // fall through to Gemini / nothing heard
      }
    }
    // Anything else (a question, unclear speech): Gemini writes it down, if allowed.
    if (allowGemini && gemini.configured) {
      const text = (await gemini.transcribeSpeech(audioBase64, 'audio/wav')).trim()
      if (text) return { text, engine: 'gemini' as const, confidence: 1 }
    }
    if (offline?.text) return { text: offline.text, engine: 'windows' as const, confidence: offline.confidence }
    if (offlineError) throw offlineError
    return { text: '', engine: 'none' as const, confidence: 0 }
  })
  const wake = new WakeListener()
  app.on('before-quit', () => wake.stop())
  handle('voice:wake', ({ on }) => {
    if (!on) wake.stop()
    else if (!wake.running)
      wake.start(
        WAKE_PHRASES,
        (h) => send(s.window(), 'voice:wakeHeard', { text: h.text, confidence: h.confidence }),
        (state, message) => send(s.window(), 'voice:wakeState', { state, message })
      )
    return { running: wake.running }
  })
  // Chromium's network stack (system proxy, reliable DNS) rather than Node's fetch.
  handle('voice:weather', ({ city }) => getWeather(city, (url, init) => net.fetch(String(url), { ...init, signal: AbortSignal.timeout(30_000) })))
  handle('weather:home', ({ city }) => getHomeWeather(city, (url, init) => net.fetch(String(url), { ...init, signal: AbortSignal.timeout(30_000) })))

  // ---- Voice Mode (Gemini Live): a real-time spoken conversation. The key stays in this process;
  // the model can only use the validated app tools (shared/liveTools). Time comes from this
  // computer's clock and weather from Open-Meteo, here; app actions run in the window.
  let liveOpts = { city: '', timezone: '' }
  let nextCallId = 1
  const pendingCalls = new Map<number, (result: Record<string, unknown>) => void>()
  const live = new LiveVoice({
    getKey: () => getSecret(db, 'geminiApiKey'),
    emit: (e) => send(s.window(), 'live:event', e),
    runTool: async (name, args) => {
      if (name === 'get_current_time') return currentTime(args.timezone, liveOpts.timezone)
      if (name === 'get_weather')
        return weatherForVoice(args.city, liveOpts.city, (city) => getWeather(city, (url, init) => net.fetch(String(url), { ...init, signal: AbortSignal.timeout(30_000) })))
      const callId = nextCallId++
      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          pendingCalls.delete(callId)
          resolve({ ok: false, error: 'The app did not answer in time.' })
        }, 20_000)
        pendingCalls.set(callId, (result) => {
          clearTimeout(timer)
          resolve(result)
        })
        send(s.window(), 'live:toolCall', { callId, name, args })
      })
    },
    // Tests only (never in the installed app): a local fake Live server.
    baseUrl: !app.isPackaged ? process.env.ELC_LIVE_BASE_URL || undefined : undefined
  })
  app.on('before-quit', () => void live.end('quit'))
  handle('live:start', ({ city, timezone }) => {
    liveOpts = { city: String(city ?? '').slice(0, 80), timezone: String(timezone ?? '').slice(0, 60) }
    return live.start()
  })
  handle('live:audio', (pcm) => live.sendAudio(pcm))
  handle('live:pause', () => live.pauseAudio())
  handle('live:text', (text) => live.sendText(text))
  handle('live:end', () => live.end('user'))
  handle('live:toolResult', ({ callId, result }) => {
    pendingCalls.get(callId)?.(result && typeof result === 'object' ? result : { ok: false, error: 'No result.' })
    pendingCalls.delete(callId)
  })
  handle('games:practice', async ({ mode, sentences }) => {
    if (!gemini.configured) throw new Error('Add your Gemini API key in Settings to make practice sentences.')
    if (!sentences.length) return []
    return gemini.practiceItems(mode, sentences.slice(0, 10))
  })

  // ---- Google
  handle('google:connect', async () => {
    await google.connect()
    // Ready to use straight away: create the notes documents, then send any notes saved before.
    await ensureDefaultDocs()
    catchUp()
    return settings()
  })
  handle('google:syncPending', () => syncPending())
  handle('google:syncOverview', () => overview())

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
