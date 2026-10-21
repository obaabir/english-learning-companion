import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { CheckCircle2, Layers, List, Pencil, Sparkles, Trash2 } from 'lucide-react'
import { formatTimestamp, type Flashcard, type FlashcardStats, type ReviewRating } from '@shared/types'
import { invoke, on } from '@renderer/lib/api'
import { useApp } from '@renderer/stores/app'
import { Badge, Button, EmptyState, PanelHeader } from '@renderer/components/ui'
import { cn } from '@renderer/lib/cn'
import { FlashSentencePractice } from './fsp/FlashSentencePractice'
import { RevisionDashboard } from './RevisionDashboard'
import { useIntents } from '@renderer/stores/intents'
import { FlashcardEditor } from './FlashcardEditor'
import { useEscape } from '@renderer/lib/navigation'

const RATINGS: { rating: ReviewRating; label: string; key: string; className: string }[] = [
  { rating: 1, label: 'Again', key: '1', className: 'text-danger' },
  { rating: 2, label: 'Difficult', key: '2', className: 'text-warn' },
  { rating: 3, label: 'Good', key: '3', className: 'text-accent' },
  { rating: 4, label: 'Easy', key: '4', className: 'text-info' }
]

function FlashcardReview({ modeSwitch }: { modeSwitch: ReactNode }): ReactNode {
  const { toast, toastError, refreshDue } = useApp.getState()
  const [stats, setStats] = useState<FlashcardStats | null>(null)
  const [queue, setQueue] = useState<Flashcard[]>([])
  const [revealed, setRevealed] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [browse, setBrowse] = useState(false)
  const [all, setAll] = useState<Flashcard[]>([])
  const [reviewedCount, setReviewedCount] = useState(0)
  const [editing, setEditing] = useState(false)
  // A different card never opens in the editor by accident.
  useEffect(() => setEditing(false), [queue[0]?.id])

  const load = useCallback(async () => {
    try {
      const [s, due] = await Promise.all([invoke('flashcards:stats'), invoke('flashcards:due', 100)])
      setStats(s)
      setQueue(due)
      setRevealed(false)
      void refreshDue()
    } catch (err) {
      toastError(err)
    }
  }, [refreshDue, toastError])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (browse) void invoke('flashcards:list').then(setAll).catch(toastError)
  }, [browse, toastError, stats])

  // A word saved a moment ago (anywhere in the app): counts and the list update at once, and its new
  // card joins the end of this review (the card on screen stays).
  useEffect(
    () =>
      on('learning:changed', () => {
        void invoke('flashcards:stats').then(setStats).catch(() => undefined)
        void invoke('flashcards:due', 100)
          .then((due) => setQueue((q) => [...q, ...due.filter((d) => d.reps === 0 && !q.some((x) => x.id === d.id))]))
          .catch(() => undefined)
      }),
    []
  )

  const card = queue[0]

  const rate = useCallback(
    async (rating: ReviewRating) => {
      if (!card) return
      try {
        await invoke('flashcards:review', { id: card.id, rating })
        setReviewedCount((n) => n + 1)
        // "Again" cards come back in the same session once they are due.
        setQueue((q) => q.slice(1))
        setRevealed(false)
        if (queue.length <= 1) await load()
        else {
          setStats(await invoke('flashcards:stats'))
          void refreshDue()
        }
      } catch (err) {
        toastError(err)
      }
    },
    [card, queue.length, load, refreshDue, toastError]
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (browse || !card || editing || (e.target as HTMLElement).closest('input, textarea, select')) return
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault()
        setRevealed(true)
      } else if (revealed) {
        const r = RATINGS.find((x) => x.key === e.key)
        if (r) void rate(r.rating)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [browse, card, revealed, rate, editing])

  const generate = async (): Promise<void> => {
    setGenerating(true)
    try {
      const { created, skipped } = await invoke('flashcards:generate')
      toast('success', `Created ${created} flashcard${created === 1 ? '' : 's'}${skipped ? ` · ${skipped} sentence${skipped === 1 ? '' : 's'} still need a word or phrase to learn (choose it in Notes)` : ''}`)
      await load()
    } catch (err) {
      toastError(err)
    } finally {
      setGenerating(false)
    }
  }

  return (
    <div className="glass-panel flex h-full flex-col overflow-hidden">
      <PanelHeader title="Flashcards" icon={<Layers className="size-4" />}>
        {modeSwitch}
        {stats && (
          <>
            <Badge tone="accent">{stats.due} due</Badge>
            <Badge>{stats.total} total</Badge>
          </>
        )}
        <Button size="sm" variant={browse ? 'primary' : 'secondary'} icon={<List className="size-3.5" />} onClick={() => setBrowse(!browse)}>
          {browse ? 'Back to review' : 'Browse all'}
        </Button>
      </PanelHeader>

      {stats && stats.notesWithoutCards > 0 && (
        <div className="mx-auto mt-4 flex w-full max-w-2xl items-center gap-3 glass-inset anim-fade-in rounded-xl px-4 py-3">
          <Sparkles className="size-5 shrink-0 text-accent" />
          <p className="flex-1 text-sm">
            <b>{stats.notesWithoutCards}</b> saved note{stats.notesWithoutCards === 1 ? '' : 's'} don&apos;t have flashcards yet.
          </p>
          <Button variant="primary" size="sm" loading={generating} onClick={() => void generate()}>
            Generate flashcards
          </Button>
        </div>
      )}

      {browse ? (
        <BrowseList cards={all} onDeleted={() => void load()} />
      ) : card ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-5 p-6">
          <p className="text-xs text-muted">
            {queue.length} left in this session{reviewedCount ? ` · ${reviewedCount} reviewed` : ''}
          </p>
          <div
            key={card.id}
            className={cn('glass-elevated anim-fade-in relative w-full max-w-2xl rounded-2xl p-8', !editing && 'cursor-pointer')}
            onClick={() => !editing && setRevealed(true)}
          >
            {editing ? (
              <FlashcardEditor
                card={card}
                onCancel={() => setEditing(false)}
                onSaved={(updated) => {
                  setQueue((q) => [updated, ...q.slice(1)])
                  setEditing(false)
                  toast('success', 'Flashcard updated')
                }}
              />
            ) : (
              <>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                setEditing(true)
              }}
              className="motion-press absolute top-3 right-3 flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-muted hover:bg-white/55 hover:text-fg"
              aria-label="Edit this flashcard"
              title="Edit the English front (and meaning)"
            >
              <Pencil className="size-3.5" /> Edit
            </button>
            <p className="text-center text-2xl leading-snug font-semibold">{card.front}</p>
            {card.needsTarget && (
              <p className="mt-2 text-center text-xs text-warn">This old card shows a whole sentence: press Edit and type the word or phrase to learn.</p>
            )}
            {revealed ? (
              <div className="mt-6 space-y-3 border-t border-line pt-5 text-[15px]">
                {card.back.meaning_bn || card.back.meaning_en ? (
                  <Row label="Meaning">
                    <p>{card.back.meaning_bn}</p>
                    {card.back.meaning_en && <p className="text-sm text-muted">{card.back.meaning_en}</p>}
                  </Row>
                ) : (
                  <p className="text-sm text-muted">No meaning yet. This card was made without Gemini; add your API key to get meanings on new cards.</p>
                )}
                {card.back.example && (
                  <Row label="Example">
                    <p>{card.back.example}</p>
                    {card.back.example_bn && <p className="text-sm text-muted">{card.back.example_bn}</p>}
                  </Row>
                )}
                {card.back.note && (
                  <Row label="Tip">
                    <p className="text-sm">{card.back.note}</p>
                  </Row>
                )}
                <CardSource card={card} />
              </div>
            ) : (
              <p className="mt-6 text-center text-sm text-muted">Try to recall the meaning, then click or press Space</p>
            )}
              </>
            )}
          </div>
          {revealed ? (
            <div className="flex gap-2">
              {RATINGS.map((r) => (
                <Button key={r.rating} className={cn('min-w-24', r.className)} onClick={() => void rate(r.rating)}>
                  {r.label} <kbd className="ml-1 text-[10px] text-muted">{r.key}</kbd>
                </Button>
              ))}
            </div>
          ) : (
            <Button variant="primary" onClick={() => setRevealed(true)}>
              Show answer
            </Button>
          )}
        </div>
      ) : (
        <EmptyState icon={<CheckCircle2 className="size-12 text-accent" />} title={stats?.total ? 'All caught up!' : 'No flashcards yet'}>
          {stats?.total
            ? 'No cards are due right now. Come back later, or save more sentences while you watch.'
            : 'Save words and sentences in Movie Mode, then generate flashcards from your notes.'}
        </EmptyState>
      )}
    </div>
  )
}

