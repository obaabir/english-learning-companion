import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { WebviewTag } from 'electron'
import { AlertTriangle } from 'lucide-react'
import { domainOf, type ArticleInput } from '@shared/articles'
import { showSelectionMenu } from '@renderer/components/SelectionSaveMenu'
import { browser, useArticles } from './articleStore'

interface PageSelection {
  text: string
  sentence: string | null
  paragraph: string | null
  rect: { left: number; top: number; bottom: number; width: number }
  url: string
  title: string
}

/**
 * The in-app browser: a Chromium <webview> (the same engine as Chrome) with its own sign-ins.
 * Selecting text in a page shows the Explain / Ask / Save menu and puts it in the study panel.
 */
export function ArticleBrowser({ visible }: { visible: boolean }): ReactNode {
  const startUrl = useArticles((s) => s.startUrl)
  const ref = useRef<WebviewTag | null>(null)
  const [failed, setFailed] = useState<string | null>(null)

  useEffect(() => {
    const wv = ref.current
    if (!wv) return
    browser.current = wv
    const st = useArticles.getState
    const onNav = (e: Event & { url: string; isMainFrame?: boolean }): void => {
      if (e.isMainFrame === false) return
      setFailed(null)
      showSelectionMenu(null)
      st().setPage({ url: e.url, title: wv.getTitle() || domainOf(e.url) })
    }
    const onInPage = (e: Event & { url: string; isMainFrame: boolean }): void => {
      onNav(e)
      // Single-page sites change articles without a reload: ask for the new article text.
      if (e.isMainFrame) setTimeout(() => wv.send('elc:extract', false), 1200)
    }
    const onTitle = (e: Event & { title: string }): void => {
      const p = st().page
      if (p) st().setPage({ ...p, title: e.title })
    }
    const onFail = (e: Event & { errorCode: number; errorDescription: string; validatedURL: string; isMainFrame: boolean }): void => {
      if (!e.isMainFrame || e.errorCode === -3) return // -3: navigation replaced by another
      setFailed(`${domainOf(e.validatedURL)} could not be opened (${e.errorDescription || e.errorCode}).`)
    }
    const onMessage = (e: Event & { channel: string; args: unknown[] }): void => {
      if (e.channel === 'elc:selection') {
        const sel = e.args[0] as PageSelection | null
        if (!sel) {
          showSelectionMenu(null)
          return
        }
        const box = wv.getBoundingClientRect()
        st().select({ text: sel.text, sentence: sel.sentence, paragraph: sel.paragraph, url: sel.url, title: st().extracted[sel.url]?.title ?? sel.title, domain: domainOf(sel.url), source: 'browser' })
        showSelectionMenu({
          text: sel.text,
          context: sel.paragraph,
          sentence: sel.sentence,
          fromAi: false,
          scope: 'article',
          rect: { left: box.left + sel.rect.left, top: box.top + sel.rect.top, bottom: box.top + sel.rect.bottom, width: sel.rect.width }
        })
      } else if (e.channel === 'elc:scroll') {
        showSelectionMenu(null)
      } else if (e.channel === 'elc:article') {
        const article = e.args[0] as ArticleInput | null
        window.dispatchEvent(new CustomEvent('elc:article-extracted', { detail: article }))
        if (article?.url && article.blocks?.length) void st().recordExtracted(article).catch(() => undefined)
      }
    }
    wv.addEventListener('did-navigate', onNav as EventListener)
    wv.addEventListener('did-navigate-in-page', onInPage as EventListener)
    wv.addEventListener('page-title-updated', onTitle as EventListener)
    wv.addEventListener('did-fail-load', onFail as EventListener)
    wv.addEventListener('ipc-message', onMessage as EventListener)
    return () => {
      wv.removeEventListener('did-navigate', onNav as EventListener)
      wv.removeEventListener('did-navigate-in-page', onInPage as EventListener)
      wv.removeEventListener('page-title-updated', onTitle as EventListener)
      wv.removeEventListener('did-fail-load', onFail as EventListener)
      wv.removeEventListener('ipc-message', onMessage as EventListener)
      if (browser.current === wv) browser.current = null
    }
    // The element is created once with the first address; later pages load inside it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startUrl !== null])

  // Leaving the browser (Reader / History / another section) hides its floating menu.
  useEffect(() => {
    if (!visible) showSelectionMenu(null)
  }, [visible])

  if (!startUrl) return null
  return (
    <div className={visible ? 'absolute inset-0 flex flex-col' : 'pointer-events-none invisible absolute inset-0 flex flex-col'} aria-hidden={!visible}>
      {failed && (
        <div className="anim-fade-in flex shrink-0 items-start gap-2 border-b border-line/70 bg-danger-soft px-4 py-2.5 text-sm text-danger">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <p>
            {failed} If this site blocks other browsers or needs a sign-in, open it in Chrome and send text with the English Companion extension, or use
            <b> Paste text</b>.
          </p>
        </div>
      )}
      <webview ref={ref as never} src={startUrl} partition="persist:articles" className="min-h-0 w-full flex-1 bg-white" />
    </div>
  )
}
