import { useMemo, useState, type ReactNode } from 'react'
import { ArrowLeft, ArrowRight, GripVertical, X } from 'lucide-react'
import type { Note } from '@shared/types'
import {
  buildMatching,
  buildOrdering,
  checkOrdering,
  checkText,
  shuffle,
  sourceSentences,
  type BlankTask,
  type ChoiceQuestion,
  type MatchPair
} from '@shared/games'
import { Button, Input } from '@renderer/components/ui'
import { cn } from '@renderer/lib/cn'
import { Feedback, NotEnough, NoteWhy, Origin, Progress } from './GameParts'

const byId = (notes: Note[], id: number): Note | undefined => notes.find((n) => n.id === id)

// ---- 1. Vocabulary matching
export function VocabMatch({ notes }: { notes: Note[] }): ReactNode {
  const [round, setRound] = useState(0)
  const pairs = useMemo(() => buildMatching(notes, 5), [notes, round])
  if (pairs.length < 3) return <NotEnough>Save at least 3 words or idioms with meanings (the meaning is added automatically when Gemini is set up).</NotEnough>
  return <MatchBoard key={round} pairs={pairs} notes={notes} onNext={() => setRound((r) => r + 1)} />
}

function MatchBoard({ pairs, notes, onNext }: { pairs: MatchPair[]; notes: Note[]; onNext: () => void }): ReactNode {
  const [attempt, setAttempt] = useState(0)
  const right = useMemo(() => shuffle(pairs), [pairs, attempt])
  const [picked, setPicked] = useState<number | null>(null)
  const [matched, setMatched] = useState<number[]>([])
  const [wrong, setWrong] = useState<{ left: number; right: number } | null>(null)
  const [mistakes, setMistakes] = useState<{ word: string; chose: string }[]>([])
  const done = matched.length === pairs.length

  const choose = (rightId: number): void => {
    if (picked == null || matched.includes(rightId)) return
    if (picked === rightId) {
      setMatched((m) => [...m, rightId])
      setWrong(null)
    } else {
      setWrong({ left: picked, right: rightId })
      setMistakes((m) => [...m, { word: pairs.find((p) => p.id === picked)!.left, chose: pairs.find((p) => p.id === rightId)!.right }])
    }
    setPicked(null)
  }
  const retry = (): void => {
    setAttempt((a) => a + 1)
    setMatched([])
    setMistakes([])
    setWrong(null)
  }

  return (
    <div>
      <p className="mb-3 text-sm text-muted">Click a word, then its Bangla meaning. Correct matches turn green.</p>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          {pairs.map((p) => (
            <button
              key={p.id}
              disabled={matched.includes(p.id)}
              onClick={() => setPicked(p.id)}
              aria-pressed={picked === p.id}
              className={cn(
                'motion-press block w-full rounded-xl border px-3 py-2.5 text-left text-sm font-medium',
                matched.includes(p.id) ? 'border-[#52d6a0]/60 bg-[#52d6a0]/15 text-[#52d6a0]' : wrong?.left === p.id ? 'border-danger/60 bg-danger-soft' : picked === p.id ? 'surface-selected' : 'border-line/60 hover:bg-white/[0.08]'
              )}
            >
              {p.left}
            </button>
          ))}
        </div>
        <div className="space-y-2">
          {right.map((p) => (
            <button
              key={p.id}
              disabled={matched.includes(p.id) || picked == null}
              onClick={() => choose(p.id)}
              className={cn(
                'motion-press block w-full rounded-xl border px-3 py-2.5 text-left text-sm',
                matched.includes(p.id) ? 'border-[#52d6a0]/60 bg-[#52d6a0]/15 text-[#52d6a0]' : wrong?.right === p.id ? 'border-danger/60 bg-danger-soft' : 'border-line/60 hover:bg-white/[0.08] disabled:opacity-70'
              )}
            >
              {p.right}
            </button>
          ))}
        </div>
      </div>
      {wrong && !done && <p className="mt-2 text-sm text-danger">Not a match — try another meaning.</p>}
      {done && (
        <Feedback correct={mistakes.length === 0} title={mistakes.length ? `All matched, with ${mistakes.length} mistake${mistakes.length === 1 ? '' : 's'}` : 'All correct!'} onRetry={retry} onNext={onNext} nextLabel="New words">
          {mistakes.map((m, i) => (
            <p key={i} className="text-danger">
              ✗ “{m.word}” is not “{m.chose}”
            </p>
          ))}
          {pairs.map((p) => (
            <NoteWhy key={p.id} note={byId(notes, p.id)} />
          ))}
        </Feedback>
      )}
    </div>
  )
}

