import { afterAll, describe, expect, it } from 'vitest'
import { openDatabase } from '../src/main/db'
import { getArticleDetail, listArticles, recordArticle, setArticleNote } from '../src/main/db/repos/articles'
import { insertNote, listNotes } from '../src/main/db/repos/notes'
import { buildArticleExplain } from '../src/main/ai/article'
import { buildFocusedQuestion } from '../src/main/ai/gemini'
import { parseSelection, startChromeBridge } from '../src/main/bridge/chromeBridge'
import { articleMode, BRIDGE_PORT, domainOf, groupByDay, isFromArticle, sentenceAround, suggestedArticleKind } from '../src/shared/articles'
import type { WebSelection } from '../src/shared/articles'

describe('article helpers', () => {
  it('finds the sentence around a selection', () => {
    const p = 'The plan failed. Critics say the minister was heavily criticised for the delay. Nobody resigned.'
    expect(sentenceAround(p, 'heavily criticised')).toBe('Critics say the minister was heavily criticised for the delay.')
    expect(sentenceAround(p, 'Nobody')).toBe('Nobody resigned.')
    expect(sentenceAround(p, 'not there')).toBe('not there')
  })

  it('word vs sentence, default note type, domain', () => {
    expect(articleMode('resilient')).toBe('word')
    expect(articleMode('take it for granted')).toBe('word')
    expect(articleMode('The economy grew faster than expected.')).toBe('sentence')
    expect(suggestedArticleKind('resilient')).toBe('word')
    expect(suggestedArticleKind('give up')).toBe('phrase')
    expect(suggestedArticleKind('The economy grew faster than expected.')).toBe('sentence')
    expect(domainOf('https://www.bbc.com/news/x')).toBe('bbc.com')
    expect(domainOf('pasted:123')).toBe('Pasted text')
  })

  it('groups history as Day 1, Day 2… (oldest first)', () => {
    const at = (d: string): { firstOpenedAt: string } => ({ firstOpenedAt: new Date(`${d}T10:00:00`).toISOString() })
    const g = groupByDay([at('2026-10-12'), at('2026-10-10'), at('2026-10-10'), at('2026-10-15')])
    expect(g.map((x) => [x.day, x.date, x.items.length])).toEqual([
      [1, '2026-10-10', 2],
      [2, '2026-10-12', 1],
      [3, '2026-10-15', 1]
    ])
  })

  it('tells original article text from AI text', () => {
    const article = { blocks: [{ type: 'p' as const, text: 'Prices rose sharply in October.' }] }
    expect(isFromArticle('rose sharply', article)).toBe(true)
    expect(isFromArticle('Sales rose sharply last year.', article)).toBe(false)
  })
})

describe('article explanations', () => {
  it('word format with article context', () => {
    const r = buildArticleExplain({ text: 'criticised', sentence: 'The minister was heavily criticised.', paragraph: 'Long para…', title: 'Delay', domain: 'bbc.com' })
    expect(r.mode).toBe('word')
    for (const h of ['বাংলা অর্থ', 'Simple English definition', 'Meaning in this article', 'Part of speech', 'Synonyms', 'Examples (AI-generated)', 'Common collocations', 'Usage notes'])
      expect(r.systemInstruction).toContain(h)
    expect(r.message).toContain('Original sentence from the article: "The minister was heavily criticised."')
    expect(r.message).toContain('Delay (bbc.com)')
  })

  it('sentence format lists only relevant grammar', () => {
    const r = buildArticleExplain({ text: 'The minister, who had promised reform, resigned on Monday.', sentence: null, paragraph: null, title: null, domain: null })
    expect(r.mode).toBe('sentence')
    for (const h of ['বাংলা অনুবাদ', 'Simple English explanation', 'Sentence structure', 'Main and subordinate clauses', 'Grammar patterns', 'Idioms and phrasal verbs', 'Reusable structures'])
      expect(r.systemInstruction).toContain(h)
    expect(r.systemInstruction).toMatch(/ONLY patterns that actually appear/)
  })

  it('chat follow-ups get the word, sentence, article text and earlier explanation', () => {
    const q = buildFocusedQuestion('Can I use it for people?', {
      text: 'resilient',
      sentence: 'The economy proved resilient.',
      excerpt: 'Despite the shocks, the economy proved resilient.',
      source: 'article',
      articleTitle: 'Markets',
      articleDomain: 'ft.com',
      explanation: '### বাংলা অর্থ\nস্থিতিস্থাপক'
    })
    expect(q).toContain('"resilient"')
    expect(q).toContain('the article "Markets" (ft.com)')
    expect(q).toContain('Original sentence from the article: "The economy proved resilient."')
    expect(q).toContain('the article (surrounding text)')
    expect(q).toContain('Your earlier explanation of it:\n### বাংলা অর্থ')
    expect(q.trim().endsWith('Can I use it for people?')).toBe(true)
  })
})

