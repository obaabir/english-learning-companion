import { create } from 'zustand'
import { findInPassage, parseBookRequest, replyTarget, spokenTarget, textToPages, textToParagraphs, type BookPage, type PassageMatch, type PassageRef, type ReadingSession } from '@shared/reading'
import { errorMessage, invoke } from '@renderer/lib/api'
import { useApp } from '@renderer/stores/app'
import { useArticles } from './articleStore'

/** A page photo waiting to be read (kept in the order it was added; the order can be changed). */
export interface PhotoDraft {
  key: string
  name: string
  mimeType: string
  base64: string
  /** Page number typed for it (the number printed on the page is used when it can be read). */
  label: string
  status: 'waiting' | 'reading' | 'done' | 'error'
  error?: string
  warning?: string | null
}

/** One page in the editor: its number, its text (blank line between paragraphs) and its photo. */
export interface PageDraft {
  key: string
  label: string
  text: string
  image: string | null
}

export interface SessionDraft {
  id?: number
  name: string
  bookTitle: string
  author: string
  edition: string
  /** First page number (pasted text, and photos without a readable page number). */
  startPage: string
  source: 'text' | 'photos'
  text: string
  photos: PhotoDraft[]
  /** Set once the text is ready to check and correct (step 2). */
  pages: PageDraft[] | null
}

/** What a request to explain something from the book led to. */
export type BookAnswer =
  | { status: 'shown'; match: PassageMatch; target: string }
  | { status: 'choose'; matches: PassageMatch[] }
  | { status: 'missing'; note: string }
  | { status: 'no-session' }

let keySeq = 0
const nextKey = (): string => `k${++keySeq}`
const emptyDraft = (): SessionDraft => ({ name: '', bookTitle: '', author: '', edition: '', startPage: '1', source: 'text', text: '', photos: [], pages: null })

/** The label for the n-th photo: start page + n when the start page is a number. */
export function labelFor(startPage: string, index: number): string {
  const n = Number(startPage.trim())
  return Number.isInteger(n) ? String(n + index) : index === 0 ? startPage.trim() || '1' : `${startPage.trim()} +${index}`
}

interface ReadingState {
  sessions: ReadingSession[] | null
  active: ReadingSession | null
  mode: 'list' | 'prepare' | 'read'
  draft: SessionDraft | null
  /** Several places matched: the learner picks one (also asked by JARVIS). */
  choices: PassageMatch[] | null
  /** A short message under the passage (e.g. "not in the passage"). */
  notice: string | null
  /** Bumped when the passage should scroll to the current paragraph (voice / typed requests). */
  scrollTick: number

  load: () => Promise<void>
  open: (id: number) => Promise<void>
  back: () => void
  newDraft: () => void
  editActive: () => void
  setDraft: (patch: Partial<SessionDraft>) => void
  addPhotos: (files: File[]) => Promise<void>
  movePhoto: (key: string, by: -1 | 1) => void
  removePhoto: (key: string) => void
  /** Step 1 → 2: pasted text is split into pages; photos are read one by one, in order. */
  prepareText: () => Promise<void>
  saveDraft: () => Promise<void>
  remove: (id: number) => Promise<void>
  setPosition: (page: number, paragraph: number) => void
  /** Shows a found place in the side panel (the same Explain panel as articles) and explains it. */
  show: (m: PassageMatch, explain?: boolean) => Promise<void>
  /**
   * Finds what was named (typed or spoken) in the passage and shows it, or says why not.
   * explain: false = the word is held in the panel and explained when Explain is pressed (voice).
   */
  ask: (query: string, ref?: PassageRef, opts?: { explain?: boolean }) => Promise<BookAnswer>
  /** What the learner said to JARVIS: if it names a word / sentence of the passage, it goes to the panel. */
  hear: (utterance: string) => Promise<boolean>
  /** JARVIS's reply, when the learner's words couldn't be matched: the word it quotes goes to the panel. */
  hearReply: (reply: string) => Promise<boolean>
}

const toBase64 = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '')
    r.onerror = () => reject(r.error)
    r.readAsDataURL(file)
  })

