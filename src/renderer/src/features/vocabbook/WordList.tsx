import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Check, Pencil, RefreshCw, X } from 'lucide-react'
import { VB_ERROR_TYPES, VB_MODES, vbStatus, type VbItem, type VbMistake, type VbStatus } from '@shared/vocabBook'
import { invoke } from '@renderer/lib/api'
import { useApp } from '@renderer/stores/app'
import { Badge, Button, EmptyState, Input, Textarea } from '@renderer/components/ui'
import { cn } from '@renderer/lib/cn'
import { useVb } from './vbStore'

export const STATUS_LABEL: Record<VbStatus, { label: string; tone: 'neutral' | 'accent' | 'info' | 'warn' | 'danger' }> = {
  new: { label: 'New', tone: 'neutral' },
  learning: { label: 'Learning', tone: 'info' },
  due: { label: 'Due today', tone: 'accent' },
  struggling: { label: 'Struggling', tone: 'danger' },
  mastered: { label: 'Mastered', tone: 'info' }
}

/** "Mistake 2" beside an item. */
export function MistakeBadge({ n }: { n: number }): ReactNode {
  if (!n) return null
  return (
    <Badge tone={n >= 2 ? 'danger' : 'warn'} className="shrink-0">
      Mistake {n}
    </Badge>
  )
}

/** The words of a book in learning order (each one is also a card of this book's own deck). */
export function WordList({ bookId, items, onChanged }: { bookId: number; items: VbItem[]; onChanged: () => void }): ReactNode {
  const [filter, setFilter] = useState<VbStatus | 'all' | 'mistakes'>('all')
  const [q, setQ] = useState('')
  const [open, setOpen] = useState<number | null>(null)
  const hasKey = useApp((s) => !!s.settings?.hasGeminiKey)
  const shown = useMemo(
    () =>
      items.filter(
        (i) =>
          (filter === 'all' || (filter === 'mistakes' ? i.mistakes > 0 : vbStatus(i) === filter)) &&
          (!q.trim() || i.term.toLowerCase().includes(q.trim().toLowerCase()) || i.meaningBn.includes(q.trim()))
      ),
    [items, filter, q]
  )
  const failed = items.filter((i) => !i.enriched && i.enrichError)
  if (!items.length) return <EmptyState title="No words yet">Add words from a picture, a story, a passage or a list.</EmptyState>
  const current = items.find((i) => i.id === open) ?? null
  return (
    <div className="mx-auto max-w-5xl space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search words or meanings" className="h-8 w-56" aria-label="Search words" />
        {(['all', 'new', 'learning', 'due', 'struggling', 'mastered', 'mistakes'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            aria-pressed={filter === f}
            className={cn('motion-press rounded-lg border px-2.5 py-1 text-xs font-medium', filter === f ? 'surface-selected' : 'border-line/60 hover:bg-white/[0.08]')}
          >
            {f === 'all' ? `All ${items.length}` : f === 'mistakes' ? 'With mistakes' : STATUS_LABEL[f].label}
          </button>
        ))}
        {failed.length > 0 && (
          <Button size="sm" icon={<RefreshCw className="size-3.5" />} onClick={() => void invoke('vb:enrich', failed.map((i) => i.id)).then(onChanged)} title={failed[0].enrichError ?? ''}>
            Fill in {failed.length} missing meaning{failed.length === 1 ? '' : 's'} again
          </Button>
        )}
      </div>
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="glass-inset max-h-[calc(100vh-260px)] divide-y divide-line/50 overflow-y-auto rounded-xl" aria-label="Words in order">
          {shown.map((i) => {
            const st = vbStatus(i)
            return (
              <button key={i.id} onClick={() => setOpen(i.id)} className={cn('flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-white/[0.06]', open === i.id && 'bg-white/[0.08]')} data-word={i.term}>
                <span className="w-8 shrink-0 text-right text-xs text-muted tabular-nums">{i.seq}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{i.term}</span>
                  <span className="block truncate text-xs text-muted">{i.meaningBn || i.definitionEn || (i.enrichError ? 'meaning not filled in' : hasKey ? 'meaning coming…' : 'no meaning yet — add it with Edit')}</span>
                </span>
                <MistakeBadge n={i.mistakes} />
                <Badge tone={STATUS_LABEL[st].tone}>{STATUS_LABEL[st].label}</Badge>
              </button>
            )
          })}
          {!shown.length && <p className="px-3 py-3 text-sm text-muted">No words match.</p>}
        </div>
        {current ? <WordDetail key={current.id} bookId={bookId} item={current} onChanged={onChanged} /> : <p className="hidden p-4 text-sm text-muted lg:block">Choose a word to see its card, edit it, or see its mistakes.</p>}
      </div>
    </div>
  )
}

