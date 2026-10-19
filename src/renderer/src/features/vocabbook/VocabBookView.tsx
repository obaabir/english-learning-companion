import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { BookMarked, FileText, Play, Plus, RotateCcw, Settings2, Target } from 'lucide-react'
import { VB_MODES, VB_SOURCE_KINDS, type VbDashboard, type VbItem, type VbMistake, type VbMode, type VbSource } from '@shared/vocabBook'
import type { GoogleDocInfo } from '@shared/types'
import { invoke, on } from '@renderer/lib/api'
import { useApp } from '@renderer/stores/app'
import { Badge, Button, EmptyState, Input, PanelHeader } from '@renderer/components/ui'
import { DocPicker } from '@renderer/components/DocPicker'
import { cn } from '@renderer/lib/cn'
import { useVb } from './vbStore'
import { AddWords } from './AddWords'
import { MistakeBadge, MistakeTable, WordList } from './WordList'
import { Session, type SessionSummary } from './Session'

type Tab = 'today' | 'add' | 'words' | 'sources' | 'mistakes'
const TABS: { id: Tab; label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: 'add', label: 'Add words' },
  { id: 'words', label: 'Words & cards' },
  { id: 'sources', label: 'Sources' },
  { id: 'mistakes', label: 'Mistakes' }
]

/** Library → Vocabulary Book Learning: your own books of words, learned in order. */
export function VocabBookView(): ReactNode {
  const { books, bookId, setBook, refreshBooks, version, bump } = useVb()
  const [tab, setTab] = useState<Tab>('today')
  const [items, setItems] = useState<VbItem[]>([])
  const [session, setSession] = useState<'daily' | 'mistakes' | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const toastError = useApp((s) => s.toastError)

  useEffect(() => {
    void refreshBooks()
      .catch(toastError)
      .finally(() => setLoaded(true))
  }, [refreshBooks, toastError])
  const reload = useCallback(() => {
    if (bookId) void invoke('vb:items', bookId).then(setItems).catch(toastError)
  }, [bookId, toastError])
  useEffect(reload, [reload, version])
  // Meanings filled in in the background.
  useEffect(() => on('vb:changed', ({ bookId: b }) => b === useVb.getState().bookId && bump()), [bump])

  const book = books.find((b) => b.id === bookId) ?? null
  return (
    <div className="glass-panel flex h-full flex-col overflow-hidden">
      <PanelHeader title="Vocabulary Book Learning" icon={<BookMarked className="size-4" />}>
        {books.length > 0 && (
          <select
            value={bookId ?? ''}
            onChange={(e) => {
              setBook(Number(e.target.value))
              setSession(null)
            }}
            className="glass-field h-8 max-w-[220px] cursor-pointer rounded-lg px-2 text-sm"
            aria-label="Book"
          >
            {books.map((b) => (
              <option key={b.id} value={b.id}>
                {b.title} ({b.total})
              </option>
            ))}
          </select>
        )}
        <NewBookButton />
        {book && <Button size="sm" variant="ghost" icon={<Settings2 className="size-4" />} aria-label="Book settings" aria-expanded={showSettings} onClick={() => setShowSettings(!showSettings)} />}
      </PanelHeader>
      {!loaded ? null : !book ? (
        <EmptyState icon={<BookMarked className="size-10" />} title="Start your first vocabulary book">
          A book keeps its own words in order, its own flashcards, revision schedule (Day 1, Day 4, Day 7), mistakes and Google Doc — separate from your regular notes.
          <div className="mt-3">
            <NewBookButton primary />
          </div>
        </EmptyState>
      ) : (
        <>
          {showSettings && <BookSettings key={book.id} />}
          {!session && (
            <div className="flex shrink-0 gap-1 overflow-x-auto border-b border-line/60 px-3 py-2" role="tablist">
              {TABS.map((t) => (
                <button
                  key={t.id}
                  role="tab"
                  aria-selected={tab === t.id}
                  onClick={() => setTab(t.id)}
                  className={cn('motion-press h-8 shrink-0 rounded-[10px] border px-3 text-xs font-medium', tab === t.id ? 'surface-selected' : 'border-transparent text-muted hover:text-fg')}
                >
                  {t.label}
                </button>
              ))}
            </div>
          )}
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            {session ? (
              <Session
                key={`${book.id}-${session}`}
                bookId={book.id}
                kind={session}
                modes={useVb.getState().modes}
                onExit={(s: SessionSummary | null) => {
                  setSession(null)
                  bump()
                  void refreshBooks()
                  if (s) useApp.getState().toast('success', `${s.newLearned} new · ${s.reviewed} revised · ${s.mistakes} mistake${s.mistakes === 1 ? '' : 's'} recorded`)
                }}
              />
            ) : tab === 'today' ? (
              <Today bookId={book.id} items={items} onStart={setSession} onAdd={() => setTab('add')} />
            ) : tab === 'add' ? (
              <AddWords
                bookId={book.id}
                onImported={() => {
                  bump()
                  void refreshBooks()
                  setTab('words')
                }}
              />
            ) : tab === 'words' ? (
              <WordList bookId={book.id} items={items} onChanged={bump} />
            ) : tab === 'sources' ? (
              <Sources bookId={book.id} />
            ) : (
              <Mistakes bookId={book.id} onReview={() => setSession('mistakes')} />
            )}
          </div>
        </>
      )}
    </div>
  )
}

