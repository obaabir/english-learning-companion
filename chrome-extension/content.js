// English Companion: shows an "Explain" button next to text you select, and sends that text (with its
// sentence, paragraph and the page's readable article text) to the English Learning Companion app.
;(() => {
  if (window.__elcLoaded) return
  window.__elcLoaded = true

  const BLOCK = 'p, li, h1, h2, h3, h4, h5, h6, blockquote, pre, td, dd, dt, figcaption, article, section, div'
  const clean = (s) => (s || '').replace(/\s+/g, ' ').trim()

  /** The sentence of `block` that contains `selected`. */
  function sentenceAround(block, selected) {
    const text = clean(block)
    const sel = clean(selected)
    const at = text.indexOf(sel)
    if (!sel || at < 0) return sel
    const ends = []
    const re = /[.!?]+["'”’)\]]*\s+(?=[A-Z0-9"“'‘(])/g
    let m
    while ((m = re.exec(text))) ends.push(m.index + m[0].length)
    let start = 0
    for (const e of ends) if (e <= at) start = e
    let end = text.length
    for (const e of ends)
      if (e >= at + sel.length) {
        end = e
        break
      }
    return text.slice(start, end).trim()
  }

  /** The article's original text as plain blocks (sent once per page). */
  let articleSent = null
  function readArticle() {
    try {
      if (typeof Readability !== 'function') return null
      const parsed = new Readability(document.cloneNode(true), { serializer: (el) => el }).parse()
      if (!parsed || !parsed.content) return null
      const blocks = []
      const push = (type, text, level) => {
        const t = type === 'pre' ? (text || '').replace(/\s+$/g, '') : clean(text)
        if (t && t.length > 1) blocks.push(level ? { type, text: t, level } : { type, text: t })
      }
      const visit = (el) => {
        for (const child of el.children) {
          const tag = child.tagName.toLowerCase()
          if (/^h[1-6]$/.test(tag)) push('h', child.textContent, Number(tag[1]))
          else if (tag === 'p') push('p', child.textContent)
          else if (tag === 'pre') push('pre', child.textContent)
          else if (tag === 'li') push('li', child.textContent)
          else if (tag === 'blockquote') child.querySelector('p, li') ? visit(child) : push('quote', child.textContent)
          else if (!/^(script|style|noscript|svg|button|form|nav|aside|figure|img|picture|video|iframe)$/.test(tag)) {
            child.children.length ? visit(child) : push('p', child.textContent)
          }
        }
      }
      visit(parsed.content)
      const length = blocks.reduce((n, b) => n + b.text.length, 0)
      if (length < 300) return null
      return {
        url: location.href,
        title: clean(parsed.title || document.title),
        siteName: parsed.siteName ? clean(parsed.siteName) : null,
        byline: parsed.byline ? clean(parsed.byline) : null,
        excerpt: parsed.excerpt ? clean(parsed.excerpt).slice(0, 400) : null,
        blocks
      }
    } catch {
      return null
    }
  }

  function currentSelection() {
    const sel = window.getSelection()
    const text = sel ? clean(sel.toString()) : ''
    if (!sel || sel.isCollapsed || !sel.rangeCount || !text || text.length > 600 || !/[A-Za-z]/.test(text)) return null
    const range = sel.getRangeAt(0)
    const node = range.startContainer
    const el = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement
    if (el && el.closest('input, textarea, [contenteditable="true"]')) return null
    const block = (el && el.closest(BLOCK)) || el
    const blockText = clean(block ? block.textContent : '').slice(0, 4000)
    return { text, sentence: sentenceAround(blockText, text), paragraph: blockText.slice(0, 1200), rect: range.getBoundingClientRect() }
  }

  function send(sel) {
    if (!sel) return
    // The article text goes once per page (it is kept in the app's history).
    const article = articleSent === location.href ? null : readArticle()
    const payload = { text: sel.text, sentence: sel.sentence, paragraph: sel.paragraph, url: location.href, title: document.title, article }
    chrome.runtime.sendMessage({ type: 'elc-send', payload }, (res) => {
      if (chrome.runtime.lastError) return toast('Could not reach the extension. Reload this page.', false)
      if (res && res.ok) {
        articleSent = location.href
        toast('Sent to English Companion', true)
      } else toast((res && res.error) || 'English Learning Companion is not open.', false)
    })
  }

  // ---- floating button (in a closed shadow root, so the page's styles don't touch it)
  const host = document.createElement('div')
  host.style.cssText = 'position:fixed;z-index:2147483647;top:0;left:0;display:none'
  const root = host.attachShadow({ mode: 'closed' })
  root.innerHTML = `
    <style>
      .b{all:initial;font:600 13px system-ui,Segoe UI,sans-serif;color:#fff;background:linear-gradient(145deg,#c2185b,#781b36);
         border-radius:999px;padding:7px 13px;cursor:pointer;box-shadow:0 6px 18px rgba(120,27,54,.35);display:flex;gap:6px;align-items:center}
      .b:hover{filter:brightness(1.08)}
      .t{all:initial;font:500 13px system-ui,Segoe UI,sans-serif;color:#fff;background:#222;border-radius:10px;padding:8px 12px;
         box-shadow:0 6px 18px rgba(0,0,0,.3);max-width:320px;display:block}
      .t.ok{background:#1b5e20}
    </style>
    <button class="b" title="Explain in English Companion (Alt+Shift+E)">✨ Explain</button>
    <span class="t" style="display:none"></span>`
  const btn = root.querySelector('.b')
  const tip = root.querySelector('.t')
  let pending = null
  let toastTimer = 0

  function hide() {
    host.style.display = 'none'
    btn.style.display = 'flex'
    pending = null
  }
  function toast(text, ok) {
    btn.style.display = 'none'
    tip.textContent = text
    tip.className = ok ? 't ok' : 't'
    tip.style.display = 'block'
    host.style.display = 'block'
    clearTimeout(toastTimer)
    toastTimer = setTimeout(() => {
      tip.style.display = 'none'
      hide()
    }, ok ? 1600 : 4000)
  }

  btn.addEventListener('mousedown', (e) => e.preventDefault()) // keep the page's selection
  btn.addEventListener('click', (e) => {
    e.stopPropagation()
    send(pending)
  })

  let enabled = true
  chrome.storage.local.get({ showButton: true }, (v) => (enabled = v.showButton !== false))
  chrome.storage.onChanged.addListener((c) => {
    if (c.showButton) enabled = c.showButton.newValue !== false
  })

  document.addEventListener(
    'mouseup',
    (e) => {
      if (e.composedPath().includes(host)) return
      setTimeout(() => {
        const sel = enabled ? currentSelection() : null
        if (!sel) return tip.style.display === 'none' && hide()
        pending = sel
        if (!host.isConnected) document.documentElement.appendChild(host)
        tip.style.display = 'none'
        btn.style.display = 'flex'
        const top = sel.rect.top > 46 ? sel.rect.top - 40 : sel.rect.bottom + 8
        host.style.top = `${Math.round(top)}px`
        host.style.left = `${Math.round(Math.min(Math.max(8, sel.rect.right - 40), window.innerWidth - 120))}px`
        host.style.display = 'block'
      }, 0)
    },
    true
  )
  document.addEventListener('mousedown', (e) => !e.composedPath().includes(host) && tip.style.display === 'none' && hide(), true)
  window.addEventListener('scroll', () => tip.style.display === 'none' && hide(), { passive: true, capture: true })

  // Right-click menu / keyboard shortcut (from background.js).
  chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
    if (msg && msg.type === 'elc-collect-and-send') {
      const sel = currentSelection()
      if (sel) send(sel)
      else toast('Select some English text first.', false)
      reply({ ok: true })
    }
  })
})()
