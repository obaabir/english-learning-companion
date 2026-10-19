import { useEffect, useState, type ReactNode } from 'react'
import { AlarmClock, CalendarClock, CalendarDays, Layers, Play, RotateCcw, Sparkles, Sprout, Trophy } from 'lucide-react'
import type { Flashcard, RevisionDashboard as Dashboard } from '@shared/types'
import { invoke, on } from '@renderer/lib/api'
import { useApp } from '@renderer/stores/app'
import { Badge, Button, EmptyState, PanelHeader } from '@renderer/components/ui'
import { cn } from '@renderer/lib/cn'

type ListKey = 'dueToday' | 'overdue' | 'upcoming' | 'recent' | 'forgotten' | 'mastered'

const TILES: { key: ListKey; label: string; icon: ReactNode; tone: string; empty: string }[] = [
  { key: 'dueToday', label: 'Due today', icon: <CalendarDays className="size-4" />, tone: 'text-accent', empty: 'Nothing due today.' },
  { key: 'overdue', label: 'Overdue', icon: <AlarmClock className="size-4" />, tone: 'text-danger', empty: 'Nothing overdue. Well done!' },
  { key: 'upcoming', label: 'Upcoming (7 days)', icon: <CalendarClock className="size-4" />, tone: 'text-info', empty: 'Nothing scheduled for the next 7 days.' },
  { key: 'recent', label: 'Recently learned', icon: <Sprout className="size-4" />, tone: 'text-accent', empty: 'No cards made in the last 7 days.' },
  { key: 'forgotten', label: 'Frequently forgotten', icon: <RotateCcw className="size-4" />, tone: 'text-warn', empty: 'Nothing forgotten twice or more.' },
  { key: 'mastered', label: 'Mastered', icon: <Trophy className="size-4" />, tone: 'text-info', empty: 'Items reviewed with a gap of 3 weeks or more appear here.' }
]

const when = (iso: string): string => {
  const d = new Date(iso)
  const days = Math.round((new Date(d.toDateString()).getTime() - new Date(new Date().toDateString()).getTime()) / 86_400_000)
  if (days === 0) return d > new Date() ? `today ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'now'
  if (days === 1) return 'tomorrow'
  if (days === -1) return 'yesterday'
  return days > 0 ? `in ${days} days` : `${-days} days ago`
}

/** Revision dashboard: what to review today, what's coming, what you keep forgetting, what you've mastered. */
export function RevisionDashboard({ modeSwitch, onStart }: { modeSwitch: ReactNode; onStart: () => void }): ReactNode {
  const [data, setData] = useState<Dashboard | null>(null)
  const [open, setOpen] = useState<ListKey>('dueToday')
  const [notesWithoutCards, setNotesWithoutCards] = useState(0)
  const [generating, setGenerating] = useState(false)
  const { toast, toastError, refreshDue } = useApp.getState()

  const load = async (): Promise<void> => {
    try {
      const [d, s] = await Promise.all([invoke('revision:dashboard'), invoke('flashcards:stats')])
      setData(d)
      setNotesWithoutCards(s.notesWithoutCards)
      void refreshDue()
    } catch (err) {
      toastError(err)
    }
  }
  useEffect(() => {
    void load()
    // A word saved a moment ago (anywhere in the app) shows up here at once.
    return on('learning:changed', () => void load())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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

  const toReview = data ? data.counts.dueToday + data.counts.overdue : 0
  const list: Flashcard[] = data ? data[open] : []
  return (
    <div className="glass-panel flex h-full flex-col overflow-hidden">
      <PanelHeader title="Revision" icon={<Layers className="size-4" />}>
        {modeSwitch}
      </PanelHeader>
      {!data ? null : (
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          <div className="mx-auto max-w-4xl space-y-5">
            <div className="glass-inset flex flex-wrap items-center gap-4 rounded-2xl px-5 py-4">
              <div className="min-w-0 flex-1">
                <p className="text-lg font-semibold">{toReview ? `${toReview} card${toReview === 1 ? '' : 's'} to review` : 'All caught up for today'}</p>
                <p className="text-xs text-muted">Schedule: Day 1 → Day 3 → Day 7, then longer gaps. Your Again / Difficult / Good / Easy answers adjust it.</p>
              </div>
              <Button variant="primary" icon={<Play className="size-4" />} disabled={!toReview} onClick={onStart}>
                Start Revision
              </Button>
            </div>

            {notesWithoutCards > 0 && (
              <div className="glass-inset anim-fade-in flex items-center gap-3 rounded-xl px-4 py-3">
                <Sparkles className="size-5 shrink-0 text-accent" />
                <p className="flex-1 text-sm">
                  <b>{notesWithoutCards}</b> saved item{notesWithoutCards === 1 ? '' : 's'} (words, idioms, phrasal verbs, sentences, structures, grammar) don&apos;t have flashcards yet.
                </p>
                <Button size="sm" variant="primary" loading={generating} onClick={() => void generate()}>
                  Generate flashcards
                </Button>
              </div>
            )}

            <div className="grid grid-cols-2 gap-2 @container sm:grid-cols-3">
              {TILES.map((t) => (
                <button
                  key={t.key}
                  onClick={() => setOpen(t.key)}
                  aria-pressed={open === t.key}
                  className={cn(
                    'motion-press rounded-xl border px-4 py-3 text-left',
                    open === t.key ? 'surface-selected' : 'border-line/60 bg-white/[0.04] hover:bg-white/[0.08]'
                  )}
                >
                  <span className={cn('flex items-center gap-1.5 text-xs font-medium', t.tone)}>
                    {t.icon} {t.label}
                  </span>
                  <span className="mt-1 block text-2xl font-semibold tabular-nums">{data.counts[t.key]}</span>
                </button>
              ))}
            </div>

            <section>
              <h3 className="mb-2 text-sm font-semibold">{TILES.find((t) => t.key === open)!.label}</h3>
              {list.length === 0 ? (
                data.counts.total === 0 ? (
                  <EmptyState title="No flashcards yet">Save words, idioms and sentences, then generate flashcards.</EmptyState>
                ) : (
                  <p className="text-sm text-muted">{TILES.find((t) => t.key === open)!.empty}</p>
                )
              ) : (
                <div className="glass-inset divide-y divide-line/60 overflow-hidden rounded-xl">
                  {list.map((c) => (
                    <div key={c.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium">{c.front}</p>
                        <p className="truncate text-xs text-muted">{c.back.meaning_bn || c.back.meaning_en}</p>
                      </div>
                      {c.lapses > 0 && <Badge tone="warn">forgotten {c.lapses}×</Badge>}
                      {c.mastered && <Badge tone="info">mastered</Badge>}
                      <span className="shrink-0 text-xs text-muted tabular-nums">{open === 'recent' ? `added ${when(c.createdAt)}` : `review ${when(c.due)}`}</span>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        </div>
      )}
    </div>
  )
}