/** The original context and source of the saved item, and its AI-generated examples, kept apart. */
function CardSource({ card }: { card: Flashcard }): ReactNode {
  const src = card.source
  if (!src) return null
  const more = src.examples.filter((e) => e.en !== card.back.example).slice(0, 2)
  // The sentence the word/phrase came from (for an item saved as a whole sentence, that sentence).
  const sentence = src.contextSentence ?? (src.kind === 'sentence' || src.kind === 'structure' ? (src.text ?? null) : null)
  return (
    <>
      {more.length > 0 && (
        <Row label="More">
          {more.map((e, i) => (
            <div key={i} className="mb-1">
              <p>{e.en}</p>
              {e.bn && <p className="text-sm text-muted">{e.bn}</p>}
            </div>
          ))}
          <Badge tone="warn">AI-generated examples</Badge>
        </Row>
      )}
      {src.grammar.length > 0 && (
        <Row label="Grammar">
          {src.grammar.slice(0, 2).map((g, i) => (
            <p key={i} className="text-sm">
              <b>{g.pattern}</b> — {g.explanation}
            </p>
          ))}
        </Row>
      )}
      {(sentence || src.mediaTitle || src.sourceUrl) && (
        <Row label="Source">
          {sentence && sentence !== card.front && <p className="italic">“{sentence}”</p>}
          {sentence && src.sentenceMeaningBn && sentence !== card.front && <p className="text-sm text-muted">{src.sentenceMeaningBn}</p>}
          <p className="text-xs text-muted">
            <Badge tone="info">Original</Badge> {src.mediaTitle}
            {src.timestampSec != null && <> · {formatTimestamp(src.timestampSec)}</>}
            {src.sourceUrl && (
              <>
                {' · '}
                <a href={src.sourceUrl} target="_blank" rel="noreferrer" className="text-info hover:underline">
                  {src.sourceUrl.replace(/^https?:\/\/(www\.)?/, '').slice(0, 50)}
                </a>
              </>
            )}
          </p>
        </Row>
      )}
    </>
  )
}