describe('article history (database)', () => {
  it('records once per URL, keeps the longer saved copy, links notes, keeps personal notes', () => {
    const db = openDatabase(':memory:')
    const a = recordArticle(db, { url: 'https://ex.com/a', title: 'A', blocks: [{ type: 'p', text: 'Long original text of the article.' }] })
    expect(a.domain).toBe('ex.com')
    expect(a.hasSnapshot).toBe(true)
    // A later, failed/short read never replaces the saved copy.
    const again = recordArticle(db, { url: 'https://ex.com/a', title: 'A', blocks: [{ type: 'p', text: 'short' }] })
    expect(again.id).toBe(a.id)
    expect(getArticleDetail(db, a.id)!.blocks[0].text).toBe('Long original text of the article.')
    expect(listArticles(db)).toHaveLength(1)

    insertNote(db, { kind: 'word', text: 'original', articleId: a.id, contextSentence: 'Long original text of the article.' }, null)
    insertNote(db, { kind: 'idiom', text: 'in the long run', articleId: a.id }, null)
    insertNote(db, { kind: 'sentence', text: 'Long original text of the article.', articleId: a.id }, null)
    insertNote(db, { kind: 'word', text: 'unrelated' }, null)
    const [row] = listArticles(db)
    expect([row.vocabCount, row.sentenceCount]).toEqual([2, 1])
    expect(listNotes(db, { articleId: a.id })).toHaveLength(3)
    expect(listNotes(db, { articleId: a.id })[0].articleId).toBe(a.id)

    expect(setArticleNote(db, a.id, 'Read again on Sunday').personalNote).toBe('Read again on Sunday')
  })
})

describe('Chrome link (127.0.0.1)', () => {
  const got: WebSelection[] = []
  const server = startChromeBridge((s) => got.push(s))
  afterAll(() => server.close())
  const url = `http://127.0.0.1:${BRIDGE_PORT}`
  const body = JSON.stringify({ text: 'resilient', sentence: 'It proved resilient.', paragraph: 'p', url: 'https://ex.com/x', title: 'X' })

  it('accepts selections from a browser extension', async () => {
    await new Promise((r) => setTimeout(r, 100))
    const res = await fetch(`${url}/selection`, { method: 'POST', headers: { origin: 'chrome-extension://abc', 'x-elc-bridge': '1', 'content-type': 'application/json' }, body })
    expect(res.status).toBe(200)
    expect(got.at(-1)?.text).toBe('resilient')
    expect((await fetch(`${url}/ping`, { headers: { origin: 'chrome-extension://abc' } })).status).toBe(200)
  })

  it('refuses web pages and requests without the extension header', async () => {
    const before = got.length
    expect((await fetch(`${url}/selection`, { method: 'POST', headers: { origin: 'https://evil.example', 'x-elc-bridge': '1' }, body })).status).toBe(403)
    expect((await fetch(`${url}/selection`, { method: 'POST', headers: { origin: 'chrome-extension://abc' }, body })).status).toBe(404)
    expect(got.length).toBe(before)
  })

  it('validates what it receives', () => {
    expect(parseSelection({ text: 'x', url: 'file:///etc/passwd' })).toBeNull()
    expect(parseSelection({ text: '', url: 'https://a.b' })).toBeNull()
    const s = parseSelection({ text: 'a'.repeat(900), url: 'https://a.b', article: { blocks: [{ type: 'script', text: 'x' }, { type: 'p', text: 'ok' }] } })!
    expect(s.text.length).toBe(600)
    expect(s.article?.blocks).toEqual([{ type: 'p', text: 'ok' }])
  })
})