function NewBookButton({ primary }: { primary?: boolean }): ReactNode {
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const { refreshBooks, setBook } = useVb()
  const toastError = useApp((s) => s.toastError)
  if (!open)
    return (
      <Button size="sm" variant={primary ? 'primary' : 'ghost'} icon={<Plus className="size-4" />} onClick={() => setOpen(true)}>
        New book
      </Button>
    )
  return (
    <form
      className="flex items-center gap-1.5"
      onSubmit={async (e) => {
        e.preventDefault()
        try {
          const b = await invoke('vb:createBook', { title })
          await refreshBooks()
          setBook(b.id)
          setOpen(false)
          setTitle('')
        } catch (err) {
          toastError(err)
        }
      }}
    >
      <Input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Book name, e.g. Word Power" className="h-8 w-52" aria-label="Book name" onKeyDown={(e) => e.key === 'Escape' && setOpen(false)} />
      <Button size="sm" type="submit" variant="primary" disabled={!title.trim()}>
        Create
      </Button>
    </form>
  )
}

/** The book's settings: name, new words per day, and its own Google Doc. */
function BookSettings(): ReactNode {
  const { books, bookId, refreshBooks } = useVb()
  const book = books.find((b) => b.id === bookId)!
  const { toast, toastError } = useApp.getState()
  const googleConnected = useApp((s) => !!s.settings?.googleConnected)
  const [title, setTitle] = useState(book.title)
  const [doc, setDoc] = useState<GoogleDocInfo | null>(null)
  const [picking, setPicking] = useState(false)
  const [syncing, setSyncing] = useState(false)
  useEffect(() => {
    void invoke('vb:doc').then(setDoc)
  }, [])
  const save = async (p: { title?: string; dailyNew?: number }): Promise<void> => {
    try {
      await invoke('vb:updateBook', { id: book.id, ...p })
      await refreshBooks()
    } catch (err) {
      toastError(err)
    }
  }
  return (
    <div className="glass-inset mx-4 mt-3 flex flex-wrap items-end gap-4 rounded-xl px-4 py-3 text-sm">
      <label className="block">
        <span className="text-xs text-muted">Book name</span>
        <Input value={title} onChange={(e) => setTitle(e.target.value)} onBlur={() => title.trim() && title !== book.title && void save({ title })} className="mt-0.5 h-8 w-56" aria-label="Rename book" />
      </label>
      <div>
        <span className="text-xs text-muted">Google Doc for Vocabulary Book Learning (separate from your regular vocabulary doc)</span>
        <div className="mt-0.5 flex items-center gap-2">
          <Badge tone={doc ? 'info' : 'warn'}>
            <FileText className="size-3" /> {doc ? doc.title : 'not chosen'}
          </Badge>
          <Button size="sm" disabled={!googleConnected} title={googleConnected ? '' : 'Connect Google in Settings first'} onClick={() => setPicking(true)}>
            {doc ? 'Change' : 'Choose or create'}
          </Button>
          <Button
            size="sm"
            loading={syncing}
            disabled={!doc || !googleConnected}
            onClick={async () => {
              setSyncing(true)
              try {
                const r = await invoke('vb:sync', book.id)
                if (r.error) toast('error', `Google Docs: ${r.error}`)
                else toast('success', r.added ? `Added ${r.added} word${r.added === 1 ? '' : 's'} to "${doc?.title}"` : 'Everything is already in the doc')
              } catch (err) {
                toastError(err)
              } finally {
                setSyncing(false)
              }
            }}
          >
            Sync this book
          </Button>
        </div>
        <p className="mt-0.5 text-xs text-muted">The app keeps your words; the doc gets a copy (new words are added automatically when Google is connected and auto-save is on).</p>
      </div>
      {picking && (
        <DocPicker
          heading="Google Doc for Vocabulary Book Learning"
          defaultTitle="Vocabulary Book Notes"
          onChoose={async (d) => {
            setDoc(await invoke('vb:setDoc', d))
            toast('success', `Vocabulary Book words will go to "${d.title}"`)
          }}
          onCreate={async (t) => {
            setDoc(await invoke('vb:createDoc', t))
            toast('success', `Created "${t}"`)
          }}
          onClose={() => setPicking(false)}
        />
      )}
    </div>
  )
}

