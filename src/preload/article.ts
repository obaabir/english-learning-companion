/// <reference lib="dom" />
/**
 * Runs inside web pages opened in the Articles in-app browser (sandboxed, isolated from the page's
 * own scripts). It exposes nothing to the page. It only tells the app:
 *  - which text you selected (with its sentence and paragraph), and
 *  - the page's readable article text (via Mozilla Readability) for Reader view and history.
 */
import { ipcRenderer } from 'electron'
import { Readability, isProbablyReaderable } from '@mozilla/readability'
import { sentenceAround, type ArticleBlock, type ArticleInput } from '@shared/articles'

const BLOCK = 'p, li, h1, h2, h3, h4, h5, h6, blockquote, pre, td, dd, dt, figcaption, article, section, div'
const clean = (s: string): string => s.replace(/\s+/g, ' ').trim()

let shown = ''
function hide(): void {
  if (!shown) return
  shown = ''
  ipcRenderer.sendToHost('elc:selection', null)
}

function reportSelection(): void {
  const sel = window.getSelection()
  const text = sel ? clean(sel.toString()) : ''
  if (!sel || sel.isCollapsed || sel.rangeCount === 0 || text.length > 600 || !/[A-Za-z]/.test(text)) return hide()
  const range = sel.getRangeAt(0)
  const node = range.startContainer
  const el = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement
  if (el?.closest('input, textarea, [contenteditable="true"]')) return hide()
  const block = el?.closest(BLOCK) ?? el
  const blockText = clean(block?.textContent ?? '').slice(0, 4000)
  const r = range.getBoundingClientRect()
  const key = `${text}|${Math.round(r.top)}|${Math.round(r.left)}`
  if (key === shown) return
  shown = key
  ipcRenderer.sendToHost('elc:selection', {
    text,
    sentence: sentenceAround(blockText, text),
    paragraph: blockText.slice(0, 1200),
    rect: { left: r.left, top: r.top, bottom: r.bottom, width: r.width },
    url: location.href,
    title: document.title
  })
}

document.addEventListener('mouseup', () => setTimeout(reportSelection, 0), true)
document.addEventListener(
  'keyup',
  (e) => {
    if (e.shiftKey || e.key.startsWith('Arrow') || e.key === 'a') setTimeout(reportSelection, 0)
  },
  true
)
document.addEventListener('mousedown', hide, true)
// The menu is placed next to the selection; hide it when the page scrolls under it.
window.addEventListener('scroll', () => shown && ipcRenderer.sendToHost('elc:scroll'), { capture: true, passive: true })

/** The article's original text as plain blocks (no HTML is passed to the app). */
function toBlocks(root: Element): ArticleBlock[] {
  const out: ArticleBlock[] = []
  const push = (type: ArticleBlock['type'], text: string, level?: number): void => {
    const t = type === 'pre' ? text.replace(/\s+$/g, '') : clean(text)
    if (t && t.length > 1) out.push(level ? { type, text: t, level } : { type, text: t })
  }
  const visit = (el: Element): void => {
    for (const child of Array.from(el.children)) {
      const tag = child.tagName.toLowerCase()
      if (/^h[1-6]$/.test(tag)) push('h', child.textContent ?? '', Number(tag[1]))
      else if (tag === 'p') push('p', child.textContent ?? '')
      else if (tag === 'pre') push('pre', child.textContent ?? '')
      else if (tag === 'li') {
        const nested = child.querySelector('ul, ol')
        if (nested) {
          const own = Array.from(child.childNodes)
            .filter((n) => !(n instanceof Element && /^(ul|ol)$/i.test(n.tagName)))
            .map((n) => n.textContent ?? '')
            .join(' ')
          push('li', own)
          visit(child)
        } else push('li', child.textContent ?? '')
      } else if (tag === 'blockquote') {
        if (child.querySelector('p, li')) visit(child)
        else push('quote', child.textContent ?? '')
      } else if (!/^(script|style|noscript|svg|button|form|nav|aside|figure|img|picture|video|iframe)$/.test(tag)) {
        if (child.children.length) visit(child)
        else push('p', child.textContent ?? '')
      }
    }
  }
  visit(root)
  if (!out.length) {
    for (const para of (root.textContent ?? '').split(/\n\s*\n/)) push('p', para)
  }
  return out
}

function extract(force: boolean): void {
  try {
    if (!/^https?:/.test(location.protocol)) return
    if (!force && !isProbablyReaderable(document)) return
    const clone = document.cloneNode(true) as Document
    const parsed = new Readability<Element>(clone, { serializer: (el) => el as Element }).parse()
    const blocks = parsed?.content ? toBlocks(parsed.content) : []
    const text = blocks.reduce((n, b) => n + b.text.length, 0)
    if (!parsed || text < (force ? 1 : 400)) {
      if (force) ipcRenderer.sendToHost('elc:article', null)
      return
    }
    const article: ArticleInput = {
      url: location.href,
      title: clean(parsed.title || document.title || location.hostname),
      siteName: parsed.siteName ? clean(parsed.siteName) : null,
      byline: parsed.byline ? clean(parsed.byline) : null,
      excerpt: parsed.excerpt ? clean(parsed.excerpt).slice(0, 400) : null,
      blocks
    }
    ipcRenderer.sendToHost('elc:article', article)
  } catch (err) {
    console.warn('Reader view failed:', err)
    if (force) ipcRenderer.sendToHost('elc:article', null)
  }
}

// After the page loads, offer the article text (for history) if the page looks like an article.
window.addEventListener('load', () => setTimeout(() => extract(false), 900))
// The app asks for it when you open Reader view (or after in-page navigation).
ipcRenderer.on('elc:extract', (_e, force: boolean) => extract(force !== false))
