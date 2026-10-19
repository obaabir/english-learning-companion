import { suggestedArticleKind } from '@shared/articles'
import { isWakeOnly, parseCommand, VOICE_EXAMPLES, weatherSentence, type VoiceAction } from '@shared/voice'
import type { NewNoteInput, NoteKind } from '@shared/types'
import { invoke, errorMessage } from '@renderer/lib/api'
import { useApp, type Page } from '@renderer/stores/app'
import { useChat } from '@renderer/stores/chat'
import { useLayout } from '@renderer/stores/layout'
import { getSelection, useMovie } from '@renderer/stores/movie'
import { youtubeStudy } from '@renderer/stores/youtube'
import { useIntents } from '@renderer/stores/intents'
import { useArticles } from '@renderer/features/articles/articleStore'
import { speak, speakable, stopSpeaking, useVoice } from './voiceStore'

/** The text a command like "save this word" is about, with its context and source. */
export interface VoiceSelection {
  text: string
  sentence: string | null
  suggestedKind: NoteKind
  fields: () => Promise<Partial<NewNoteInput>>
  /** Taken from the chat's current topic, not from a selection. */
  fromChat?: boolean
}

/**
 * What "this" means right now: the selection in the section on screen (Movie, YouTube, Articles),
 * otherwise text highlighted on the page, otherwise the text the chat is currently about.
 */
export function currentSelection(): VoiceSelection | null {
  const page = useApp.getState().page
  if (page === 'articles') {
    const s = useArticles.getState().selection
    if (s) {
      return {
        text: s.text,
        sentence: s.source === 'ai' ? null : s.sentence,
        suggestedKind: suggestedArticleKind(s.text),
        fields: async () => {
          const id = s.url && s.source !== 'ai' ? await useArticles.getState().ensureArticle(s.url, s.title ?? s.url).catch(() => null) : null
          return { articleId: id, mediaTitle: s.title, contextSentence: s.source === 'ai' ? null : s.sentence }
        }
      }
    }
  }
  if (page === 'movie' || page === 'youtube') {
    const sel = getSelection((page === 'movie' ? useMovie : youtubeStudy).getState())
    if (sel) {
      return {
        text: sel.text,
        sentence: sel.sentence,
        suggestedKind: sel.suggestedKind,
        fields: async () => ({ contextSentence: sel.sentence, mediaPath: sel.line?.mediaPath ?? null, mediaTitle: sel.line?.mediaTitle ?? null, timestampSec: sel.line?.start ?? null })
      }
    }
  }
  const dom = window.getSelection()?.toString().replace(/\s+/g, ' ').trim()
  if (dom && dom.length <= 600) {
    const words = dom.split(' ').length
    return { text: dom, sentence: null, suggestedKind: words === 1 ? 'word' : words < 5 ? 'phrase' : 'sentence', fields: async () => ({}) }
  }
  const focus = useChat.getState().focus
  if (focus) {
    return { fromChat: true, text: focus.text, sentence: focus.sentence ?? null, suggestedKind: focus.text.includes(' ') ? 'phrase' : 'word', fields: async () => ({ contextSentence: focus.sentence ?? null, mediaTitle: focus.articleTitle ?? null }) }
  }
  return null
}

const NEEDS_SELECTION = 'Select a word or sentence first (in Movie Mode, YouTube, Articles or any explanation), then say it again.'

export interface ActionResult {
  ok: boolean
  reply: string
  /** Said aloud (English); defaults to the reply when it is speakable. */
  say?: string
}

