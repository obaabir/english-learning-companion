import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ArrowRight, CheckCircle2, Pencil, X, XCircle } from 'lucide-react'
import { blankSentence, buildTasks, pickDistractors, VB_MODES, type VbItem, type VbMode, type VbTask } from '@shared/vocabBook'
import { invoke } from '@renderer/lib/api'
import { useApp } from '@renderer/stores/app'
import { Badge, Button, Textarea } from '@renderer/components/ui'
import { cn } from '@renderer/lib/cn'
import { CardBack, ItemEditor, MistakeBadge } from './WordList'

const meaningOf = (i: VbItem): string => i.meaningBn || i.definitionEn

function shuffle<T>(a: T[]): T[] {
  const r = [...a]
  for (let i = r.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[r[i], r[j]] = [r[j], r[i]]
  }
  return r
}

interface Outcome {
  /** Per item of the task. */
  correct: Record<number, boolean>
  answer: Record<number, string>
  question: string
  correctAnswer: Record<number, string>
  errorType: string
  /** Sentence making: Gemini's check. */
  sentenceNote?: { corrected: string; explanation: string; available: boolean }
}

export interface SessionSummary {
  newLearned: number
  reviewed: number
  mistakes: number
}

/**
 * A study session: today's new words (in order) and the revisions due, or Mistake Review. Each task
 * uses one of your chosen modes; after the answer the meaning/usage is explained and you rate how
 * well you remembered. A wrong word comes back once more at the end for extra practice.
 */
