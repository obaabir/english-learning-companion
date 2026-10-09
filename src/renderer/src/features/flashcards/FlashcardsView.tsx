import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { CheckCircle2, Layers, List, Sparkles, Trash2 } from 'lucide-react'
import type { Flashcard, FlashcardStats, ReviewRating } from '@shared/types'
import { invoke } from '@renderer/lib/api'
import { useApp } from '@renderer/stores/app'
import { Badge, Button, EmptyState, PanelHeader } from '@renderer/components/ui'
import { cn } from '@renderer/lib/cn'

const RATINGS: { rating: ReviewRating; label: string; key: string; className: string }[] = [
  { rating: 1, label: 'Again', key: '1', className: 'text-danger' },
  { rating: 2, label: 'Hard', key: '2', className: 'text-warn' },
  { rating: 3, label: 'Good', key: '3', className: 'text-accent' },
  { rating: 4, label: 'Easy', key: '4', className: 'text-info' }
]

export function FlashcardsView(): ReactNode {
  const { toast, toastError, refreshDue } = useApp.getState()
  const [stats, setStats] = useState<FlashcardStats | null>(null)
  const [queue, setQueue] = useState<Flashcard[]>([])
  const [revealed, setRevealed] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [browse, setBrowse] = useState(false)
  const [all, setAll] = useState<Flashcard[]>([])
  const [reviewedCount, setReviewedCount] = useState(0)

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
      if (browse || !card || (e.target as HTMLElement).closest('input, textarea, select')) return
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
  }, [browse, card, revealed, rate])

  const generate = async (): Promise<void> => {
    setGenerating(true)
    try {
      const { created } = await invoke('flashcards:generate')
      toast('success', `Created ${created} flashcard${created === 1 ? '' : 's'}`)
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
            className="glass-elevated anim-fade-in w-full max-w-2xl cursor-pointer rounded-2xl p-8"
            onClick={() => setRevealed(true)}
          >
            <p className="text-center text-2xl leading-snug font-semibold">{card.front}</p>
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
              </div>
            ) : (
              <p className="mt-6 text-center text-sm text-muted">Try to recall the meaning, then click or press Space</p>
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
                <td className="px-2">
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
    </div>
  )
}