/** Card front + back of this book's deck. */
export function CardBack({ item }: { item: VbItem }): ReactNode {
  const row = (label: string, value: string | null | undefined): ReactNode =>
    value ? (
      <p>
        <span className="text-xs font-semibold tracking-wide text-muted uppercase">{label}: </span>
        {value}
      </p>
    ) : null
  return (
    <div className="space-y-1.5 text-sm">
      {row('Bangla', item.meaningBn)}
      {row('Meaning', item.definitionEn)}
      {row('Part of speech', item.pos)}
      {item.context && (
        <p>
          <span className="text-xs font-semibold tracking-wide text-muted uppercase">Original context: </span>
          <span className="italic">“{item.context}”</span>
        </p>
      )}
      {row('Example', item.example)}
      {row('Bangla translation', item.exampleBn)}
      {row('Synonyms', item.synonyms.join(', '))}
      {row('Collocations', item.collocations.join(', '))}
    </div>
  )
}

function WordDetail({ bookId, item, onChanged }: { bookId: number; item: VbItem; onChanged: () => void }): ReactNode {
  const [editing, setEditing] = useState(false)
  const [mistakes, setMistakes] = useState<VbMistake[]>([])
  const version = useVb((s) => s.version)
  useEffect(() => {
    void invoke('vb:mistakes', { bookId, itemId: item.id }).then(setMistakes)
  }, [bookId, item.id, item.mistakes, version])
  const st = vbStatus(item)
  return (
    <div className="glass-inset space-y-3 rounded-xl p-4" aria-label={`Word ${item.seq}`}>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-xs text-muted">
            Word {item.seq} · added {item.createdAt.slice(0, 10)}
            {item.pageRef ? ` · ${item.pageRef}` : ''}
          </p>
          <p className="text-2xl font-semibold" data-card-front>
            {item.term}
          </p>
          {item.originalTerm !== item.term && <p className="text-xs text-muted">Imported as “{item.originalTerm}”</p>}
        </div>
        <MistakeBadge n={item.mistakes} />
        <Badge tone={STATUS_LABEL[st].tone}>{STATUS_LABEL[st].label}</Badge>
        {!editing && <Button size="sm" variant="ghost" icon={<Pencil className="size-3.5" />} aria-label="Edit this word" onClick={() => setEditing(true)} />}
      </div>
      {editing ? (
        <ItemEditor
          item={item}
          onCancel={() => setEditing(false)}
          onSaved={() => {
            setEditing(false)
            onChanged()
          }}
        />
      ) : (
        <CardBack item={item} />
      )}
      <p className="text-xs text-muted">
        {item.introducedAt
          ? `Learned ${item.introducedAt.slice(0, 10)} · next review ${item.due ? new Date(item.due).toLocaleDateString() : '—'} · reviewed ${item.reps}×`
          : 'Not studied yet (new).'}
        {item.gdocSyncedAt ? ' · in Google Docs' : ''}
      </p>
      {mistakes.length > 0 && (
        <div>
          <p className="mb-1 text-xs font-semibold">Mistake history</p>
          <MistakeTable mistakes={mistakes} compact />
        </div>
      )}
    </div>
  )
}

