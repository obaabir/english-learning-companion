import { type ReactNode } from 'react'
import { BookOpenText, ExternalLink, Globe } from 'lucide-react'
import { isPasted, sentenceAround } from '@shared/articles'
import { Badge, EmptyState } from '@renderer/components/ui'
import { useArticles, type ReaderDoc } from './articleStore'

/**
 * Clean reading view of the ORIGINAL article text (nothing here is AI-generated). Selecting a word
 * or sentence puts it in the study panel and shows the Explain / Ask / Save menu.
 */
export function ReaderView({ doc, loading }: { doc: ReaderDoc | null; loading: boolean }): ReactNode {
  const openUrl = useArticles((s) => s.openUrl)

  const onMouseUp = (e: React.MouseEvent<HTMLElement>): void => {
    const sel = window.getSelection()
    const text = sel?.toString().replace(/\s+/g, ' ').trim() ?? ''
    if (!doc || !sel || sel.isCollapsed || !text || text.length > 600 || !/[A-Za-z]/.test(text)) return
    const node = sel.anchorNode
    const el = node instanceof Element ? node : node?.parentElement
    if (!el || !e.currentTarget.contains(el)) return
    const block = el.closest('[data-block]')
    const blockText = block?.textContent?.replace(/\s+/g, ' ').trim() ?? text
    useArticles.getState().select({
      text,
      sentence: sentenceAround(blockText, text),
      paragraph: blockText.slice(0, 1200),
      url: doc.url,
      title: doc.title,
      domain: doc.domain,
      source: 'reader'
    })
  }

  if (!doc) {
    return (
      <EmptyState icon={<BookOpenText className="size-10" />} title={loading ? 'Reading the article…' : 'No readable article on this page'}>
        {loading
          ? 'Getting the article text from the page.'
          : 'Reader view shows the main text of an article. This page has none that could be read (it may be a home page, a video, or need a sign-in). Use the web view, or Paste text.'}
      </EmptyState>
    )
  }

  return (
    <div className="h-full overflow-y-auto">
      <article data-selection-scope="article" onMouseUp={onMouseUp} className="mx-auto max-w-[70ch] px-6 py-8 text-[17px] leading-[1.75]">
        <header className="mb-6 border-b border-line/70 pb-4">
          <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-muted">
            <Badge tone="info">Original article text</Badge>
            {doc.saved && <Badge>Saved copy</Badge>}
            <span className="inline-flex items-center gap-1">
              <Globe className="size-3.5" /> {doc.siteName || doc.domain}
            </span>
            {doc.byline && <span>· {doc.byline}</span>}
          </div>
          <h1 className="text-2xl leading-snug font-semibold" data-block>
            {doc.title}
          </h1>
          {!isPasted(doc.url) && (
            <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
              <button onClick={() => openUrl(doc.url)} className="max-w-full truncate text-info hover:underline" title="Open the original page in the in-app browser">
                {doc.url}
              </button>
              <a href={doc.url} target="_blank" rel="noreferrer" className="inline-flex shrink-0 items-center gap-1 text-muted hover:text-fg" title="Open in your default browser (Chrome)">
                <ExternalLink className="size-3.5" /> Open in browser
              </a>
            </div>
          )}
        </header>
        {doc.blocks.map((b, i) => {
          if (b.type === 'h') {
            const size = (b.level ?? 2) <= 2 ? 'text-xl' : 'text-lg'
            return (
              <h2 key={i} data-block className={`mt-7 mb-3 leading-snug font-semibold ${size}`}>
                {b.text}
              </h2>
            )
          }
          if (b.type === 'li')
            return (
              <p key={i} data-block className="relative mb-2 pl-5 before:absolute before:left-1 before:text-rose before:content-['•']">
                {b.text}
              </p>
            )
          if (b.type === 'quote')
            return (
              <blockquote key={i} data-block className="my-4 border-l-2 border-rose/50 pl-4 text-muted italic">
                {b.text}
              </blockquote>
            )
          if (b.type === 'pre')
            return (
              <pre key={i} data-block className="glass-inset my-4 overflow-x-auto rounded-lg p-3 font-mono text-sm whitespace-pre-wrap">
                {b.text}
              </pre>
            )
          return (
            <p key={i} data-block className="mb-4">
              {b.text}
            </p>
          )
        })}
      </article>
    </div>
  )
}
