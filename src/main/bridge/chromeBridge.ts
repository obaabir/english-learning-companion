import http from 'node:http'
import { BRIDGE_PORT, type ArticleBlock, type WebSelection } from '@shared/articles'

/**
 * A tiny local link (like VLC's) so the English Companion Chrome extension can send the text you
 * select in Chrome to this app. It listens on 127.0.0.1 only (never reachable from the network) and
 * accepts requests only from a browser extension: web pages are refused, because they send their own
 * Origin and can't add the x-elc-bridge header without a CORS check that this server rejects.
 * Tests pass port 0 (any free port) so they never talk to a running copy of the app.
 */
export function startChromeBridge(onSelection: (sel: WebSelection) => void, port = BRIDGE_PORT): http.Server {
  const server = http.createServer((req, res) => {
    const origin = req.headers.origin
    const fromExtension = !origin || /^(chrome|moz)-extension:\/\//.test(origin)
    if (!fromExtension) {
      res.writeHead(403).end()
      return
    }
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin)
      res.setHeader('Access-Control-Allow-Headers', 'content-type, x-elc-bridge')
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    }
    if (req.method === 'OPTIONS') {
      res.writeHead(204).end()
      return
    }
    if (req.method === 'GET' && req.url === '/ping') {
      json(res, 200, { ok: true, app: 'English Learning Companion' })
      return
    }
    if (req.method !== 'POST' || req.url !== '/selection' || req.headers['x-elc-bridge'] !== '1') {
      res.writeHead(404).end()
      return
    }
    let size = 0
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => {
      size += c.length
      if (size > 2_000_000) req.destroy()
      else chunks.push(c)
    })
    req.on('end', () => {
      try {
        const sel = parseSelection(JSON.parse(Buffer.concat(chunks).toString('utf8')))
        if (!sel) return json(res, 400, { ok: false, error: 'Nothing selected.' })
        onSelection(sel)
        json(res, 200, { ok: true })
      } catch {
        json(res, 400, { ok: false, error: 'Bad request.' })
      }
    })
  })
  server.on('error', (err) => console.warn(`Chrome link not started (port ${port}):`, err.message))
  server.listen(port, '127.0.0.1')
  return server
}

function json(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body))
}

const str = (v: unknown, max: number): string | null => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null)

/** Accepts only well-formed selections from http(s) pages, trimmed to sensible sizes. */
export function parseSelection(raw: unknown): WebSelection | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const text = str(r.text, 600)
  const url = str(r.url, 2000)
  if (!text || !url || !/^https?:\/\//.test(url)) return null
  const title = str(r.title, 300) ?? url
  let article: WebSelection['article'] = null
  if (r.article && typeof r.article === 'object') {
    const a = r.article as Record<string, unknown>
    const blocks = Array.isArray(a.blocks)
      ? (a.blocks as unknown[])
          .filter((b): b is ArticleBlock => !!b && typeof b === 'object' && typeof (b as ArticleBlock).text === 'string')
          .filter((b) => ['h', 'p', 'li', 'quote', 'pre'].includes(b.type))
          .slice(0, 3000)
          .map((b) => (b.type === 'h' ? { type: b.type, text: b.text.slice(0, 20_000), level: Number(b.level) || 2 } : { type: b.type, text: b.text.slice(0, 20_000) }))
      : null
    article = {
      url,
      title: str(a.title, 300) ?? title,
      siteName: str(a.siteName, 200),
      byline: str(a.byline, 200),
      excerpt: str(a.excerpt, 400),
      blocks
    }
  }
  return { text, sentence: str(r.sentence, 2000), paragraph: str(r.paragraph, 1200), url, title, article }
}