export function Session({ bookId, kind, modes, onExit }: { bookId: number; kind: 'daily' | 'mistakes'; modes: VbMode[]; onExit: (s: SessionSummary | null) => void }): ReactNode {
  const toastError = useApp((s) => s.toastError)
  const [items, setItems] = useState<Map<number, VbItem>>(new Map())
  const [pool, setPool] = useState<VbItem[]>([])
  const [tasks, setTasks] = useState<VbTask[] | null>(null)
  const [index, setIndex] = useState(0)
  const [phase, setPhase] = useState<'learn' | 'ask' | 'feedback'>('ask')
  const [outcome, setOutcome] = useState<Outcome | null>(null)
  const [mistakeNo, setMistakeNo] = useState<Record<number, number>>({})
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const totals = useRef({ new: 0, review: 0, mistake: 0 })
  const [done, setDone] = useState({ new: 0, review: 0, mistake: 0, mistakes: 0 })

  useEffect(() => {
    void (async () => {
      try {
        if (kind === 'daily') {
          const s = await invoke('vb:session', bookId)
          const entries = [...s.newItems.map((item) => ({ item, kind: 'new' as const })), ...s.reviewItems.map((item) => ({ item, kind: 'review' as const }))]
          totals.current = { new: s.newItems.length, review: s.reviewItems.length, mistake: 0 }
          setPool(s.pool)
          setItems(new Map(s.pool.map((i) => [i.id, i])))
          setTasks(buildTasks(entries, modes, s.pool))
        } else {
          const [list, all] = await Promise.all([invoke('vb:mistakeReview', bookId), invoke('vb:items', bookId)])
          totals.current = { new: 0, review: 0, mistake: list.length }
          setPool(all)
          setItems(new Map(all.map((i) => [i.id, i])))
          setTasks(buildTasks(list.map((item) => ({ item, kind: 'mistake' as const })), modes, all))
        }
      } catch (err) {
        toastError(err)
        onExit(null)
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const task = tasks?.[index] ?? null
  useEffect(() => {
    if (!task) return
    setPhase(task.kind === 'new' ? 'learn' : 'ask')
    setOutcome(null)
    setEditing(false)
  }, [task])

  if (!tasks) return <p className="p-6 text-sm text-muted">Preparing your session…</p>
  if (!tasks.length)
    return (
      <div className="mx-auto max-w-lg space-y-3 p-6 text-center">
        <p className="text-lg font-semibold">{kind === 'daily' ? 'Nothing to study right now' : 'No mistakes to review'}</p>
        <p className="text-sm text-muted">{kind === 'daily' ? 'Today’s new words are done and no revision is due. Add more words or raise your daily number.' : 'Words you get wrong (or rate as hard) appear here.'}</p>
        <Button onClick={() => onExit(null)}>Back</Button>
      </div>
    )

  const finished = index >= tasks.length
  const bar = (label: string, d: number, t: number): ReactNode =>
    t > 0 ? (
      <div className="min-w-[140px] flex-1" aria-label={`${label} ${d} of ${t}`}>
        <div className="flex justify-between text-xs">
          <span className="font-medium">{label}</span>
          <span className="text-muted tabular-nums">
            {d}/{t}
          </span>
        </div>
        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/10">
          <div className="h-full rounded-full bg-accent transition-[width] duration-300" style={{ width: `${Math.round((d / t) * 100)}%` }} />
        </div>
      </div>
    ) : null

  const record = async (rating: 1 | 2 | 3 | 4): Promise<void> => {
    if (!task || !outcome) return
    setBusy(true)
    try {
      const wrongIds: number[] = []
      const fresh = new Map(items)
      let newMistakes = 0
      // Self-judged answers (flashcards, sentences without Gemini): "Again" means you didn't know it.
      const selfJudged = task.mode === 'flashcard' || (task.mode === 'sentence' && outcome.sentenceNote?.available === false)
      for (const id of task.itemIds) {
        const ok = selfJudged ? rating > 1 : outcome.correct[id]
        const r = await invoke('vb:answer', {
          itemId: id,
          kind: task.kind,
          mode: task.mode,
          correct: ok,
          rating: ok ? rating : (Math.min(rating, 2) as 1 | 2),
          question: outcome.question,
          answer: outcome.answer[id] ?? '',
          correctAnswer: outcome.correctAnswer[id] ?? '',
          errorType: outcome.errorType
        })
        fresh.set(id, r.item)
        if (!ok) {
          wrongIds.push(id)
          newMistakes++
        }
      }
      setItems(fresh)
      // Extra practice: a wrong word comes back once more (practice repeats don't move its schedule).
      if (wrongIds.length && task.kind !== 'retry') {
        const again = buildTasks(
          wrongIds.map((id) => ({ item: fresh.get(id)!, kind: 'retry' as const })),
          modes.filter((m) => m !== 'matching').length ? modes.filter((m) => m !== 'matching') : ['flashcard'],
          pool
        )
        setTasks((t) => [...(t ?? []), ...again])
      }
      if (task.kind !== 'retry') {
        const key = task.kind === 'new' ? 'new' : task.kind === 'review' ? 'review' : 'mistake'
        setDone((d) => ({ ...d, [key]: d[key] + task.itemIds.length, mistakes: d.mistakes + newMistakes }))
      } else setDone((d) => ({ ...d, mistakes: d.mistakes + newMistakes }))
      setIndex((i) => i + 1)
    } catch (err) {
      toastError(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4" aria-label="Study session">
      <div className="flex flex-wrap items-center gap-4">
        {bar('New words', done.new, totals.current.new)}
        {bar('Revision', done.review, totals.current.review)}
        {bar('Mistake review', done.mistake, totals.current.mistake)}
        <Button size="sm" variant="ghost" icon={<X className="size-4" />} onClick={() => onExit(finished ? null : { newLearned: done.new, reviewed: done.review + done.mistake, mistakes: done.mistakes })}>
          {finished ? 'Close' : 'Stop'}
        </Button>
      </div>

      {finished ? (
        <div className="glass-inset space-y-2 rounded-2xl p-6 text-center" role="status">
          <CheckCircle2 className="mx-auto size-10 text-[#52d6a0]" />
          <p className="text-lg font-semibold">Session complete</p>
          <p className="text-sm text-muted">
            {done.new} new word{done.new === 1 ? '' : 's'} learned · {done.review + done.mistake} revision{done.review + done.mistake === 1 ? '' : 's'} · {done.mistakes} mistake
            {done.mistakes === 1 ? '' : 's'} recorded
          </p>
          <Button variant="primary" onClick={() => onExit({ newLearned: done.new, reviewed: done.review + done.mistake, mistakes: done.mistakes })}>
            Done
          </Button>
        </div>
      ) : (
        task && (
          <TaskView
            key={index}
            task={task}
            items={items}
            pool={pool}
            phase={phase}
            outcome={outcome}
            busy={busy}
            mistakeNo={mistakeNo}
            editing={editing}
            setEditing={setEditing}
            onLearned={() => setPhase('ask')}
            onAnswered={(o) => {
              setOutcome(o)
              setPhase('feedback')
              // The mistake number this answer will get (shown straight away).
              const next: Record<number, number> = { ...mistakeNo }
              for (const id of task.itemIds) if (!o.correct[id]) next[id] = (items.get(id)?.mistakes ?? 0) + 1
              setMistakeNo(next)
            }}
            onRate={(r) => void record(r)}
            onEdited={(it) => setItems(new Map(items).set(it.id, it))}
          />
        )
      )}
    </div>
  )
}

function TaskView(props: {
  task: VbTask
  items: Map<number, VbItem>
  pool: VbItem[]
  phase: 'learn' | 'ask' | 'feedback'
  outcome: Outcome | null
  busy: boolean
  mistakeNo: Record<number, number>
  editing: boolean
  setEditing: (v: boolean) => void
  onLearned: () => void
  onAnswered: (o: Outcome) => void
  onRate: (r: 1 | 2 | 3 | 4) => void
  onEdited: (i: VbItem) => void
}): ReactNode {
  const { task, items, pool, phase, outcome } = props
  const first = items.get(task.itemIds[0])!
  const label = task.kind === 'new' ? 'New word' : task.kind === 'review' ? 'Revision' : task.kind === 'mistake' ? 'Mistake review' : 'Practice again'
  const allCorrect = outcome ? task.itemIds.every((id) => outcome.correct[id]) : false
  const selfJudged = task.mode === 'flashcard' || (task.mode === 'sentence' && outcome?.sentenceNote?.available === false)

  return (
    <div className="glass-elevated space-y-4 rounded-2xl p-5" data-task-mode={task.mode} data-task-kind={task.kind}>
      <div className="flex items-center gap-2 text-xs">
        <Badge tone={task.kind === 'new' ? 'accent' : task.kind === 'mistake' ? 'danger' : 'info'}>{label}</Badge>
        <span className="text-muted">{VB_MODES.find((m) => m.value === task.mode)?.label}</span>
        {task.itemIds.length === 1 && (
          <>
            <span className="text-muted">· word {first.seq}</span>
            <span className="ml-auto">
              <MistakeBadge n={first.mistakes} />
            </span>
          </>
        )}
      </div>

      {phase === 'learn' ? (
        <div className="space-y-3">
          <p className="text-3xl font-semibold">{first.term}</p>
          <CardBack item={first} />
          {!first.meaningBn && !first.definitionEn && <p className="text-xs text-warn">The meaning isn’t filled in yet. You can add it with “Edit” in Words & cards.</p>}
          <Button variant="primary" icon={<ArrowRight className="size-4" />} onClick={props.onLearned}>
            Got it — test me
          </Button>
        </div>
      ) : (
        <Question task={task} items={items} pool={pool} answered={phase === 'feedback'} outcome={outcome} onAnswered={props.onAnswered} />
      )}

      {phase === 'feedback' && outcome && (
        <div className="space-y-3 border-t border-line/60 pt-3" aria-label="Feedback">
          {selfJudged ? (
            <p className="font-semibold" role="status">
              {task.mode === 'flashcard' ? 'The answer:' : 'Compare with the example and judge it yourself:'}
            </p>
          ) : (
          <p className={cn('flex items-center gap-2 font-semibold', allCorrect ? 'text-[#52d6a0]' : 'text-danger')} role="status">
            {allCorrect ? <CheckCircle2 className="size-5" /> : <XCircle className="size-5" />}
            {allCorrect ? 'Correct!' : 'Not quite.'}
            {task.itemIds
              .filter((id) => !outcome.correct[id])
              .map((id) => (
                <span key={id} className="flex items-center gap-1 text-xs font-normal">
                  {task.itemIds.length > 1 && items.get(id)!.term} <MistakeBadge n={props.mistakeNo[id] ?? 0} />
                </span>
              ))}
          </p>
          )}
          {outcome.sentenceNote && (
            <div className="rounded-xl bg-white/[0.05] px-3 py-2 text-sm">
              {outcome.sentenceNote.available ? (
                <>
                  {outcome.sentenceNote.corrected && <p>Corrected: “{outcome.sentenceNote.corrected}”</p>}
                  {outcome.sentenceNote.explanation && <p className="whitespace-pre-wrap text-muted">{outcome.sentenceNote.explanation}</p>}
                </>
              ) : (
                <p className="text-muted">{outcome.sentenceNote.explanation}</p>
              )}
            </div>
          )}
          {/* The meaning / usage, explained after every answer. */}
          {task.itemIds.map((id) => {
            const it = items.get(id)!
            return (
              <div key={id} className="rounded-xl bg-white/[0.04] px-3 py-2">
                <div className="flex items-center gap-2">
                  <p className="text-lg font-semibold">{it.term}</p>
                  {task.itemIds.length === 1 && !props.editing && (
                    <Button size="sm" variant="ghost" icon={<Pencil className="size-3.5" />} aria-label="Edit this word" onClick={() => props.setEditing(true)} />
                  )}
                </div>
                {props.editing && task.itemIds.length === 1 ? (
                  <ItemEditor
                    item={it}
                    onCancel={() => props.setEditing(false)}
                    onSaved={(x) => {
                      props.onEdited(x)
                      props.setEditing(false)
                    }}
                  />
                ) : (
                  <CardBack item={it} />
                )}
              </div>
            )
          })}
          <div>
            <p className="mb-1.5 text-sm">How well did you remember {task.itemIds.length > 1 ? 'these words' : 'it'}?</p>
            <div className="flex flex-wrap gap-2" role="group" aria-label="Recall rating">
              {(
                [
                  [1, 'Again', 'Forgot — show it again soon'],
                  [2, 'Hard', 'Remembered with difficulty'],
                  [3, 'Good', 'Remembered'],
                  [4, 'Easy', 'Knew it at once']
                ] as const
              ).map(([r, l, hint]) => (
                <Button
                  key={r}
                  variant={(allCorrect ? r === 3 : r === 1) ? 'primary' : 'secondary'}
                  disabled={props.busy || (!allCorrect && task.itemIds.length === 1 && r > 2)}
                  title={hint}
                  onClick={() => props.onRate(r)}
                >
                  {l}
                </Button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function Question({
  task,
  items,
  pool,
  answered,
  outcome,
  onAnswered
}: {
  task: VbTask
  items: Map<number, VbItem>
  pool: VbItem[]
  answered: boolean
  outcome: Outcome | null
  onAnswered: (o: Outcome) => void
}): ReactNode {
  const item = items.get(task.itemIds[0])!
  const withMeaning = useMemo(() => pool.filter((p) => meaningOf(p)), [pool])
  // Options are fixed once per question.
  const options = useMemo(() => {
    if (task.mode === 'mcq') return shuffle([item, ...pickDistractors(item, withMeaning, 3, meaningOf, Date.now())])
    if (task.mode === 'recognition' || task.mode === 'context') return shuffle([item, ...pickDistractors(item, pool, 3, (p) => p.term, Date.now())])
    return []
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task])
  const [picked, setPicked] = useState<number | null>(null)
  const [shown, setShown] = useState(false)
  const [sentence, setSentence] = useState('')
  const [checking, setChecking] = useState(false)
  const toastError = useApp((s) => s.toastError)

  const single = (q: string, chosen: VbItem, correctText: string, chosenText: string, errorType: string): void =>
    onAnswered({
      question: q,
      correct: { [item.id]: chosen.id === item.id },
      answer: { [item.id]: chosenText },
      correctAnswer: { [item.id]: correctText },
      errorType
    })

  const choice = (q: string, label: (o: VbItem) => string, errorType: string): ReactNode => (
    <div className="space-y-3">
      <p className="text-lg">{q}</p>
      <div className="grid gap-2 sm:grid-cols-2">
        {options.map((o) => {
          const isRight = o.id === item.id
          return (
            <button
              key={o.id}
              disabled={answered}
              onClick={() => {
                setPicked(o.id)
                single(q, o, label(item), label(o), errorType)
              }}
              className={cn(
                'motion-press rounded-xl border px-4 py-3 text-left text-sm',
                answered && isRight ? 'border-[#52d6a0] bg-[#52d6a0]/15' : answered && picked === o.id ? 'border-danger bg-danger-soft' : 'border-line/60 hover:bg-white/[0.08]'
              )}
            >
              {label(o)}
            </button>
          )
        })}
      </div>
    </div>
  )

  switch (task.mode) {
    case 'mcq':
      return choice(`What does “${item.term}” mean?`, meaningOf, 'wrong_meaning')
    case 'recognition':
      return choice(`Which word means: “${meaningOf(item)}”?`, (o) => o.term, 'wrong_word')
    case 'context': {
      const s = blankSentence(item.context || item.example, item.term) ?? ''
      return choice(`Which word fits? “${s}”`, (o) => o.term, 'wrong_context')
    }
    case 'flashcard':
      return (
        <div className="space-y-3 text-center">
          <p className="py-6 text-4xl font-semibold" data-card-front>
            {item.term}
          </p>
          {!shown ? (
            <Button
              variant="primary"
              onClick={() => {
                setShown(true)
                // A flashcard is "correct" unless you rate it Again (decided when you rate).
                onAnswered({ question: `Flashcard: ${item.term}`, correct: { [item.id]: true }, answer: { [item.id]: '' }, correctAnswer: { [item.id]: meaningOf(item) }, errorType: 'forgot' })
              }}
            >
              Show answer
            </Button>
          ) : (
            <p className="text-xs text-muted">Rate “Again” if you didn’t remember it (it is recorded as a mistake).</p>
          )}
        </div>
      )
    case 'sentence':
      return (
        <div className="space-y-2">
          <p className="text-lg">
            Write your own sentence with <b>“{item.term}”</b>
            {item.meaningBn ? <span className="text-muted"> ({item.meaningBn})</span> : null}
          </p>
          <Textarea rows={3} value={sentence} onChange={(e) => setSentence(e.target.value)} disabled={answered} aria-label="Your sentence" placeholder="Your sentence…" />
          {!answered && (
            <Button
              variant="primary"
              loading={checking}
              disabled={sentence.trim().split(/\s+/).length < 3}
              onClick={async () => {
                setChecking(true)
                try {
                  const r = await invoke('vb:checkSentence', { itemId: item.id, sentence })
                  const q = `Make a sentence with “${item.term}”`
                  if (!r.available) {
                    // Without Gemini: you compare with the example and judge it yourself.
                    onAnswered({ question: q, correct: { [item.id]: true }, answer: { [item.id]: sentence }, correctAnswer: { [item.id]: item.example }, errorType: 'sentence_usage', sentenceNote: r })
                  } else {
                    onAnswered({
                      question: q,
                      correct: { [item.id]: r.correct },
                      answer: { [item.id]: sentence },
                      correctAnswer: { [item.id]: r.corrected || item.example },
                      errorType: 'sentence_usage',
                      sentenceNote: r
                    })
                  }
                } catch (err) {
                  toastError(err)
                } finally {
                  setChecking(false)
                }
              }}
            >
              Check my sentence
            </Button>
          )}
        </div>
      )
    case 'matching':
      return <Matching ids={task.itemIds} items={items} answered={answered} outcome={outcome} onAnswered={onAnswered} />
  }
}

/** Word–meaning matching: click a word, then its meaning. A wrong pair counts as a mistake for that word. */
function Matching({ ids, items, answered, outcome, onAnswered }: { ids: number[]; items: Map<number, VbItem>; answered: boolean; outcome: Outcome | null; onAnswered: (o: Outcome) => void }): ReactNode {
  const list = ids.map((id) => items.get(id)!)
  const right = useMemo(() => shuffle(list), [ids.join()]) // eslint-disable-line react-hooks/exhaustive-deps
  const [sel, setSel] = useState<number | null>(null)
  const [matched, setMatched] = useState<Set<number>>(new Set())
  const [wrong, setWrong] = useState<Record<number, string>>({})
  const [flash, setFlash] = useState<number | null>(null)
  const pick = (meaningOwner: VbItem): void => {
    if (sel === null || answered) return
    if (meaningOwner.id === sel) {
      const m = new Set(matched).add(sel)
      setMatched(m)
      setSel(null)
      if (m.size === list.length) {
        onAnswered({
          question: `Match: ${list.map((i) => i.term).join(', ')}`,
          correct: Object.fromEntries(list.map((i) => [i.id, !(i.id in wrong)])),
          answer: Object.fromEntries(list.map((i) => [i.id, wrong[i.id] ?? meaningOf(i)])),
          correctAnswer: Object.fromEntries(list.map((i) => [i.id, meaningOf(i)])),
          errorType: 'wrong_match'
        })
      }
    } else {
      // The first wrong pick for a word is what's recorded.
      if (!(sel in wrong)) setWrong({ ...wrong, [sel]: meaningOf(meaningOwner) })
      setFlash(meaningOwner.id)
      setTimeout(() => setFlash(null), 400)
    }
  }
  return (
    <div className="space-y-2">
      <p className="text-lg">Match each word with its meaning.</p>
      <div className="grid grid-cols-2 gap-2" aria-label="Matching">
        <div className="space-y-2">
          {list.map((i) => (
            <button
              key={i.id}
              disabled={matched.has(i.id) || answered}
              onClick={() => setSel(i.id)}
              className={cn(
                'motion-press w-full rounded-xl border px-3 py-2 text-left text-sm font-medium',
                matched.has(i.id) ? (wrong[i.id] || (outcome && !outcome.correct[i.id]) ? 'border-warn/60 bg-warn-soft' : 'border-[#52d6a0] bg-[#52d6a0]/15') : sel === i.id ? 'surface-selected' : 'border-line/60 hover:bg-white/[0.08]'
              )}
            >
              {i.term}
            </button>
          ))}
        </div>
        <div className="space-y-2">
          {right.map((i) => (
            <button
              key={i.id}
              disabled={matched.has(i.id) || answered}
              onClick={() => pick(i)}
              className={cn('motion-press w-full rounded-xl border px-3 py-2 text-left text-sm', matched.has(i.id) ? 'border-[#52d6a0] bg-[#52d6a0]/15' : flash === i.id ? 'border-danger bg-danger-soft' : 'border-line/60 hover:bg-white/[0.08]')}
            >
              {meaningOf(i)}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