// ---- 2 / 7 / 10. Multiple choice
export function ChoiceGame({ build, notes, emptyText }: { build: () => ChoiceQuestion[]; notes: Note[]; emptyText: string }): ReactNode {
  const [round, setRound] = useState(0)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const questions = useMemo(build, [round])
  const [index, setIndex] = useState(0)
  const [chosen, setChosen] = useState<number | null>(null)
  const [submitted, setSubmitted] = useState(false)
  if (!questions.length) return <NotEnough>{emptyText}</NotEnough>
  const q = questions[index]
  const note = byId(notes, q.noteId)
  const right = submitted && chosen === q.answer
  const next = (): void => {
    setChosen(null)
    setSubmitted(false)
    if (index + 1 < questions.length) setIndex(index + 1)
    else {
      setIndex(0)
      setRound((r) => r + 1)
    }
  }
  return (
    <div>
      <Progress index={index} total={questions.length} />
      <p className="text-base font-medium">{q.prompt}</p>
      {q.sentence && (
        <div className="mt-2">
          <p className="glass-inset rounded-xl px-4 py-3 text-[15px]">
            <Highlight text={q.sentence} word={q.highlight} />
          </p>
          <div className="mt-1">
            <Origin source={note?.mediaTitle} />
          </div>
        </div>
      )}
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {q.options.map((o, i) => (
          <button
            key={i}
            disabled={submitted}
            onClick={() => setChosen(i)}
            aria-pressed={chosen === i}
            className={cn(
              'motion-press rounded-xl border px-3 py-2.5 text-left text-sm',
              submitted && i === q.answer ? 'border-[#52d6a0]/70 bg-[#52d6a0]/15 text-[#52d6a0]' : submitted && i === chosen ? 'border-danger/60 bg-danger-soft text-danger' : chosen === i ? 'surface-selected' : 'border-line/60 hover:bg-white/[0.08]'
            )}
          >
            {o}
          </button>
        ))}
      </div>
      {!submitted ? (
        <Button className="mt-3" variant="primary" disabled={chosen == null} onClick={() => setSubmitted(true)}>
          Submit
        </Button>
      ) : (
        <Feedback
          correct={right}
          onRetry={right ? undefined : () => (setChosen(null), setSubmitted(false))}
          onNext={next}
        >
          {!right && (
            <p>
              The answer is <b className="text-[#52d6a0]">{q.options[q.answer]}</b>.
            </p>
          )}
          <NoteWhy note={note} />
        </Feedback>
      )}
    </div>
  )
}

function Highlight({ text, word }: { text: string; word: string | null }): ReactNode {
  if (!word) return text
  const i = text.toLowerCase().indexOf(word.toLowerCase())
  if (i < 0) return text
  return (
    <>
      {text.slice(0, i)}
      <mark className="rounded bg-accent-soft px-1 text-accent">{text.slice(i, i + word.length)}</mark>
      {text.slice(i + word.length)}
    </>
  )
}

// ---- 3. Sentence ordering (drag and drop, or click / keyboard)
export function OrderingGame({ notes }: { notes: Note[] }): ReactNode {
  const sentences = useMemo(() => shuffle(sourceSentences(notes)).slice(0, 8), [notes])
  const [index, setIndex] = useState(0)
  if (!sentences.length) return <NotEnough>Save a few sentences (4–22 words) — from movies, YouTube or articles — to play.</NotEnough>
  return <OrderingTask key={index} source={sentences[index % sentences.length]} notes={notes} index={index % sentences.length} total={sentences.length} onNext={() => setIndex((i) => i + 1)} />
}

