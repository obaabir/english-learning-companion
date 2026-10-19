import { useEffect, useState, type ReactNode } from 'react'
import { Group, Panel, Separator } from 'react-resizable-panels'
import { ArrowLeft, ArrowRight, BookOpenText, ClipboardPaste, Globe, History, Info, Puzzle, RotateCw, Search } from 'lucide-react'
import { domainOf, PASTED_PREFIX, suggestedArticleKind, type Article, type ArticleBlock, type ArticleInput } from '@shared/articles'
import { invoke } from '@renderer/lib/api'
import { useApp } from '@renderer/stores/app'
import { useChat } from '@renderer/stores/chat'
import { useLayout } from '@renderer/stores/layout'
import { registerSelectionScope } from '@renderer/components/SelectionSaveMenu'
import { Button, Input, Textarea } from '@renderer/components/ui'
import { cn } from '@renderer/lib/cn'
import { browser, useArticles, type ArticleView } from './articleStore'
import { ArticleBrowser } from './ArticleBrowser'
import { ReaderView } from './ReaderView'
import { ArticleHistory } from './ArticleHistory'
import { ArticleStudyPanel } from './ArticleStudyPanel'

/** Turns what was typed into an address: a URL as is, otherwise a DuckDuckGo search. */
export function toAddress(input: string): string {
  const t = input.trim()
  if (/^https?:\/\//i.test(t)) return t
  if (/^[^\s]+\.[a-z]{2,}(\/\S*)?$/i.test(t)) return `https://${t}`
  return `https://duckduckgo.com/?q=${encodeURIComponent(t)}`
}

/** Articles: read any website in the in-app browser (or send text from Chrome), study the text you select. */
export function ArticlesView({ active }: { active: boolean }): ReactNode {
  const view = useArticles((s) => s.view)
  const startUrl = useArticles((s) => s.startUrl)
  const reader = useArticles((s) => s.reader)
  const [readerLoading, setReaderLoading] = useState(false)

  useArticleSelectionScope()

  // Reader view asks the open page for its article text.
  useEffect(() => {
    const onExtracted = (e: Event): void => {
      const a = (e as CustomEvent<ArticleInput | null>).detail
      setReaderLoading(false)
      const st = useArticles.getState()
      if (st.view !== 'reader' || (st.reader && !st.reader.saved && st.reader.url === a?.url)) return
      st.setReader(a?.blocks?.length ? { url: a.url, title: a.title, domain: domainOf(a.url), siteName: a.siteName, byline: a.byline, blocks: a.blocks } : null)
    }
    window.addEventListener('elc:article-extracted', onExtracted)
    return () => window.removeEventListener('elc:article-extracted', onExtracted)
  }, [])

  const openReader = (): void => {
    const st = useArticles.getState()
    st.setView('reader')
    const url = st.page?.url
    if (!url || !browser.current) return
    const known = st.extracted[url]
    if (known?.blocks?.length) {
      st.setReader({ url, title: known.title, domain: domainOf(url), siteName: known.siteName, byline: known.byline, blocks: known.blocks })
      return
    }
    st.setReader(null)
    setReaderLoading(true)
    browser.current.send('elc:extract', true)
    setTimeout(() => setReaderLoading(false), 6000)
  }

  return (
    <Group orientation="horizontal" className="h-full">
      <Panel id="article" defaultSize="58" minSize={360}>
        <div className="glass-panel flex h-full min-w-0 flex-col overflow-hidden">
          <Toolbar view={view} onReader={openReader} />
          <div className="relative min-h-0 flex-1">
            <ArticleBrowser visible={active && view === 'browse'} />
            {view === 'browse' && !startUrl && <StartPage />}
            {view === 'reader' && (
              <div className="absolute inset-0">
                <ReaderView doc={reader} loading={readerLoading} />
              </div>
            )}
            {view === 'history' && (
              <div className="absolute inset-0">
                <ArticleHistory />
              </div>
            )}
          </div>
        </div>
      </Panel>
      <Separator className="resize-handle" />
      <Panel id="study" defaultSize="42" minSize={340}>
        <ArticleStudyPanel />
      </Panel>
    </Group>
  )
}

function Toolbar({ view, onReader }: { view: ArticleView; onReader: () => void }): ReactNode {
  const page = useArticles((s) => s.page)
  const { setView, openUrl, openHistory } = useArticles.getState()
  const [address, setAddress] = useState('')
  useEffect(() => setAddress(page?.url ?? ''), [page?.url])

  const tab = (v: ArticleView, label: string, icon: ReactNode, onClick: () => void): ReactNode => (
    <button
      onClick={onClick}
      aria-pressed={view === v}
      className={cn(
        'motion-press flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium',
        view === v ? 'surface-selected border text-accent' : 'text-muted hover:bg-white/55 hover:text-fg'
      )}
    >
      {icon}
      <span className="hidden @lg:inline">{label}</span>
    </button>
  )

  return (
    <div className="glass-header @container relative z-20 flex shrink-0 flex-col gap-2 rounded-t-[17px] px-3 py-2">
      <div className="flex items-center gap-1.5">
        {tab('browse', 'Browse', <Globe className="size-4" />, () => setView('browse'))}
        {tab('reader', 'Reader', <BookOpenText className="size-4" />, onReader)}
        {tab('history', 'History', <History className="size-4" />, () => openHistory(null))}
        <span className="flex-1" />
        <PasteButton />
      </div>
      <form
        className="flex items-center gap-1"
        onSubmit={(e) => {
          e.preventDefault()
          if (address.trim()) openUrl(toAddress(address))
        }}
      >
        <Button type="button" variant="ghost" size="sm" icon={<ArrowLeft className="size-4" />} aria-label="Back" title="Back" disabled={!page} onClick={() => browser.current?.canGoBack() && browser.current.goBack()} />
        <Button type="button" variant="ghost" size="sm" icon={<ArrowRight className="size-4" />} aria-label="Forward" title="Forward" disabled={!page} onClick={() => browser.current?.canGoForward() && browser.current.goForward()} />
        <Button type="button" variant="ghost" size="sm" icon={<RotateCw className="size-4" />} aria-label="Reload page" title="Reload page" disabled={!page} onClick={() => browser.current?.reload()} />
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-muted" />
          <Input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Type a web address or search…" className="h-9 pl-8 text-sm" aria-label="Web address" />
        </div>
      </form>
    </div>
  )
}

/** For pages the in-app browser can't open (sign-in walls, blocked sites): paste the text instead. */
function PasteButton(): ReactNode {
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [url, setUrl] = useState('')
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const toastError = useApp((s) => s.toastError)

  const submit = async (): Promise<void> => {
    if (!text.trim()) return
    setBusy(true)
    try {
      const blocks: ArticleBlock[] = text
        .split(/\n\s*\n|\r?\n/)
        .map((p) => p.replace(/\s+/g, ' ').trim())
        .filter(Boolean)
        .map((p) => ({ type: 'p', text: p }))
      const address = /^https?:\/\//i.test(url.trim()) ? url.trim() : `${PASTED_PREFIX}${Date.now()}`
      const input: ArticleInput = { url: address, title: title.trim() || blocks[0].text.slice(0, 80), blocks }
      const st = useArticles.getState()
      await st.recordExtracted(input)
      st.setReader({ url: address, title: input.title, domain: domainOf(address), blocks })
      st.setView('reader')
      setOpen(false)
      setTitle('')
      setUrl('')
      setText('')
    } catch (err) {
      toastError(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Button size="sm" variant="ghost" icon={<ClipboardPaste className="size-4" />} onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="hidden @lg:inline">Paste text</span>
      </Button>
      {open && (
        <div className="glass-elevated anim-pop-in absolute top-12 right-3 z-40 w-[min(460px,calc(100%-24px))] space-y-2 rounded-2xl p-3">
          <p className="text-sm font-semibold">Paste an article</p>
          <p className="text-xs text-muted">For pages that can't be opened here. The text is kept in your history as the original article text.</p>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title (optional)" />
          <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Original web address (optional)" />
          <Textarea rows={8} value={text} onChange={(e) => setText(e.target.value)} placeholder="Paste the article text here…" />
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button size="sm" variant="primary" loading={busy} disabled={!text.trim()} onClick={() => void submit()}>
              Open in Reader
            </Button>
          </div>
        </div>
      )}
    </>
  )
}

function StartPage(): ReactNode {
  const [recent, setRecent] = useState<Article[]>([])
  const version = useArticles((s) => s.historyVersion)
  const { openUrl, openHistory } = useArticles.getState()
  useEffect(() => {
    invoke('articles:list')
      .then((list) => setRecent([...list].sort((a, b) => b.lastOpenedAt.localeCompare(a.lastOpenedAt)).slice(0, 6)))
      .catch(() => undefined)
  }, [version])

  return (
    <div className="absolute inset-0 overflow-y-auto px-6 py-8">
      <div className="mx-auto max-w-xl">
        <h2 className="text-xl font-semibold">Read English articles</h2>
        <p className="mt-1 text-sm text-muted">Type a web address or search above. Select any word or sentence on the page to explain it, ask the chat, or save it.</p>
        <div className="mt-4 flex flex-wrap gap-2">
          {['https://www.bbc.com/news', 'https://www.theguardian.com/international', 'https://simple.wikipedia.org', 'https://www.voanews.com'].map((u) => (
            <Button key={u} size="sm" variant="secondary" icon={<Globe className="size-3.5" />} onClick={() => openUrl(u)}>
              {domainOf(u)}
            </Button>
          ))}
        </div>

        {recent.length > 0 && (
          <section className="mt-7">
            <h3 className="mb-2 text-sm font-semibold">Recently read</h3>
            <div className="space-y-1">
              {recent.map((a) => (
                <button key={a.id} onClick={() => openHistory(a.id)} className="motion-hover block w-full rounded-xl px-3 py-2 text-left hover:bg-white/55">
                  <p className="truncate text-sm font-medium">{a.title}</p>
                  <p className="text-[11px] text-muted">{a.domain}</p>
                </button>
              ))}
            </div>
          </section>
        )}

        <section className="glass-inset mt-7 space-y-2 rounded-xl px-4 py-3 text-xs leading-relaxed text-muted">
          <p className="flex items-center gap-1.5 text-sm font-semibold text-fg">
            <Info className="size-4 text-info" /> Good to know
          </p>
          <p>
            Pages open in a built-in <b>Chromium</b> browser (the same engine as Chrome). Your Chrome sign-ins and extensions are not here; sign in to a site here once
            if needed.
          </p>
          <p>
            Some sites block other browsers (for example Google sign-in), show paywalls or ask for a captcha. The app does not get around these. For such pages, use{' '}
            <b>Paste text</b>, or read in Chrome and send text with the extension.
          </p>
          <p className="flex items-start gap-1.5">
            <Puzzle className="mt-0.5 size-3.5 shrink-0" />
            <span>
              <b>Reading in Chrome?</b> Install the free <b>English Companion</b> extension (folder <code>chrome-extension</code> in the app folder): select text in
              Chrome and press <b>Explain</b> — it appears here, like subtitles from VLC.
            </span>
          </p>
        </section>
      </div>
    </div>
  )
}

/**
 * Explain / Ask / Save for selections in the browser, Reader view and the explanation, using the
 * Phase 1 selection menu and chat focus, with the article as context.
 */
function useArticleSelectionScope(): void {
  useEffect(
    () =>
      registerSelectionScope('article', {
        explain: (s) => {
          const st = useArticles.getState()
          if (st.selection?.text !== s.text) {
            const cur = st.selection
            st.select({
              text: s.text,
              sentence: s.fromAi ? null : s.sentence,
              paragraph: s.context,
              url: cur?.url ?? st.page?.url ?? null,
              title: cur?.title ?? st.page?.title ?? null,
              domain: cur?.domain ?? (st.page ? domainOf(st.page.url) : null),
              source: s.fromAi ? 'ai' : (cur?.source ?? 'reader')
            })
          }
          void useArticles.getState().explain()
        },
        ask: (s) => {
          const st = useArticles.getState()
          const cur = st.selection
          if (s.fromAi) {
            useChat.getState().setFocus({ text: s.text, sentence: cur?.sentence ?? null, excerpt: s.context, source: 'explanation', articleTitle: cur?.title, articleDomain: cur?.domain })
          } else if (cur?.text !== s.text) {
            st.select({ text: s.text, sentence: s.sentence, paragraph: s.context, url: cur?.url ?? null, title: cur?.title ?? null, domain: cur?.domain ?? null, source: cur?.source ?? 'reader' })
          } else st.select(cur)
          useLayout.getState().setChatOpen(true)
        },
        noteFields: async (s) => {
          const st = useArticles.getState()
          const cur = st.selection
          const url = cur?.url ?? st.page?.url ?? null
          const articleId = url ? await st.ensureArticle(url, cur?.title ?? st.page?.title ?? url).catch(() => null) : null
          const done = cur ? st.explanations[cur.key] : undefined
          return s.fromAi
            ? // Text from the AI explanation: the article's original sentence stays the context.
              { articleId, mediaTitle: cur?.title ?? null, contextSentence: cur?.sentence ?? null, explanationMd: s.context }
            : { articleId, mediaTitle: cur?.title ?? null, contextSentence: s.sentence ?? s.context, explanationMd: done?.status === 'done' && cur?.text === s.text ? done.text : null }
        },
        suggestKind: (s) => suggestedArticleKind(s.text)
      }),
    []
  )
}
