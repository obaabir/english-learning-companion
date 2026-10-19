import { type ReactNode } from 'react'
import { BookOpenText, ExternalLink, Globe, Loader2 } from 'lucide-react'
import { isPasted, sentenceAround, type ArticleBlock } from '@shared/articles'
import { useArticles, type ReaderDoc } from './articleStore'

/**
 * Clean reading view of the ORIGINAL article text (nothing here is AI-generated), on a light reading
 * surface (white page, dark text) that fills the whole reading area; the text column itself stays a
 * comfortable width. Selecting a word or sentence puts it in the study panel and shows the
 * Explain / Ask / Save menu.
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
      <div className="reader-surface h-full overflow-y-auto">
        <div className="reader-column flex min-h-full flex-col items-center justify-center text-center">
          {loading ? <Loader2 className="size-9 animate-spin text-[#c51d4a]" /> : <BookOpenText className="size-10 text-[#c51d4a]" />}
          <p className="mt-3 text-lg font-semibold">{loading ? 'Reading the article…' : 'No readable article on this page'}</p>
          <p className="reader-meta mt-1 max-w-md text-[15px] leading-relaxed">
            {loading
              ? 'Getting the article text from the page.'
              : 'Reader view shows the main text of an article. This page has none that could be read (it may be a home page, a video, or need a sign-in). Use the web view, or Paste text.'}
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="reader-surface h-full overflow-y-auto">
      <article data-selection-scope="article" onMouseUp={onMouseUp} className="reader-column">
        <header>
          <div className="reader-meta flex flex-wrap items-center gap-2 text-[13px] leading-normal">
            <span className="reader-chip">Original article text</span>
            {doc.saved && <span className="reader-chip">Saved copy</span>}
            <span className="inline-flex items-center gap-1">
              <Globe className="size-3.5" /> {doc.siteName || doc.domain}
            </span>
            {doc.byline && <span>· {doc.byline}</span>}
          </div>
          <h1 data-block>{doc.title}</h1>
          {!isPasted(doc.url) && (
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] leading-normal">
              <button onClick={() => openUrl(doc.url)} className="reader-link max-w-full truncate" title="Open the original page in the in-app browser">
                {doc.url}
              </button>
              <a href={doc.url} target="_blank" rel="noreferrer" className="reader-link inline-flex shrink-0 items-center gap-1" title="Open in your default browser (Chrome)">
                <ExternalLink className="size-3.5" /> Open in browser
              </a>
            </div>
          )}
        </header>
        {renderBlocks(doc.blocks)}
      </article>
    </div>
  )
}

/** Article blocks as real HTML: headings by level, paragraphs, quotations, code, and bullet lists. */
function renderBlocks(blocks: ArticleBlock[]): ReactNode[] {
  const out: ReactNode[] = []
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i]
    if (b.type === 'li') {
      // Consecutive list items form one list.
      const items: ArticleBlock[] = []
      while (i < blocks.length && blocks[i].type === 'li') items.push(blocks[i++])
      i--
      out.push(
        <ul key={`ul-${i}`}>
          {items.map((li, k) => (
            <li key={k} data-block>
              {li.text}
            </li>
          ))}
        </ul>
      )
    } else if (b.type === 'h') {
      const level = b.level ?? 2
      out.push(
        level <= 2 ? (
          <h2 key={i} data-block>
            {b.text}
          </h2>
        ) : level === 3 ? (
          <h3 key={i} data-block>
            {b.text}
          </h3>
        ) : (
          <h4 key={i} data-block>
            {b.text}
          </h4>
        )
      )
    } else if (b.type === 'quote') {
      out.push(
        <blockquote key={i} data-block>
          {b.text}
        </blockquote>
      )
    } else if (b.type === 'pre') {
      out.push(
        <pre key={i} data-block>
          {b.text}
        </pre>
      )
    } else {
      out.push(
        <p key={i} data-block>
          {b.text}
        </p>
      )
    }
  }
  return out
}
