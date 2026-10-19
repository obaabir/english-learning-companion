import { create } from 'zustand'
import type { WebviewTag } from 'electron'
import { domainOf, isPasted, type ArticleBlock, type ArticleInput, type WebSelection } from '@shared/articles'
import { errorMessage, invoke, newRequestId, streamCall } from '@renderer/lib/api'
import { useChat } from '@renderer/stores/chat'
import { useArticleLayout } from './articleLayout'

export type ArticleView = 'browse' | 'reader' | 'history'

/** A word or sentence selected in an article (in-app browser, Reader view or Chrome). */
export interface ArticleSelection {
  key: string
  text: string
  /** The original sentence from the article. */
  sentence: string | null
  /** The original paragraph around it. */
  paragraph: string | null
  url: string | null
  title: string | null
  domain: string | null
  source: 'browser' | 'reader' | 'chrome' | 'ai'
}

export interface ArticleExplanation {
  text: string
  status: 'streaming' | 'done' | 'error'
  error?: string
}

/** What Reader view shows: the original article text (live page, saved copy or pasted text). */
export interface ReaderDoc {
  url: string
  title: string
  domain: string
  siteName?: string | null
  byline?: string | null
  blocks: ArticleBlock[]
  /** Shown from the saved copy (the page itself may have changed or gone). */
  saved?: boolean
}

/** The in-app browser element, for the toolbar (back, forward, reload, Reader). */
export const browser: { current: WebviewTag | null } = { current: null }

interface ArticlesState {
  view: ArticleView
  setView: (v: ArticleView) => void
  /** The page open in the in-app browser. */
  page: { url: string; title: string } | null
  setPage: (p: { url: string; title: string } | null) => void
  /** First address opened (the browser element is created with it). */
  startUrl: string | null
  openUrl: (url: string) => void
  reader: ReaderDoc | null
  setReader: (r: ReaderDoc | null) => void
  /** Readable text the page offered, per address. */
  extracted: Record<string, ArticleInput>
  articleIds: Record<string, number>
  /** Increases whenever the history changes, so it reloads. */
  historyVersion: number
  historyDetailId: number | null
  openHistory: (id: number | null) => void

  selection: ArticleSelection | null
  select: (sel: Omit<ArticleSelection, 'key'> | null) => void
  explanations: Record<string, ArticleExplanation>
  explain: () => Promise<void>

  /** Adds the article to the history (once per address) and returns its id. */
  ensureArticle: (url: string, title: string) => Promise<number | null>
  recordExtracted: (article: ArticleInput) => Promise<void>
  /** Text sent from Chrome: select it, keep the article in history and explain it. */
  receiveWeb: (sel: WebSelection, source: 'chrome' | 'browser') => Promise<void>
}

const selKey = (s: Omit<ArticleSelection, 'key'>): string => `${s.url ?? ''}|${s.text}|${s.sentence ?? ''}`

export const useArticles = create<ArticlesState>((set, get) => ({
  view: 'browse',
  setView: (view) => set({ view }),
  page: null,
  setPage: (page) => set({ page }),
  startUrl: null,
  openUrl: (url) => {
    set({ view: 'browse' })
    if (!get().startUrl) set({ startUrl: url })
    else void browser.current?.loadURL(url).catch(() => undefined)
  },
  reader: null,
  setReader: (reader) => set({ reader }),
  extracted: {},
  articleIds: {},
  historyVersion: 0,
  historyDetailId: null,
  openHistory: (historyDetailId) => set({ historyDetailId, view: 'history' }),

  selection: null,
  select: (sel) => {
    if (!sel) return set({ selection: null })
    const selection = { ...sel, key: selKey(sel) }
    set({ selection })
    // The chat's next question is about this text, with the article around it (Phase 1 focus).
    const done = get().explanations[selection.key]
    useChat.getState().setFocus({
      text: sel.text,
      sentence: sel.source === 'ai' ? null : sel.sentence,
      excerpt: sel.paragraph,
      source: sel.source === 'ai' ? 'explanation' : 'article',
      articleTitle: sel.title,
      articleDomain: sel.domain,
      explanation: done?.status === 'done' ? done.text : null
    })
  },
  explanations: {},
  explain: async () => {
    const sel = get().selection
    if (!sel) return
    const key = sel.key
    // The explanation appears in the side panel, so show it if it was hidden.
    useArticleLayout.getState().setSide(true)
    const put = (e: ArticleExplanation): void => set({ explanations: { ...get().explanations, [key]: e } })
    put({ text: '', status: 'streaming' })
    if (sel.url && sel.source !== 'ai') void get().ensureArticle(sel.url, sel.title ?? sel.url)
    const requestId = newRequestId()
    try {
      const text = await streamCall(
        requestId,
        (d) => put({ text: (get().explanations[key]?.text ?? '') + d, status: 'streaming' }),
        () =>
          invoke('articles:explain', {
            requestId,
            text: sel.text,
            sentence: sel.source === 'ai' ? null : sel.sentence,
            paragraph: sel.source === 'ai' ? null : sel.paragraph,
            title: sel.title,
            domain: sel.domain
          })
      )
      put({ text, status: 'done' })
      // Follow-up questions in the chat also get the explanation just given.
      const focus = useChat.getState().focus
      if (focus && focus.text === sel.text && get().selection?.key === key) useChat.getState().setFocus({ ...focus, explanation: text })
    } catch (err) {
      put({ text: get().explanations[key]?.text ?? '', status: 'error', error: errorMessage(err) })
    }
  },

  ensureArticle: async (url, title) => {
    if (!url || (!/^https?:\/\//.test(url) && !isPasted(url))) return null
    const known = get().articleIds[url]
    if (known) return known
    const article = await invoke('articles:record', get().extracted[url] ?? { url, title: title || domainOf(url) })
    set({ articleIds: { ...get().articleIds, [url]: article.id }, historyVersion: get().historyVersion + 1 })
    return article.id
  },
  recordExtracted: async (article) => {
    set({ extracted: { ...get().extracted, [article.url]: article } })
    const saved = await invoke('articles:record', article)
    set({ articleIds: { ...get().articleIds, [article.url]: saved.id }, historyVersion: get().historyVersion + 1 })
  },
  receiveWeb: async (sel, source) => {
    if (sel.article) await get().recordExtracted(sel.article).catch(() => undefined)
    get().select({
      text: sel.text,
      sentence: sel.sentence,
      paragraph: sel.paragraph,
      url: sel.url,
      title: sel.article?.title ?? sel.title,
      domain: domainOf(sel.url),
      source
    })
    await get().ensureArticle(sel.url, sel.title).catch(() => null)
    if (source === 'chrome') {
      const s = get().selection
      if (s && !get().explanations[s.key]) await get().explain()
    }
  }
}))
