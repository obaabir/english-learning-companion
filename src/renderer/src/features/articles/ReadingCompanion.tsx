import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ArrowDown, ArrowLeft, ArrowUp, BookOpen, Camera, ClipboardType, Loader2, Mic, Pencil, Plus, Search, Square, Trash2, X } from 'lucide-react'
import { findInPassage, UNCLEAR } from '@shared/reading'
import { invoke } from '@renderer/lib/api'
import { cn } from '@renderer/lib/cn'
import { useApp } from '@renderer/stores/app'
import { Button, Field, Input, Textarea } from '@renderer/components/ui'
import { endVoiceMode, startVoiceMode, useVoiceMode, voiceModeActive, type VoiceModeStatus } from '@renderer/features/voice/voiceModeStore'
import { useReading, type PageDraft, type PhotoDraft } from './readingStore'

/**
 * Reading Companion (Articles): prepare a passage of a physical book (paste it or photograph the pages),
 * then read the real book and ask JARVIS about any word, phrase or sentence. Answers appear in the
 * Explanation panel beside the passage (the same panel as articles) and JARVIS says them aloud.
 */
export function ReadingCompanion(): ReactNode {
  const mode = useReading((s) => s.mode)
  useEffect(() => {
    void useReading.getState().load()
  }, [])
  return (
    <div className="absolute inset-0 overflow-hidden" data-reading-companion>
      {mode === 'list' && <SessionList />}
      {mode === 'prepare' && <Prepare />}
      {mode === 'read' && <ReadView />}
    </div>
  )
}

