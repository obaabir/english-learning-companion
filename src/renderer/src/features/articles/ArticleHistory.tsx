import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ArrowLeft, BookOpenText, CalendarDays, ExternalLink, FileText, Globe, History, NotebookPen } from 'lucide-react'
import { groupByDay, isFromArticle, isPasted, SENTENCE_KINDS, VOCAB_KINDS, type Article, type ArticleDetail } from '@shared/articles'
import { NOTE_KINDS, type Note } from '@shared/types'
import { invoke } from '@renderer/lib/api'
import { useApp } from '@renderer/stores/app'
import { Badge, Button, EmptyState, Textarea } from '@renderer/components/ui'
import { Markdown } from '@renderer/components/Markdown'
import { cn } from '@renderer/lib/cn'
import { useArticles } from './articleStore'

const fmtDate = (d: string): string => new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
const fmtTime = (iso: string): string => new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

/** Reading history, oldest first as Day 1, Day 2, …; click an article to review what you saved from it. */
export function ArticleHistory(): ReactNode {
  const version = useArticles((s) => s.historyVersion)
  const detailId = useArticles((s) => s.historyDetailId)
  const openHistory = useArticles((s) => s.openHistory)
  const [articles, setArticles] = useState<Article[] | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const toastError = useApp((s) => s.toastError)

  useEffect(() => {
    invoke('articles:list').then(setArticles).catch(toastError)
  }, [version, toastError])

  // Newest day is at the bottom: start there.
  useEffect(() => {
    const el = listRef.current
    if (el && articles && !detailId) el.scrollTop = el.scrollHeight
  }, [articles, detailId])

  if (detailId) return <ArticleDetailView id={detailId} onBack={() => openHistory(null)} />
  if (!articles) return null
  if (!articles.length) {
    return (
      <EmptyState icon={<History className="size-10" />} title="No articles yet">
        Articles you open (in the in-app browser, from Chrome, or pasted) appear here by day, with the words and sentences you save from them.
      </EmptyState>
    )
  }
  return (
    <div ref={listRef} className="h-full overflow-y-auto px-4 py-4">
      {groupByDay(articles).map((g) => (
        <section key={g.date} className="mb-5">
          <h3 className="sticky top-0 z-10 mb-2 flex items-center gap-2 bg-transparent py-1 text-sm font-semibold backdrop-blur-sm">
            <CalendarDays className="size-4 text-rose" /> Day {g.day}
            <span className="text-xs font-normal text-muted">{fmtDate(g.date)}</span>
          </h3>
          <div className="space-y-1.5">
            {g.items.map((a) => (
              <button
                key={a.id}
                onClick={() => openHistory(a.id)}
                className="motion-hover block w-full rounded-xl border border-transparent px-3 py-2.5 text-left hover:border-white/80 hover:bg-white/55"
              >
                <p className="line-clamp-2 text-sm font-medium">{a.title}</p>
                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted">
                  <span className="inline-flex items-center gap-1">
                    <Globe className="size-3" /> {a.domain}
                  </span>
                  <span>· opened {fmtTime(a.firstOpenedAt)}</span>
                  {a.vocabCount > 0 && <Badge tone="accent">{a.vocabCount} words & idioms</Badge>}
                  {a.sentenceCount > 0 && <Badge tone="info">{a.sentenceCount} sentences & grammar</Badge>}
                  {a.personalNote && <NotebookPen className="size-3 text-rose" aria-label="Has your note" />}
                </div>
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}

function ArticleDetailView({ id, onBack }: { id: number; onBack: () => void }): ReactNode {
  const [article, setArticle] = useState<ArticleDetail | null>(null)
  const [notes, setNotes] = useState<Note[]>([])
  const [note, setNote] = useState('')
  const toastError = useApp((s) => s.toastError)
  const version = useArticles((s) => s.historyVersion)
  const { openUrl, setReader, setView } = useArticles.getState()
  const saveTimer = useRef<number | undefined>(undefined)

  useEffect(() => {
    Promise.all([invoke('articles:get', id), invoke('notes:list', { articleId: id })])
      .then(([a, n]) => {
        setArticle(a)
        setNote((cur) => (cur ? cur : (a?.personalNote ?? '')))
        setNotes(n)
      })
      .catch(toastError)
  }, [id, version, toastError])

  const saveNote = (text: string): void => {
    window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => void invoke('articles:setNote', { id, note: text }).catch(toastError), 500)
  }

  if (!article) return null
  const vocab = notes.filter((n) => VOCAB_KINDS.includes(n.kind))
  const sentences = notes.filter((n) => SENTENCE_KINDS.includes(n.kind))
  const other = notes.filter((n) => !VOCAB_KINDS.includes(n.kind) && !SENTENCE_KINDS.includes(n.kind))

  const readSaved = (): void => {
    setReader({ url: article.url, title: article.title, domain: article.domain, siteName: article.siteName, byline: article.byline, blocks: article.blocks, saved: true })
    setView('reader')
  }

  return (
    <div className="h-full overflow-y-auto px-5 py-4">
      <button onClick={onBack} className="mb-3 inline-flex items-center gap-1.5 text-xs text-muted hover:text-fg">
        <ArrowLeft className="size-3.5" /> All articles
      </button>
      <h2 className="text-xl leading-snug font-semibold">{article.title}</h2>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
        <span className="inline-flex items-center gap-1">
          <Globe className="size-3.5" /> {article.siteName || article.domain}
        </span>
        {article.byline && <span>{article.byline}</span>}
        <span>First opened {fmtTime(article.firstOpenedAt)}</span>
        {article.lastOpenedAt !== article.firstOpenedAt && <span>· last {fmtTime(article.lastOpenedAt)}</span>}
      </div>
      {!isPasted(article.url) && (
        <p className="mt-1.5 truncate text-xs">
          <span className="text-muted">Original URL: </span>
          <a href={article.url} target="_blank" rel="noreferrer" className="text-info hover:underline" title="Open in your default browser (Chrome)">
            {article.url}
          </a>
        </p>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        {article.hasSnapshot && (
          <Button size="sm" variant="primary" icon={<BookOpenText className="size-3.5" />} onClick={readSaved} title="The original text saved when you read it — works even if the page changes or disappears">
            Read saved copy
          </Button>
        )}
        {!isPasted(article.url) && (
          <Button size="sm" variant="secondary" icon={<ExternalLink className="size-3.5" />} onClick={() => openUrl(article.url)}>
            Open original page
          </Button>
        )}
      </div>

      <section className="mt-5">
        <h3 className="mb-1.5 flex items-center gap-1.5 text-sm font-semibold">
          <NotebookPen className="size-4 text-rose" /> My notes on this article
        </h3>
        <Textarea
          rows={3}
          value={note}
          placeholder="Your own notes (kept even if the article goes offline)…"
          onChange={(e) => {
            setNote(e.target.value)
            saveNote(e.target.value)
          }}
        />
      </section>

      <p className="mt-5 text-[11px] text-muted">
        <Badge tone="info">From the article</Badge> original article text · <Badge tone="warn">AI-generated</Badge> explanations and examples written by AI
      </p>
      <ItemGroup title="Vocabulary and idioms" notes={vocab} article={article} />
      <ItemGroup title="Sentences and grammar structures" notes={sentences} article={article} />
      {other.length > 0 && <ItemGroup title="Other notes" notes={other} article={article} />}
      {notes.length === 0 && <p className="mt-3 text-sm text-muted">Nothing saved from this article yet. Select a word or sentence and press Save to Notes.</p>}
    </div>
  )
}

function ItemGroup({ title, notes, article }: { title: string; notes: Note[]; article: ArticleDetail }): ReactNode {
  if (!notes.length) return null
  return (
    <section className="mt-4">
      <h3 className="mb-2 text-sm font-semibold">
        {title} <span className="font-normal text-muted">({notes.length})</span>
      </h3>
      <div className="space-y-2">
        {notes.map((n) => (
          <SavedItem key={n.id} note={n} article={article} />
        ))}
      </div>
    </section>
  )
}

function SavedItem({ note, article }: { note: Note; article: ArticleDetail }): ReactNode {
  const fromArticle = isFromArticle(note.text, article, note.contextSentence)
  const [open, setOpen] = useState(false)
  return (
    <div className="glass-inset rounded-xl px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <p className="min-w-0 flex-1 text-sm font-medium">{note.text}</p>
        <Badge>{NOTE_KINDS.find((k) => k.value === note.kind)?.label ?? note.kind}</Badge>
        <Badge tone={fromArticle ? 'info' : 'warn'}>{fromArticle ? 'From the article' : 'AI-generated'}</Badge>
        {note.gdocSyncedAt && <FileText className="size-3.5 text-accent" aria-label="In Google Docs" />}
      </div>
      {note.data?.meaning_bn && <p className="mt-1 text-sm text-muted">{note.data.meaning_bn}</p>}
      {note.contextSentence && note.contextSentence !== note.text && (
        <p className="mt-1.5 text-xs text-muted">
          <span className="font-medium">Original sentence (from the article):</span> <span className="italic">“{note.contextSentence}”</span>
        </p>
      )}
      {note.explanationMd && (
        <div className="mt-1.5">
          <button onClick={() => setOpen(!open)} className={cn('text-xs text-info hover:underline')}>
            {open ? 'Hide' : 'Show'} AI explanation
          </button>
          {open && (
            <div className="mt-2 border-l-2 border-warn/40 pl-3">
              <Badge tone="warn">AI-generated</Badge>
              <Markdown text={note.explanationMd} />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