function OrderingTask({ source, notes, index, total, onNext }: { source: ReturnType<typeof sourceSentences>[number]; notes: Note[]; index: number; total: number; onNext: () => void }): ReactNode {
  const task = useMemo(() => buildOrdering(source), [source])
  const [answer, setAnswer] = useState<{ id: number; word: string }[]>([])
  const [result, setResult] = useState<ReturnType<typeof checkOrdering> | null>(null)
  const [drag, setDrag] = useState<number | null>(null)
  const pool = task.tiles.filter((t) => !answer.some((a) => a.id === t.id))

  const put = (tile: { id: number; word: string }, at?: number): void => {
    setResult(null)
    setAnswer((a) => {
      const rest = a.filter((x) => x.id !== tile.id)
      const i = at == null ? rest.length : Math.min(at, rest.length)
      return [...rest.slice(0, i), tile, ...rest.slice(i)]
    })
  }
  const remove = (id: number): void => {
    setResult(null)
    setAnswer((a) => a.filter((x) => x.id !== id))
  }
  const move = (i: number, d: -1 | 1): void => {
    const j = i + d
    if (j < 0 || j >= answer.length) return
    setResult(null)
    setAnswer((a) => {
      const b = [...a]
      ;[b[i], b[j]] = [b[j], b[i]]
      return b
    })
  }
  const note = byId(notes, source.noteId)

  return (
    <div>
      <Progress index={index} total={total} />
      <p className="mb-2 text-sm text-muted">
        Drag the words into order — or click a word to add it, and use the arrows (or ← → keys) to move it. <Origin source={source.source} />
      </p>
      <div
        aria-label="Your sentence"
        onDragOver={(e) => e.preventDefault()}
        onDrop={() => {
          const t = task.tiles.find((x) => x.id === drag)
          if (t) put(t)
          setDrag(null)
        }}
        className="glass-inset flex min-h-16 flex-wrap items-center gap-2 rounded-xl p-3"
      >
        {answer.length === 0 && <span className="text-sm text-muted">Your sentence appears here</span>}
        {answer.map((t, i) => (
          <span
            key={t.id}
            draggable
            tabIndex={0}
            onDragStart={() => setDrag(t.id)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.stopPropagation()
              const tile = task.tiles.find((x) => x.id === drag)
              if (tile) put(tile, i)
              setDrag(null)
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowLeft') move(i, -1)
              if (e.key === 'ArrowRight') move(i, 1)
              if (e.key === 'Delete' || e.key === 'Backspace') remove(t.id)
            }}
            aria-label={`${t.word}, position ${i + 1}`}
            className={cn(
              'inline-flex cursor-grab items-center gap-1 rounded-lg border px-2 py-1.5 text-sm font-medium',
              result ? (result.parts[i] ? 'border-[#52d6a0]/70 bg-[#52d6a0]/15 text-[#52d6a0]' : 'border-danger/60 bg-danger-soft text-danger') : 'border-line/70 bg-white/[0.06]'
            )}
          >
            <GripVertical className="size-3 opacity-50" />
            {t.word}
            <button onClick={() => move(i, -1)} aria-label={`Move ${t.word} left`} className="opacity-60 hover:opacity-100">
              <ArrowLeft className="size-3" />
            </button>
            <button onClick={() => move(i, 1)} aria-label={`Move ${t.word} right`} className="opacity-60 hover:opacity-100">
              <ArrowRight className="size-3" />
            </button>
            <button onClick={() => remove(t.id)} aria-label={`Remove ${t.word}`} className="opacity-60 hover:opacity-100">
              <X className="size-3" />
            </button>
          </span>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-2" aria-label="Words to use">
        {pool.map((t) => (
          <button
            key={t.id}
            draggable
            onDragStart={() => setDrag(t.id)}
            onClick={() => put(t)}
            className="motion-press rounded-lg border border-line/70 px-2.5 py-1.5 text-sm hover:bg-white/[0.08]"
          >
            {t.word}
          </button>
        ))}
      </div>
      {!result ? (
        <Button className="mt-3" variant="primary" disabled={pool.length > 0} onClick={() => setResult(checkOrdering(answer.map((a) => a.word), task.correct))}>
          Submit
        </Button>
      ) : (
        <Feedback correct={result.correct} onRetry={result.correct ? undefined : () => setResult(null)} onNext={onNext}>
          {!result.correct && (
            <p>
              Green words are in the right place; red ones are not. Correct order: <b className="text-[#52d6a0]">{task.correct.join(' ')}</b>
            </p>
          )}
          {/* A sentence saved for one of its words is explained through that word. */}
          {note && note.text !== source.text && <p className="text-muted">This sentence has your saved {note.kind === 'word' ? 'word' : 'item'}:</p>}
          <NoteWhy note={note} label={note && note.text !== source.text ? note.text : 'This sentence'} />
        </Feedback>
      )}
    </div>
  )
}

// ---- 4 / 6. Fill in the blanks, idiom completion
export function BlankGame({ build, notes, emptyText }: { build: () => BlankTask[]; notes: Note[]; emptyText: string }): ReactNode {
  const [round, setRound] = useState(0)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const tasks = useMemo(build, [round])
  const [index, setIndex] = useState(0)
  const [value, setValue] = useState('')
  const [submitted, setSubmitted] = useState(false)
  if (!tasks.length) return <NotEnough>{emptyText}</NotEnough>
  const t = tasks[index]
  const note = byId(notes, t.noteId)
  const right = submitted && checkText(value, t.answer)
  const next = (): void => {
    setValue('')
    setSubmitted(false)
    if (index + 1 < tasks.length) setIndex(index + 1)
    else {
      setIndex(0)
      setRound((r) => r + 1)
    }
  }
  return (
    <div>
      <Progress index={index} total={tasks.length} />
      <p className="glass-inset rounded-xl px-4 py-3 text-[17px] leading-relaxed">
        {t.before}
        <span className={cn('mx-0.5 inline-block min-w-16 border-b-2 px-1 text-center font-semibold', submitted ? (right ? 'border-[#52d6a0] text-[#52d6a0]' : 'border-danger text-danger') : 'border-accent')}>
          {value || ' '}
        </span>
        {t.after}
      </p>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        {t.sentenceIsOriginal ? <Origin source={note?.mediaTitle} /> : <span className="text-xs text-muted">Your saved item</span>}
        {t.hint && <span className="text-xs text-muted">Hint: {t.hint}</span>}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {t.options.map((o) => (
          <button key={o} disabled={submitted} onClick={() => setValue(o)} className={cn('motion-press rounded-lg border px-3 py-1.5 text-sm', value === o ? 'surface-selected' : 'border-line/70 hover:bg-white/[0.08]')}>
            {o}
          </button>
        ))}
      </div>
      <div className="mt-2 flex max-w-sm gap-2">
        <Input value={value} disabled={submitted} onChange={(e) => setValue(e.target.value)} placeholder="…or type it" aria-label="Answer" onKeyDown={(e) => e.key === 'Enter' && value.trim() && setSubmitted(true)} />
        {!submitted && (
          <Button variant="primary" disabled={!value.trim()} onClick={() => setSubmitted(true)}>
            Submit
          </Button>
        )}
      </div>
      {submitted && (
        <Feedback correct={right} onRetry={right ? undefined : () => (setValue(''), setSubmitted(false))} onNext={next}>
          {!right && (
            <p>
              You wrote <b className="text-danger">“{value}”</b>; the missing part is <b className="text-[#52d6a0]">“{t.answer}”</b>.
            </p>
          )}
          <NoteWhy note={note} />
        </Feedback>
      )}
    </div>
  )
}