export function MistakeTable({ mistakes, compact }: { mistakes: VbMistake[]; compact?: boolean }): ReactNode {
  return (
    <div className="divide-y divide-line/50 overflow-hidden rounded-lg border border-line/50 text-xs">
      {mistakes.map((m) => (
        <div key={m.id} className="space-y-0.5 px-3 py-2" data-mistake={m.number}>
          <p className="flex flex-wrap items-center gap-1.5">
            {!compact && <b className="text-sm">{m.term}</b>}
            <MistakeBadge n={m.number} />
            <span className="text-muted">
              {VB_ERROR_TYPES[m.errorType] ?? m.errorType} · {VB_MODES.find((x) => x.value === m.mode)?.label ?? m.mode} · {new Date(m.createdAt).toLocaleString()}
            </span>
            <span className={cn('ml-auto', m.correctedAt ? 'text-[#52d6a0]' : 'text-warn')}>{m.correctedAt ? 'answered correctly later' : 'not yet answered correctly'}</span>
          </p>
          <p className="text-muted">{m.question}</p>
          <p>
            Your answer: <span className="text-danger">{m.answer}</span> · Correct: <span className="text-[#52d6a0]">{m.correct}</span>
          </p>
        </div>
      ))}
    </div>
  )
}

/** Edit a word: the English word (card front), meanings, context, example, synonyms, collocations. Cancel changes nothing. */
export function ItemEditor({ item, onCancel, onSaved }: { item: VbItem; onCancel: () => void; onSaved: (item: VbItem) => void }): ReactNode {
  const toastError = useApp((s) => s.toastError)
  const [f, setF] = useState({
    term: item.term,
    meaningBn: item.meaningBn,
    definitionEn: item.definitionEn,
    pos: item.pos,
    context: item.context,
    example: item.example,
    exampleBn: item.exampleBn,
    synonyms: item.synonyms.join(', '),
    collocations: item.collocations.join(', ')
  })
  const [busy, setBusy] = useState(false)
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value })
  const save = async (): Promise<void> => {
    setBusy(true)
    try {
      const split = (s: string): string[] => s.split(',').map((x) => x.trim()).filter(Boolean)
      onSaved(await invoke('vb:editItem', { id: item.id, ...f, synonyms: split(f.synonyms), collocations: split(f.collocations) }))
    } catch (err) {
      toastError(err)
    } finally {
      setBusy(false)
    }
  }
  const field = (k: keyof typeof f, label: string, area = false): ReactNode => (
    <label className="block">
      <span className="text-xs text-muted">{label}</span>
      {area ? <Textarea rows={2} value={f[k]} onChange={set(k)} aria-label={label} className="mt-0.5 text-sm" /> : <Input value={f[k]} onChange={set(k)} aria-label={label} className="mt-0.5 h-8 text-sm" />}
    </label>
  )
  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault()
        void save()
      }}
      onKeyDown={(e) => e.key === 'Escape' && onCancel()}
    >
      {field('term', 'English word or phrase (the card front)')}
      <div className="grid gap-2 sm:grid-cols-2">
        {field('meaningBn', 'Bangla meaning')}
        {field('definitionEn', 'Simple English definition')}
        {field('pos', 'Part of speech')}
        {field('synonyms', 'Synonyms (comma separated)')}
      </div>
      {field('context', 'Original context', true)}
      <div className="grid gap-2 sm:grid-cols-2">
        {field('example', 'Example sentence', true)}
        {field('exampleBn', 'Bangla translation', true)}
      </div>
      {field('collocations', 'Collocations (comma separated)')}
      <p className="text-xs text-muted">The learning number ({item.seq}) and the source stay the same. An entry already in Google Docs is not changed.</p>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" icon={<X className="size-3.5" />} onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" loading={busy} disabled={!f.term.trim()} icon={<Check className="size-3.5" />}>
          Save
        </Button>
      </div>
    </form>
  )
}