function Row({ label, children }: { label: string; children: ReactNode }): ReactNode {
  return (
    <div className="grid grid-cols-[80px_1fr] gap-3">
      <span className="pt-0.5 text-xs font-semibold tracking-wide text-muted uppercase">{label}</span>
      <div>{children}</div>
    </div>
  )
}

function BrowseList({ cards, onDeleted }: { cards: Flashcard[]; onDeleted: () => void }): ReactNode {
  const toastError = useApp((s) => s.toastError)
  const [editing, setEditing] = useState<Flashcard | null>(null)
  // Escape closes the edit dialog.
  useEscape(() => setEditing(null), editing !== null)
  if (!cards.length) return <EmptyState title="No flashcards yet" />
  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-6">
      <div className="mx-auto max-w-4xl glass-inset overflow-hidden rounded-xl">
        <table className="w-full text-sm">
          <thead className="bg-white/50 text-left text-xs text-muted">
            <tr>
              <th className="px-4 py-2 font-medium">Front</th>
              <th className="px-4 py-2 font-medium">Meaning</th>
              <th className="px-4 py-2 font-medium">Next review</th>
              <th className="w-10" />
            </tr>
          </thead>
          <tbody>
            {cards.map((c) => (
              <tr key={c.id} className="border-t border-line">
                <td className="px-4 py-2.5 font-medium">{c.front}</td>
                <td className="px-4 py-2.5 text-muted">{c.back.meaning_bn}</td>
                <td className="px-4 py-2.5 whitespace-nowrap text-muted tabular-nums">{new Date(c.due).toLocaleDateString()}</td>
                <td className="px-2 whitespace-nowrap">
                  <Button variant="ghost" size="sm" icon={<Pencil className="size-3.5" />} aria-label={`Edit flashcard ${c.front}`} title="Edit" onClick={() => setEditing(c)} />
                  <Button
                    variant="danger"
                    size="sm"
                    icon={<Trash2 className="size-3.5" />}
                    aria-label="Delete flashcard"
                    onClick={() => {
                      if (confirm('Delete this flashcard?')) void invoke('flashcards:delete', c.id).then(onDeleted).catch(toastError)
                    }}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setEditing(null)}>
          <div role="dialog" aria-label="Edit flashcard" className="glass-elevated anim-pop-in w-full max-w-xl rounded-2xl p-5" onClick={(e) => e.stopPropagation()}>
            <FlashcardEditor
              card={editing}
              onCancel={() => setEditing(null)}
              onSaved={() => {
                setEditing(null)
                useApp.getState().toast('success', 'Flashcard updated')
                onDeleted()
              }}
            />
          </div>
        </div>
      )}
    </div>
  )
}

/** Flashcards section: the revision dashboard, the card review, or Flash Sentence Practice. */
export function FlashcardsView(): ReactNode {
  const [mode, setMode] = useState<'dashboard' | 'review' | 'sentence'>(() => useIntents.getState().takeFlashcardsMode() ?? 'dashboard')
  // A voice command ("start revision") can switch the tab while the section is open.
  const requested = useIntents((s) => s.flashcardsMode)
  useEffect(() => {
    const m = requested && useIntents.getState().takeFlashcardsMode()
    if (m) setMode(m)
  }, [requested])
  const modeSwitch = (
    <div className="flex rounded-[10px] border border-line/80 bg-white/50 p-0.5" role="tablist" aria-label="Flashcard mode">
      {(['dashboard', 'review', 'sentence'] as const).map((m) => (
        <button
          key={m}
          role="tab"
          aria-selected={mode === m}
          onClick={() => setMode(m)}
          className={cn('motion-press h-6 rounded-[8px] px-2.5 text-xs font-medium', mode === m ? 'bg-accent text-accent-fg' : 'text-muted hover:text-fg')}
        >
          {m === 'dashboard' ? 'Revision' : m === 'review' ? 'Review' : 'Sentence Practice'}
        </button>
      ))}
    </div>
  )
  if (mode === 'dashboard') return <RevisionDashboard modeSwitch={modeSwitch} onStart={() => setMode('review')} />
  return mode === 'review' ? <FlashcardReview modeSwitch={modeSwitch} /> : <FlashSentencePractice modeSwitch={modeSwitch} />
}