/** Runs one command. Destructive and unclear commands ask first (confirm / clarify in the panel). */
export async function runAction(action: VoiceAction, anySel: VoiceSelection | null): Promise<ActionResult | null> {
  const app = useApp.getState()
  // Saving and reading use only a real selection; explaining and questions may also use the chat's topic.
  const sel = action.type === 'explain' || action.type === 'ask' || !anySel?.fromChat ? anySel : null
  const voice = useVoice.getState()
  switch (action.type) {
    case 'open':
      app.setPage(action.page as Page)
      return { ok: true, reply: action.page === 'ielts' ? 'Opened IELTS. (The IELTS section itself is not built yet.)' : `Opened ${action.label}.` }

    case 'revision':
      useIntents.getState().request({ flashcardsMode: action.start ? 'review' : 'dashboard' })
      app.setPage('flashcards')
      return { ok: true, reply: action.start ? 'Starting your revision.' : "Here is today's revision." }

    case 'game':
      useIntents.getState().request({ gameMode: action.mode })
      app.setPage('games')
      return { ok: true, reply: `Starting ${action.label}.` }

    case 'read': {
      if (!sel) return { ok: false, reply: NEEDS_SELECTION }
      const text = action.what === 'sentence' && sel.sentence ? sel.sentence : sel.text
      void speak(text)
      return { ok: true, reply: `Reading: “${text}”`, say: '' }
    }

    case 'save': {
      if (!sel) return { ok: false, reply: NEEDS_SELECTION }
      const note = await invoke('notes:create', { kind: action.kind, text: sel.text, ...(await sel.fields()) })
      void app.refreshDue()
      return note.duplicate
        ? { ok: true, reply: `“${sel.text}” is already in your notes.` }
        : { ok: true, reply: `Saved “${sel.text}” to ${action.label}.`, say: `Saved to ${action.label}.` }
    }

    case 'flashcard': {
      if (!sel) return { ok: false, reply: NEEDS_SELECTION }
      const note = await invoke('notes:create', { kind: sel.suggestedKind, text: sel.text, ...(await sel.fields()) })
      const { created } = await invoke('flashcards:generate', { noteIds: [note.id] })
      void app.refreshDue()
      return { ok: true, reply: created ? `Flashcard created for “${sel.text}”.` : `“${sel.text}” already has a flashcard.`, say: created ? 'Flashcard created.' : 'It already has a flashcard.' }
    }

    case 'explain': {
      if (!sel) return { ok: false, reply: NEEDS_SELECTION }
      if (!app.settings?.hasGeminiKey) return { ok: false, reply: 'Add your Gemini API key in Settings to get explanations.' }
      if (app.page === 'articles' && useArticles.getState().selection?.text === sel.text) {
        void useArticles.getState().explain()
        return { ok: true, reply: `Explaining “${sel.text}” in the Explanation panel.`, say: 'Here is the explanation.' }
      }
      const from = sel.sentence && sel.sentence !== sel.text ? ` as used in: "${sel.sentence}"` : ''
      const q = `Explain "${sel.text}"${from}${action.bangla ? ' in Bangla' : ''}: its Bangla meaning, a simple English meaning, and one example sentence with its Bangla translation.`
      return ask(q, 'Here is the explanation.')
    }

    case 'ask': {
      if (!app.settings?.hasGeminiKey) return { ok: false, reply: 'I can only answer questions with Gemini. Add your Gemini API key in Settings.' }
      // "What does this mean?" — the question is about the current selection.
      if (sel && /\b(this|it|that)\b/i.test(action.question)) {
        useChat.getState().setFocus({ text: sel.text, sentence: sel.sentence, source: 'chat' })
        return ask(action.question, undefined, true)
      }
      return ask(action.question)
    }

    case 'weather': {
      const city = action.city ?? voice.settings.city
      if (!city) {
        voice.patch({ awaitingCity: true })
        return { ok: true, reply: 'Which city? Say or type the city name.' }
      }
      voice.patch({ reply: `Checking the weather in ${city}…` })
      if (action.city) voice.setSettings({ city: action.city })
      const w = await invoke('voice:weather', { city })
      return { ok: true, reply: weatherSentence(w) }
    }

    case 'time':
      return { ok: true, reply: `It's ${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.` }

    case 'date':
      return { ok: true, reply: `Today is ${new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}.` }

    case 'deleteChat': {
      const chat = useChat.getState()
      const active = chat.chats.find((c) => c.id === chat.activeChatId)
      if (!active) return { ok: false, reply: 'There is no open chat to delete.' }
      voice.patch({
        confirm: {
          question: `Delete the chat “${active.title}”? This can't be undone.`,
          confirmLabel: 'Delete chat',
          run: async () => {
            await useChat.getState().deleteChat(active.id)
            return 'Chat deleted.'
          }
        }
      })
      return null
    }

    case 'clarify':
      voice.patch({ clarify: { question: action.question, options: action.options } })
      return { ok: true, reply: action.question }

    case 'stop':
      stopSpeaking()
      return { ok: true, reply: 'Okay.', say: '' }

    case 'help':
      return { ok: true, reply: `You can say: ${VOICE_EXAMPLES.map((e) => `“${e}”`).join(', ')}. Or ask any question.`, say: 'Here are some things you can say.' }

    case 'unsupported':
      return { ok: false, reply: action.message }

    case 'unknown':
      return { ok: false, reply: "Sorry, I didn't understand. Try “Open Articles” or “Save this word to vocabulary”. Say “help” for more." }
  }
}

/** A question for Gemini through the app's chat (it stays in the chat history); the answer is shown here. */
async function ask(question: string, say?: string, withFocus = false): Promise<ActionResult> {
  const chat = useChat.getState()
  const page = useApp.getState().page
  if (page === 'movie' || page === 'youtube' || page === 'articles') useLayout.getState().setChatOpen(true)
  await chat.send(question, { focus: withFocus })
  const last = [...useChat.getState().messages].reverse().find((m) => m.role === 'model')
  const answer = last?.content ?? ''
  return { ok: !!answer, reply: answer || 'No answer came back. Try again.', say: say ?? speakable(answer) ?? 'Here is the answer.' }
}

/** Handles recognized or typed text: parse, run, show the result, speak it. */
export async function handleText(text: string, engine: 'windows' | 'gemini' | 'typed' | 'none', selection = currentSelection()): Promise<void> {
  const voice = useVoice.getState()
  const trimmed = text.trim()
  voice.patch({ heard: { text: trimmed, engine }, reply: null, clarify: null, confirm: null })
  if (!trimmed || isWakeOnly(trimmed)) {
    voice.patch({ status: 'error', reply: "I didn't catch that. Try again, or type the command below." })
    return
  }
  // The answer to "Which city?".
  const parsed = parseCommand(trimmed)
  // After "Which city?", a short answer that isn't another command is the city.
  const action: VoiceAction =
    voice.awaitingCity && (parsed.type === 'unknown' || (parsed.type === 'ask' && trimmed.split(/\s+/).length <= 3)) ? { type: 'weather', city: trimmed.replace(/[.?!]+$/, '') } : parsed
  voice.patch({ awaitingCity: false, status: 'processing' })
  try {
    const r = await runAction(action, selection)
    if (!r) {
      voice.patch({ status: 'idle' })
      return
    }
    voice.patch({ status: r.ok ? 'success' : 'error', reply: r.reply })
    const say = r.say ?? speakable(r.reply)
    if (say && useVoice.getState().settings.speak) void speak(say)
  } catch (err) {
    voice.patch({ status: 'error', reply: errorMessage(err) })
  }
}