const PRESETS = [5, 10, 15, 20]

function Today({ bookId, items, onStart, onAdd }: { bookId: number; items: VbItem[]; onStart: (k: 'daily' | 'mistakes') => void; onAdd: () => void }): ReactNode {
  const { modes, setModes, books, refreshBooks, version } = useVb()
  const book = books.find((b) => b.id === bookId)!
  const [d, setD] = useState<VbDashboard | null>(null)
  const [custom, setCustom] = useState('')
  const toastError = useApp((s) => s.toastError)
  useEffect(() => {
    void invoke('vb:dashboard', bookId).then(setD).catch(toastError)
  }, [bookId, items, version, book.dailyNew, toastError])
  if (!d) return null
  if (!d.total)
    return (
      <EmptyState icon={<Target className="size-10" />} title="No words in this book yet">
        <Button className="mt-2" variant="primary" icon={<Plus className="size-4" />} onClick={onAdd}>
          Add words
        </Button>
      </EmptyState>
    )
  const setDaily = async (n: number): Promise<void> => {
    try {
      await invoke('vb:updateBook', { id: bookId, dailyNew: n })
      await refreshBooks()
    } catch (err) {
      toastError(err)
    }
  }
  const toStudy = d.remainingNewToday + d.dueNow
  const tile = (label: string, value: number | string, tone = '', sub?: string): ReactNode => (
    <div className="glass-inset rounded-xl px-4 py-3" aria-label={label}>
      <p className={cn('text-xs font-medium text-muted', tone)}>{label}</p>
      <p className="mt-0.5 text-2xl font-semibold tabular-nums">{value}</p>
      {sub && <p className="text-[11px] text-muted">{sub}</p>}
    </div>
  )
  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="glass-inset flex flex-wrap items-center gap-4 rounded-2xl px-5 py-4">
        <div className="min-w-0 flex-1">
          <p className="text-lg font-semibold">{toStudy ? `Today: ${d.remainingNewToday} new + ${d.dueNow} to revise` : 'Today’s target is done'}</p>
          <p className="text-xs text-muted">
            {d.nextSeq ? `Next new word: number ${d.nextSeq}. ` : 'All words have been introduced. '}Revisions come on Day 1, Day 4 and Day 7 after you learn a word, then further apart; words you forget come back
            sooner.
          </p>
        </div>
        <Button variant="primary" icon={<Play className="size-4" />} disabled={!toStudy || !modes.length} onClick={() => onStart('daily')}>
          Start today’s session
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {tile('New words learned today', d.newToday, 'text-accent', `target ${d.dailyNew}`)}
        {tile('Remaining for today', d.remainingNewToday, '', `${d.newLeft} new words left in the book`)}
        {tile('Revisions done today', d.reviewsToday)}
        {tile('Due for revision', d.dueNow, 'text-info')}
        {tile('Wrong answers today', d.mistakesToday, 'text-warn', `${d.mistakesTotal} in total`)}
        {tile('Mastered', d.mastered, 'text-info', `${d.learning} still learning`)}
        {tile('Words in the book', d.total)}
      </div>

      <section className="glass-inset space-y-3 rounded-2xl px-5 py-4">
        <div>
          <p className="text-sm font-semibold">New words per day</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5" role="group" aria-label="New words per day">
            {PRESETS.map((n) => (
              <button
                key={n}
                aria-pressed={book.dailyNew === n}
                onClick={() => void setDaily(n)}
                className={cn('motion-press h-8 min-w-10 rounded-lg border px-3 text-sm font-medium', book.dailyNew === n ? 'surface-selected' : 'border-line/60 hover:bg-white/[0.08]')}
              >
                {n}
              </button>
            ))}
            <form
              className="flex items-center gap-1"
              onSubmit={(e) => {
                e.preventDefault()
                const n = Number(custom)
                if (n > 0) void setDaily(n)
                setCustom('')
              }}
            >
              <Input value={custom} onChange={(e) => setCustom(e.target.value.replace(/\D/g, ''))} placeholder={PRESETS.includes(book.dailyNew) ? 'Own number' : `Own: ${book.dailyNew}`} className="h-8 w-28" aria-label="Own number of new words" />
              <Button size="sm" type="submit" disabled={!custom}>
                Set
              </Button>
            </form>
          </div>
        </div>
        <div>
          <p className="text-sm font-semibold">How to learn and review today (choose one or more)</p>
          <div className="mt-1.5 grid gap-1.5 sm:grid-cols-3" role="group" aria-label="Learning modes">
            {VB_MODES.map((m) => {
              const on = modes.includes(m.value)
              return (
                <button
                  key={m.value}
                  aria-pressed={on}
                  onClick={() => setModes(on ? modes.filter((x) => x !== m.value) : [...modes, m.value as VbMode])}
                  className={cn('motion-press rounded-xl border px-3 py-2 text-left', on ? 'surface-selected' : 'border-line/60 hover:bg-white/[0.08]')}
                >
                  <span className="block text-sm font-medium">{m.label}</span>
                  <span className="block text-[11px] text-muted">{m.hint}</span>
                </button>
              )
            })}
          </div>
          {!modes.length && <p className="mt-1 text-xs text-warn">Choose at least one way to learn.</p>}
        </div>
      </section>

      <section className="glass-inset space-y-2 rounded-2xl px-5 py-4">
        <div className="flex items-center gap-2">
          <p className="flex-1 text-sm font-semibold">Frequently repeated mistakes</p>
          <Button size="sm" icon={<RotateCcw className="size-3.5" />} disabled={!d.mistakesTotal || !modes.length} onClick={() => onStart('mistakes')}>
            Mistake Review
          </Button>
        </div>
        {d.frequent.length ? (
          <div className="flex flex-wrap gap-2">
            {d.frequent.map((f) => (
              <span key={f.id} className="flex items-center gap-1.5 rounded-lg border border-line/60 px-2 py-1 text-sm">
                <span className="text-xs text-muted">{f.seq}</span> {f.term} <MistakeBadge n={f.mistakes} />
              </span>
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted">Words you answer wrongly twice or more appear here.</p>
        )}
      </section>
    </div>
  )
}

function Sources({ bookId }: { bookId: number }): ReactNode {
  const [list, setList] = useState<VbSource[]>([])
  const [open, setOpen] = useState<number | null>(null)
  const [img, setImg] = useState<Record<number, string>>({})
  const version = useVb((s) => s.version)
  useEffect(() => {
    void invoke('vb:sources', bookId).then(setList)
  }, [bookId, version])
  if (!list.length) return <EmptyState title="No sources yet">Pictures, stories and passages you import are kept here as references.</EmptyState>
  return (
    <div className="mx-auto max-w-3xl space-y-2">
      {list.map((s) => (
        <div key={s.id} className="glass-inset rounded-xl px-4 py-3">
          <button
            className="flex w-full items-center gap-2 text-left"
            aria-expanded={open === s.id}
            onClick={() => {
              setOpen(open === s.id ? null : s.id)
              if (s.imageFile && !img[s.id]) void invoke('vb:sourceImage', s.imageFile).then((u) => setImg((m) => ({ ...m, [s.id]: u })))
            }}
          >
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{s.title || VB_SOURCE_KINDS.find((k) => k.value === s.kind)?.label}</span>
              <span className="block text-xs text-muted">
                {VB_SOURCE_KINDS.find((k) => k.value === s.kind)?.label} · {s.itemCount} word{s.itemCount === 1 ? '' : 's'} · {s.createdAt.slice(0, 10)}
                {s.pageRef ? ` · ${s.pageRef}` : ''}
                {s.extraction ? ` · ${s.extraction}` : ''}
              </span>
            </span>
          </button>
          {open === s.id && (
            <div className="mt-2 space-y-2">
              {s.imageFile && (img[s.id] ? <img src={img[s.id]} alt={s.title ?? 'Source picture'} className="max-h-96 rounded-lg" /> : <p className="text-xs text-muted">Loading picture…</p>)}
              {s.text && <p className="whitespace-pre-wrap text-sm leading-relaxed">{s.text}</p>}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

function Mistakes({ bookId, onReview }: { bookId: number; onReview: () => void }): ReactNode {
  const [list, setList] = useState<VbMistake[]>([])
  const version = useVb((s) => s.version)
  const modes = useVb((s) => s.modes)
  useEffect(() => {
    void invoke('vb:mistakes', { bookId }).then(setList)
  }, [bookId, version])
  return (
    <div className="mx-auto max-w-4xl space-y-3">
      <div className="flex items-center gap-2">
        <p className="flex-1 text-sm text-muted">Every wrong answer is kept (question, your answer, the correct answer, type, date) — also after you later answer correctly.</p>
        <Button variant="primary" icon={<RotateCcw className="size-4" />} disabled={!list.length || !modes.length} onClick={onReview}>
          Start Mistake Review
        </Button>
      </div>
      {list.length ? <MistakeTable mistakes={list} /> : <EmptyState title="No mistakes recorded">Wrong answers in your sessions are recorded here.</EmptyState>}
    </div>
  )
}