// ---- Saved passages
function SessionList(): ReactNode {
  const sessions = useReading((s) => s.sessions)
  const { newDraft, open, remove } = useReading.getState()
  const toastError = useApp((s) => s.toastError)
  return (
    <div className="h-full overflow-y-auto px-6 py-6">
      <div className="mx-auto max-w-3xl">
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="flex items-center gap-2 text-lg font-semibold">
              <BookOpen className="size-5 text-rose" /> Reading Companion
            </h2>
            <p className="mt-1 text-sm text-muted">
              Put the pages you are going to read here (paste them or take photos). Then read your real book, and when a word or sentence is hard, ask JARVIS:
              it finds it in these pages, explains it aloud and shows the explanation beside the passage.
            </p>
          </div>
          <Button variant="primary" icon={<Plus className="size-4" />} onClick={newDraft}>
            New passage
          </Button>
        </div>
        {!sessions ? (
          <p className="mt-6 flex items-center gap-2 text-sm text-muted">
            <Loader2 className="size-4 animate-spin" /> Loading…
          </p>
        ) : !sessions.length ? (
          <div className="glass-inset mt-6 rounded-2xl p-5 text-sm text-muted">No passages yet. Press “New passage” to add the pages you are reading.</div>
        ) : (
          <ul className="mt-6 space-y-2">
            {sessions.map((s, i) => (
              <li key={s.id} className="glass-inset flex items-center gap-3 rounded-2xl px-4 py-3" data-session={s.id}>
                <button className="min-w-0 flex-1 text-left" onClick={() => void open(s.id).catch(toastError)}>
                  <p className="truncate font-medium">
                    {s.name}
                    {i === 0 && <span className="ml-2 text-xs font-normal text-accent">last read</span>}
                  </p>
                  <p className="truncate text-xs text-muted">
                    {[s.bookTitle, s.author].filter(Boolean).join(' · ')}
                    {(s.bookTitle || s.author) && ' · '}
                    {s.pages.length === 1 ? `page ${s.pages[0].label}` : `pages ${s.pages[0].label}–${s.pages[s.pages.length - 1].label}`} · at page {s.pages[s.lastPage]?.label ?? s.pages[0].label}
                  </p>
                </button>
                <Button size="sm" variant="secondary" onClick={() => void open(s.id).catch(toastError)}>
                  {i === 0 ? 'Continue reading' : 'Open'}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<Trash2 className="size-3.5" />}
                  aria-label={`Delete ${s.name}`}
                  title="Delete this passage (saved words stay in Notes)"
                  onClick={() => {
                    if (confirm(`Delete the passage "${s.name}"? Words you saved from it stay in your Notes.`)) void remove(s.id).catch(toastError)
                  }}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

// ---- Prepare: step 1 (paste / photos), step 2 (check and correct the text)
function Prepare(): ReactNode {
  const draft = useReading((s) => s.draft)
  const { setDraft, back, prepareText } = useReading.getState()
  const toastError = useApp((s) => s.toastError)
  const [busy, setBusy] = useState(false)
  if (!draft) return null
  if (draft.pages) return <CheckText />
  const reading = draft.photos.some((p) => p.status === 'reading')
  const canNext = draft.source === 'text' ? draft.text.trim().length > 0 : draft.photos.length > 0
  return (
    <div className="h-full overflow-y-auto px-6 py-5">
      <div className="mx-auto max-w-3xl space-y-4">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" icon={<ArrowLeft className="size-4" />} onClick={back}>
            Passages
          </Button>
          <h2 className="text-base font-semibold">{draft.id ? 'Edit passage' : 'New passage'}</h2>
          <span className="text-xs text-muted">Step 1 of 2</span>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Session name (optional)">
            <Input value={draft.name} onChange={(e) => setDraft({ name: e.target.value })} placeholder="e.g. Chapter 3" />
          </Field>
          <Field label="Book title (optional)">
            <Input value={draft.bookTitle} onChange={(e) => setDraft({ bookTitle: e.target.value })} placeholder="e.g. The Alchemist" />
          </Field>
          <Field label="Author (optional)">
            <Input value={draft.author} onChange={(e) => setDraft({ author: e.target.value })} />
          </Field>
          <Field label="Edition (optional)">
            <Input value={draft.edition} onChange={(e) => setDraft({ edition: e.target.value })} />
          </Field>
          <Field label="First page number" hint="The next pages are numbered from it (68, 69, 70…).">
            <Input
              value={draft.startPage}
              onChange={(e) => setDraft({ startPage: e.target.value })}
              aria-label="First page number"
              className="max-w-32"
            />
          </Field>
        </div>
        <div className="flex gap-2" role="radiogroup" aria-label="How to add the passage">
          {(
            [
              ['text', 'Paste text', <ClipboardType key="t" className="size-4" />],
              ['photos', 'Page photos', <Camera key="p" className="size-4" />]
            ] as const
          ).map(([v, label, icon]) => (
            <button
              key={v}
              role="radio"
              aria-checked={draft.source === v}
              onClick={() => setDraft({ source: v })}
              className={cn('motion-press flex h-9 items-center gap-2 rounded-xl border px-3 text-sm font-medium', draft.source === v ? 'surface-selected text-accent' : 'border-white/10 text-muted')}
            >
              {icon}
              {label}
            </button>
          ))}
        </div>
        {draft.source === 'text' ? (
          <Field label="The passage" hint={`Leave a blank line between paragraphs. To start a new page, put a line like [page 69] before it.`}>
            <Textarea value={draft.text} onChange={(e) => setDraft({ text: e.target.value })} rows={14} placeholder="Paste the pages you are going to read…" aria-label="Passage text" />
          </Field>
        ) : (
          <Photos />
        )}
        <div className="flex justify-end gap-2">
          <Button
            variant="primary"
            loading={busy || reading}
            disabled={!canNext}
            onClick={() => {
              setBusy(true)
              void prepareText()
                .catch(toastError)
                .finally(() => setBusy(false))
            }}
          >
            {draft.source === 'text' ? 'Next: check the text' : `Read ${draft.photos.length} page${draft.photos.length === 1 ? '' : 's'}`}
          </Button>
        </div>
      </div>
    </div>
  )
}

function Photos(): ReactNode {
  const photos = useReading((s) => s.draft!.photos)
  const { addPhotos, movePhoto, removePhoto } = useReading.getState()
  const input = useRef<HTMLInputElement>(null)
  return (
    <div className="space-y-2">
      <p className="text-sm text-muted">
        Add the photos in reading order (you can choose many at once; they keep the order you chose). The page number printed on a page is read automatically; otherwise
        the numbers continue from the first page number.
      </p>
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/bmp,image/gif"
        multiple
        hidden
        aria-label="Page photos"
        onChange={(e) => {
          // Files come in the order they were chosen; sorted by name so "IMG_1, IMG_2…" stay in order.
          const files = [...(e.target.files ?? [])].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
          void addPhotos(files)
          e.target.value = ''
        }}
      />
      <Button icon={<Camera className="size-4" />} onClick={() => input.current?.click()}>
        Add page photos
      </Button>
      {photos.length > 0 && (
        <ol className="space-y-1.5">
          {photos.map((p, i) => (
            <PhotoRow key={p.key} p={p} first={i === 0} last={i === photos.length - 1} onMove={(by) => movePhoto(p.key, by)} onRemove={() => removePhoto(p.key)} />
          ))}
        </ol>
      )}
    </div>
  )
}

function PhotoRow({ p, first, last, onMove, onRemove }: { p: PhotoDraft; first: boolean; last: boolean; onMove: (by: -1 | 1) => void; onRemove: () => void }): ReactNode {
  return (
    <li className="glass-inset flex items-center gap-3 rounded-xl px-3 py-2" data-photo={p.label}>
      <img src={`data:${p.mimeType};base64,${p.base64}`} alt="" className="h-14 w-11 shrink-0 rounded object-cover" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">Page {p.label}</p>
        <p className="truncate text-xs text-muted">{p.name}</p>
        {p.status === 'reading' && (
          <p className="flex items-center gap-1 text-xs text-info">
            <Loader2 className="size-3 animate-spin" /> Reading…
          </p>
        )}
        {p.status === 'done' && <p className="text-xs text-muted">{p.warning ?? 'Read ✓'}</p>}
        {p.status === 'error' && <p className="text-xs text-danger">{p.error}</p>}
      </div>
      <Button size="sm" variant="ghost" icon={<ArrowUp className="size-3.5" />} aria-label="Move up" disabled={first} onClick={() => onMove(-1)} />
      <Button size="sm" variant="ghost" icon={<ArrowDown className="size-3.5" />} aria-label="Move down" disabled={last} onClick={() => onMove(1)} />
      <Button size="sm" variant="ghost" icon={<X className="size-3.5" />} aria-label="Remove photo" onClick={onRemove} />
    </li>
  )
}

function PageThumb({ file }: { file: string }): ReactNode {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    invoke('reading:pageImage', file).then(setUrl, () => setUrl(null))
  }, [file])
  if (!url) return null
  return (
    <a href={url} target="_blank" rel="noreferrer" title="Open the photo" className="shrink-0">
      <img src={url} alt="Page photo" className="max-h-72 w-40 rounded-lg border border-white/10 object-contain" />
    </a>
  )
}

function CheckText(): ReactNode {
  const draft = useReading((s) => s.draft)!
  const { setDraft, saveDraft } = useReading.getState()
  const toastError = useApp((s) => s.toastError)
  const [saving, setSaving] = useState(false)
  const pages = draft.pages!
  const update = (key: string, patch: Partial<PageDraft>): void => setDraft({ pages: pages.map((p) => (p.key === key ? { ...p, ...patch } : p)) })
  const empty = pages.every((p) => !p.text.trim())
  return (
    <div className="h-full overflow-y-auto px-6 py-5">
      <div className="mx-auto max-w-4xl space-y-4">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" icon={<ArrowLeft className="size-4" />} onClick={() => setDraft({ pages: null })}>
            Back
          </Button>
          <h2 className="text-base font-semibold">Check the text</h2>
          <span className="text-xs text-muted">Step 2 of 2</span>
        </div>
        <p className="text-sm text-muted">
          Correct anything that was read wrongly (compare with the photo). Words that could not be read are marked {UNCLEAR}. Keep a blank line between paragraphs: JARVIS uses
          the page and paragraph numbers (“page 68, paragraph 2”).
        </p>
        {pages.map((p) => {
          const unclear = p.text.split(UNCLEAR).length - 1
          return (
            <section key={p.key} className="glass-inset rounded-2xl p-4" data-check-page={p.label}>
              <div className="mb-2 flex items-center gap-2">
                <span className="text-sm font-medium">Page</span>
                <Input value={p.label} onChange={(e) => update(p.key, { label: e.target.value })} className="h-8 w-24" aria-label="Page number" />
                {unclear > 0 && (
                  <span className="text-xs text-warn">
                    {unclear} unclear word{unclear === 1 ? '' : 's'}: fix {UNCLEAR}
                  </span>
                )}
                {!p.text.trim() && <span className="text-xs text-danger">No text: type it or remove this page.</span>}
                <Button
                  size="sm"
                  variant="ghost"
                  className="ml-auto"
                  icon={<X className="size-3.5" />}
                  aria-label="Remove this page"
                  onClick={() => setDraft({ pages: pages.filter((x) => x.key !== p.key) })}
                />
              </div>
              <div className="flex gap-3">
                <Textarea value={p.text} onChange={(e) => update(p.key, { text: e.target.value })} rows={10} className="min-w-0 flex-1 text-[14px] leading-relaxed" aria-label={`Text of page ${p.label}`} />
                {p.image && <PageThumb file={p.image} />}
              </div>
            </section>
          )
        })}
        <div className="flex justify-end">
          <Button
            variant="primary"
            loading={saving}
            disabled={empty}
            onClick={() => {
              setSaving(true)
              void saveDraft()
                .catch(toastError)
                .finally(() => setSaving(false))
            }}
          >
            Save and start reading
          </Button>
        </div>
      </div>
    </div>
  )
}

// ---- Reading: the passage, JARVIS, and typed questions
function ReadView(): ReactNode {
  const s = useReading((st) => st.active)!
  const choices = useReading((st) => st.choices)
  const notice = useReading((st) => st.notice)
  const scrollTick = useReading((st) => st.scrollTick)
  const { back, editActive, setPosition, show, ask } = useReading.getState()
  const toastError = useApp((st) => st.toastError)
  const [q, setQ] = useState('')
  const listRef = useRef<HTMLDivElement>(null)

  // Voice / typed requests bring the current paragraph into view; the learner's own scrolling is kept.
  useEffect(() => {
    listRef.current?.querySelector(`[data-pos="${s.lastPage}-${s.lastParagraph}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollTick])

  /** Text selected with the mouse in the passage: shown in the panel (press Explain there), like articles. */
  const onMouseUp = (): void => {
    const sel = window.getSelection()
    const text = sel?.toString().replace(/\s+/g, ' ').trim() ?? ''
    if (!text || text.length > 600) return
    const el = (sel?.anchorNode?.parentElement ?? null)?.closest<HTMLElement>('[data-pos]')
    if (!el) return
    const [page, para] = el.dataset.pos!.split('-').map(Number)
    const m = findInPassage(s.pages, text, { page: s.pages[page].label, paragraph: para + 1 }).matches[0]
    if (m) void show(m, false)
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-white/10 px-4 py-2.5">
        <Button variant="ghost" size="sm" icon={<ArrowLeft className="size-4" />} onClick={back} aria-label="All passages" title="All passages" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{s.name}</p>
          <p className="truncate text-xs text-muted">{[s.bookTitle, s.author, s.edition].filter(Boolean).join(' · ') || `${s.pages.length} page${s.pages.length === 1 ? '' : 's'}`}</p>
        </div>
        <select
          value={s.lastPage}
          onChange={(e) => {
            setPosition(Number(e.target.value), 0)
            useReading.setState({ scrollTick: useReading.getState().scrollTick + 1 })
          }}
          className="glass-field h-8 rounded-lg px-2 text-xs"
          aria-label="Go to page"
        >
          {s.pages.map((p, i) => (
            <option key={i} value={i}>
              Page {p.label}
            </option>
          ))}
        </select>
        <Button size="sm" variant="ghost" icon={<Pencil className="size-3.5" />} onClick={editActive}>
          Edit text
        </Button>
      </div>

      <CompanionMic />

      <form
        className="flex shrink-0 items-center gap-2 px-4 pb-2"
        onSubmit={(e) => {
          e.preventDefault()
          if (q.trim()) void ask(q).catch(toastError)
        }}
      >
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-muted" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Or type a word, phrase or the start of a sentence…" className="h-9 pl-8 text-sm" aria-label="Find in the passage" />
        </div>
        <Button type="submit" size="sm" variant="secondary" disabled={!q.trim()}>
          Explain
        </Button>
      </form>

      {(choices || notice) && (
        <div className="mx-4 mb-2 shrink-0 rounded-xl border border-white/10 px-3 py-2 text-sm" role="status">
          {notice && <p className="text-warn">{notice}</p>}
          {choices && (
            <>
              <p className="mb-1.5 text-muted">It appears in {choices.length} places. Which one?</p>
              <div className="space-y-1">
                {choices.map((m, i) => (
                  <button key={i} onClick={() => void show(m).catch(toastError)} className="motion-press block w-full rounded-lg px-2 py-1.5 text-left hover:bg-white/5" data-choice={i}>
                    <span className="text-xs text-muted">
                      Page {m.pageLabel}, paragraph {m.paragraph + 1}:{' '}
                    </span>
                    {m.sentenceText}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {s.history.length > 0 && (
        <div className="flex shrink-0 items-center gap-1.5 overflow-x-auto px-4 pb-2" aria-label="Recently explained">
          <span className="shrink-0 text-xs text-muted">Recent:</span>
          {s.history.slice(0, 12).map((t, i) => (
            <button
              key={`${t.text}-${i}`}
              className="motion-press shrink-0 rounded-full border border-white/10 px-2.5 py-0.5 text-xs hover:text-fg"
              title={`Page ${s.pages[t.page]?.label ?? '?'}, paragraph ${t.paragraph + 1}`}
              onClick={() => {
                const page = s.pages[t.page]
                const m = page && findInPassage(s.pages, t.text, { page: page.label, paragraph: t.paragraph + 1 }).matches[0]
                if (m) void show(m).catch(toastError)
              }}
            >
              {t.text.length > 40 ? `${t.text.slice(0, 38)}…` : t.text}
            </button>
          ))}
        </div>
      )}

      <div ref={listRef} onMouseUp={onMouseUp} className="reader-surface min-h-0 flex-1 overflow-y-auto" data-passage>
        <div className="mx-auto max-w-[70ch] px-8 py-6 text-[17px] leading-[1.75]">
          {s.pages.map((p, pi) => (
            <section key={pi} aria-label={`Page ${p.label}`} className="mb-8">
              <h3 className="mb-3 border-b border-black/10 pb-1 text-xs font-semibold tracking-wider text-[#6b6b73] uppercase">Page {p.label}</h3>
              {p.paragraphs.map((para, qi) => {
                const here = s.lastPage === pi && s.lastParagraph === qi
                return (
                  <p
                    key={qi}
                    data-pos={`${pi}-${qi}`}
                    onClick={() => !window.getSelection()?.toString() && setPosition(pi, qi)}
                    className={cn('relative mb-4 rounded-md pl-7', here && 'bg-[#fff6d6]')}
                  >
                    <span className="absolute top-0.5 left-0 text-xs text-[#9a9aa3] select-none" aria-hidden>
                      ¶{qi + 1}
                    </span>
                    {para}
                  </p>
                )
              })}
            </section>
          ))}
        </div>
      </div>
    </div>
  )
}

const MIC_TEXT: Record<VoiceModeStatus, string> = {
  off: 'Ask JARVIS',
  connecting: 'Connecting…',
  listening: 'Listening… say the word or sentence',
  thinking: 'Thinking…',
  speaking: 'Speaking…',
  reconnecting: 'Reconnecting…',
  error: 'Ask JARVIS'
}

/** JARVIS for the book: the real Voice Mode. Answers are spoken and shown in the Explanation panel. */
function CompanionMic(): ReactNode {
  const status = useVoiceMode((s) => s.status)
  const error = useVoiceMode((s) => s.error)
  const lastHeard = useVoiceMode((s) => [...s.transcript].reverse().find((t) => t.role === 'user')?.text ?? '')
  const lastReply = useVoiceMode((s) => [...s.transcript].reverse().find((t) => t.role === 'model')?.text ?? '')
  const active = status !== 'off' && status !== 'error'
  const setPage = useApp((s) => s.setPage)
  // The microphone is used only while you choose; the Voice Mode panel stays closed (the passage is the interface).
  const start = (prefer: 'live' | 'basic'): void =>
    void startVoiceMode(prefer).then(() => {
      if (!useVoiceMode.getState().askConsent) useVoiceMode.setState({ open: false })
    })
  return (
    <div className="shrink-0 px-4 py-3">
      <div className="flex items-center gap-3">
        <button
          onClick={() => (voiceModeActive() ? void endVoiceMode() : start('live'))}
          className={cn('jarvis-mic motion-press shrink-0', active && 'animate-pulse')}
          data-active={active}
          aria-label={active ? 'Stop JARVIS' : 'Ask JARVIS'}
          title={active ? 'Stop (the microphone turns off)' : 'Talk to JARVIS about the book'}
        >
          {active ? <Square className="size-5 fill-current" /> : <Mic className="size-6" />}
        </button>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-[#9fdcff]" aria-live="polite">
            {MIC_TEXT[status]}
          </p>
          {active ? (
            <div className="text-xs">
              {lastHeard && <p className="truncate text-muted">You: {lastHeard}</p>}
              {lastReply && <p className="line-clamp-2 text-fg/90">JARVIS: {lastReply}</p>}
            </div>
          ) : (
            <p className="text-xs text-muted">Say: “Explain reluctantly” · “Page 68: what does inevitable mean?” · “Explain the sentence starting Despite his failures”</p>
          )}
        </div>
      </div>
      {!active && error && (
        <div className="mt-2 text-xs text-warn">
          <p>{error.message}</p>
          {error.reason === 'auth' && (
            <div className="mt-1.5 flex gap-2">
              <button onClick={() => start('basic')} className="underline">
                Use basic voice
              </button>
              <button onClick={() => setPage('settings')} className="underline">
                Open Settings
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