export const useReading = create<ReadingState>((set, get) => ({
  sessions: null,
  active: null,
  mode: 'list',
  draft: null,
  choices: null,
  notice: null,
  scrollTick: 0,

  load: async () => set({ sessions: await invoke('reading:list') }),
  open: async (id) => {
    const s = await invoke('reading:get', id)
    if (!s) return
    // Saved words link to the book's Articles entry, like words saved from an article.
    useArticles.setState({ articleIds: { ...useArticles.getState().articleIds, [s.url]: s.articleId } })
    set({ active: s, mode: 'read', choices: null, notice: null, scrollTick: get().scrollTick + 1 })
    void invoke('reading:position', { id: s.id, page: s.lastPage, paragraph: s.lastParagraph })
  },
  back: () => {
    set({ mode: 'list', draft: null, choices: null, notice: null })
    void get().load()
  },
  newDraft: () => set({ mode: 'prepare', draft: emptyDraft() }),
  editActive: () => {
    const s = get().active
    if (!s) return
    set({
      mode: 'prepare',
      draft: {
        ...emptyDraft(),
        id: s.id,
        name: s.name,
        bookTitle: s.bookTitle,
        author: s.author,
        edition: s.edition,
        startPage: s.pages[0]?.label ?? '1',
        pages: s.pages.map((p) => ({ key: nextKey(), label: p.label, text: p.paragraphs.join('\n\n'), image: p.image ?? null }))
      }
    })
  },
  setDraft: (patch) => {
    const d = get().draft
    if (!d) return
    const next = { ...d, ...patch }
    // Photo page numbers follow the first page number.
    if (patch.startPage !== undefined) next.photos = next.photos.map((p, i) => ({ ...p, label: labelFor(next.startPage, i) }))
    set({ draft: next })
  },
  addPhotos: async (files) => {
    const d = get().draft
    if (!d) return
    const added: PhotoDraft[] = []
    for (const f of files) {
      if (!/^image\/(png|jpeg|webp|bmp|gif)$/.test(f.type)) continue
      added.push({ key: nextKey(), name: f.name, mimeType: f.type, base64: await toBase64(f), label: '', status: 'waiting' })
    }
    // Pages keep the order they were chosen in; numbers follow from the first page number.
    const photos = [...d.photos, ...added].map((p, i) => ({ ...p, label: labelFor(d.startPage, i) }))
    set({ draft: { ...d, photos, source: 'photos' } })
  },
  movePhoto: (key, by) => {
    const d = get().draft
    if (!d) return
    const i = d.photos.findIndex((p) => p.key === key)
    const j = i + by
    if (i < 0 || j < 0 || j >= d.photos.length) return
    const photos = [...d.photos]
    ;[photos[i], photos[j]] = [photos[j], photos[i]]
    set({ draft: { ...d, photos: photos.map((p, k) => ({ ...p, label: labelFor(d.startPage, k) })) } })
  },
  removePhoto: (key) => {
    const d = get().draft
    if (!d) return
    set({ draft: { ...d, photos: d.photos.filter((p) => p.key !== key).map((p, k) => ({ ...p, label: labelFor(d.startPage, k) })) } })
  },
  prepareText: async () => {
    const d = get().draft
    if (!d) return
    if (d.source === 'text') {
      const pages = textToPages(d.text, d.startPage)
      set({ draft: { ...d, pages: pages.map((p) => ({ key: nextKey(), label: p.label, text: p.paragraphs.join('\n\n'), image: null })) } })
      return
    }
    // Photos are read one at a time, in the order given, so the pages stay in order.
    const pages: PageDraft[] = []
    for (const photo of d.photos) {
      const upd = (patch: Partial<PhotoDraft>): void => {
        const cur = get().draft
        if (cur) set({ draft: { ...cur, photos: cur.photos.map((p) => (p.key === photo.key ? { ...p, ...patch } : p)) } })
      }
      upd({ status: 'reading', error: undefined })
      try {
        const r = await invoke('reading:readPage', { imageBase64: photo.base64, mimeType: photo.mimeType })
        upd({ status: 'done', warning: r.warning })
        pages.push({ key: nextKey(), label: r.label ?? photo.label, text: r.paragraphs.join('\n\n'), image: r.imageFile })
      } catch (err) {
        upd({ status: 'error', error: errorMessage(err) })
        pages.push({ key: nextKey(), label: photo.label, text: '', image: null })
      }
    }
    const cur = get().draft
    if (cur) set({ draft: { ...cur, pages } })
  },
  saveDraft: async () => {
    const d = get().draft
    if (!d?.pages) return
    const pages: BookPage[] = d.pages.map((p) => ({ label: p.label, paragraphs: textToParagraphs(p.text), image: p.image })).filter((p) => p.paragraphs.length)
    const s = await invoke('reading:save', { id: d.id, name: d.name, bookTitle: d.bookTitle, author: d.author, edition: d.edition, pages })
    await get().open(s.id)
    set({ draft: null })
  },
  remove: async (id) => {
    await invoke('reading:delete', id)
    if (get().active?.id === id) set({ active: null })
    await get().load()
  },
  setPosition: (page, paragraph) => {
    const s = get().active
    if (!s || (s.lastPage === page && s.lastParagraph === paragraph)) return
    set({ active: { ...s, lastPage: page, lastParagraph: paragraph } })
    void invoke('reading:position', { id: s.id, page, paragraph })
  },
  show: async (m, explain = true) => {
    const s = get().active
    if (!s) return
    // A whole sentence (or paragraph) is explained as a sentence; otherwise the word / phrase in its sentence.
    const whole = m.sentence < 0 || m.matchText.trim() === m.sentenceText.trim()
    const text = whole ? m.sentenceText : m.matchText
    const arts = useArticles.getState()
    arts.select({
      text,
      sentence: m.sentence < 0 ? null : m.sentenceText,
      paragraph: m.paragraphText,
      url: s.url,
      title: s.bookTitle || s.name,
      domain: `Page ${m.pageLabel}`,
      source: 'book'
    })
    set({ choices: null, notice: null, scrollTick: get().scrollTick + 1 })
    get().setPosition(m.page, m.paragraph)
    void invoke('reading:addTarget', { id: s.id, target: { text, page: m.page, paragraph: m.paragraph, sentence: m.sentence } })
      .then((history) => {
        const cur = get().active
        if (cur?.id === s.id) set({ active: { ...cur, history } })
      })
      .catch(() => undefined)
    const sel = useArticles.getState().selection
    if (explain && sel && !useArticles.getState().explanations[sel.key] && useApp.getState().settings?.hasGeminiKey) await useArticles.getState().explain()
  },
  ask: async (query, ref = {}, opts = {}) => {
    const s = get().active
    if (!s) return { status: 'no-session' }
    // The passage stays on screen (Articles → Reading Companion) so the panel beside it shows the answer.
    if (useApp.getState().page !== 'articles') useApp.getState().setPage('articles')
    if (useArticles.getState().view !== 'companion') useArticles.getState().setView('companion')
    if (get().mode !== 'read') set({ mode: 'read' })
    // Typed / spoken text may name the place itself ("page 68, what does inevitable mean?").
    const hasRef = ref.page != null || ref.paragraph != null || ref.sentence != null
    const req = hasRef ? { query, ref } : parseBookRequest(query)
    const r = findInPassage(s.pages, req.query, req.ref)
    if (!r.matches.length) {
      const note = r.note ?? 'Not found in the prepared passage.'
      set({ notice: note, choices: null })
      return { status: 'missing', note }
    }
    // The same words in several different sentences: ask which one (never guess).
    const distinct = r.matches.filter((m, i, all) => all.findIndex((x) => x.page === m.page && x.paragraph === m.paragraph && x.sentence === m.sentence) === i)
    if (distinct.length > 1) {
      set({ choices: distinct, notice: null })
      return { status: 'choose', matches: distinct }
    }
    await get().show(distinct[0], opts.explain ?? true)
    return { status: 'shown', match: distinct[0], target: distinct[0].matchText }
  },
  hear: (utterance) => holdFound(get, set, (pages) => spokenTarget(pages, utterance)),
  hearReply: (reply) => holdFound(get, set, (pages) => replyTarget(pages, reply))
}))

/** Shows a voice-found place in the panel (held: Explain explains), or offers the choices. */
async function holdFound(
  get: () => ReadingState,
  set: (p: Partial<ReadingState>) => void,
  search: (pages: BookPage[]) => ReturnType<typeof spokenTarget>
): Promise<boolean> {
  const s = get().active
  if (!s || get().mode !== 'read' || useApp.getState().page !== 'articles' || useArticles.getState().view !== 'companion') return false
  const r = search(s.pages)
  if (!r?.matches.length) return false
  const distinct = r.matches.filter((m, i, all) => all.findIndex((x) => x.page === m.page && x.paragraph === m.paragraph && x.sentence === m.sentence) === i)
  if (distinct.length > 1) {
    set({ choices: distinct, notice: null })
    return true
  }
  // Already showing this one (JARVIS's own tool may have found it too): nothing to do.
  const m = distinct[0]
  const sel = useArticles.getState().selection
  if (sel && sel.source === 'book' && sel.sentence === m.sentenceText && (sel.text === m.matchText || sel.text === m.sentenceText)) return true
  await get().show(m, false)
  return true
}
