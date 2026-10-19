import type { ChatFocus } from '@shared/types'

/**
 * The text currently highlighted inside `root`, as a chat focus: the exact selection, the
 * original sentence and the paragraph/list item around it. Null when nothing usable is selected.
 */
export function focusFromSelection(root: HTMLElement | null, source: ChatFocus['source'], sentence: string | null): ChatFocus | null {
  const sel = window.getSelection()
  if (!root || !sel || sel.isCollapsed || sel.rangeCount === 0) return null
  const text = sel.toString().replace(/\s+/g, ' ').trim()
  if (text.length < 1 || text.length > 400 || !/[A-Za-z]/.test(text)) return null
  const node = sel.anchorNode
  const el = node instanceof Element ? node : node?.parentElement
  if (!el || !root.contains(el)) return null
  const block = el.closest('li, p, td, blockquote, h1, h2, h3, h4, h5, h6')
  const around = block && root.contains(block) ? (block.textContent ?? '').replace(/\s+/g, ' ').trim() : ''
  return { text, sentence, excerpt: around && around !== text ? around.slice(0, 700) : null, source }
}
