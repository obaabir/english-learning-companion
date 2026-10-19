import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Loader2 } from 'lucide-react'
import type { Note, PracticeItem } from '@shared/types'
import type { FspCardType, FspCheckResult } from '@shared/fsp'
import { diffWords, shuffle, sourceSentences, writingTargets, type SourceSentence } from '@shared/games'
import { NOTE_KINDS } from '@shared/types'
import { invoke } from '@renderer/lib/api'
import { useApp } from '@renderer/stores/app'
import { Badge, Button, Select, Textarea } from '@renderer/components/ui'
import { cn } from '@renderer/lib/cn'
import { Feedback, NotEnough, NoteWhy, Origin, Progress } from './GameParts'

/** Loads AI practice items (wrong versions) for a few of the learner's saved sentences. */
function usePractice(mode: 'choose' | 'error', notes: Note[], round: number): { items: (PracticeItem & { source: SourceSentence })[]; loading: boolean; error: string | null } {
  const hasKey = useApp((s) => !!s.settings?.hasGeminiKey)
  const [state, setState] = useState<{ items: (PracticeItem & { source: SourceSentence })[]; loading: boolean; error: string | null }>({ items: [], loading: true, error: null })
  useEffect(() => {
    const picked = shuffle(sourceSentences(notes)).slice(0, 5)
    if (!hasKey) return setState({ items: [], loading: false, error: 'Add your Gemini API key in Settings — this game asks Gemini to make practice sentences from your notes.' })
    if (!picked.length) return setState({ items: [], loading: false, error: null })
    setState({ items: [], loading: true, error: null })
    let alive = true
    invoke('games:practice', { mode, sentences: picked.map((p, i) => ({ id: i, text: p.text })) })
      .then((items) => alive && setState({ items: items.map((it) => ({ ...it, source: picked[it.id] })), loading: false, error: null }))
      .catch((err) => alive && setState({ items: [], loading: false, error: err instanceof Error ? err.message : String(err) }))
    return () => {
      alive = false
    }
  }, [mode, notes, round, hasKey])
  return state
}

function Loading(): ReactNode {
  return (
    <p className="flex items-center gap-2 text-sm text-muted">
      <Loader2 className="size-4 animate-spin" /> Making practice sentences from your notes…
    </p>
  )
}

// ---- 5. Choose the correct sentence
export function ChooseGame({ notes }: { notes: Note[] }): ReactNode {
  const [round, setRound] = useState(0)
  const { items, loading, error } = usePractice('choose', notes, round)
  const [index, setIndex] = useState(0)
  const [chosen, setChosen] = useState<number | null>(null)
  const [submitted, setSubmitted] = useState(false)
  const item = items[index]
  const options = useMemo(() => (item ? shuffle([{ text: item.source.text, ai: false }, ...item.wrong.map((w) => ({ text: w, ai: true }))]) : []), [item])
  if (loading) return <Loading />
  if (error) return <NotEnough>{error}</NotEnough>
  if (!item) return <NotEnough>Save a few sentences (4–22 words) from movies, YouTube or articles to play.</NotEnough>
  const right = submitted && chosen != null && !options[chosen].ai
  const next = (): void => {
    setChosen(null)
    setSubmitted(false)
    if (index + 1 < items.length) setIndex(index + 1)
    else {
      setIndex(0)
      setRound((r) => r + 1)
    }
  }
  return (
    <div>
      <Progress index={index} total={items.length} />
      <p className="mb-3 text-base font-medium">Which sentence is correct?</p>
      <div className="space-y-2">
        {options.map((o, i) => (
          <button
            key={i}
            disabled={submitted}
            onClick={() => setChosen(i)}
            className={cn(
              'motion-press block w-full rounded-xl border px-4 py-2.5 text-left text-[15px]',
              submitted && !o.ai ? 'border-[#52d6a0]/70 bg-[#52d6a0]/15' : submitted && i === chosen ? 'border-danger/60 bg-danger-soft' : chosen === i ? 'surface-selected' : 'border-line/60 hover:bg-white/[0.08]'
            )}
          >
            {o.text}
            {submitted && (
              <span className="ml-2 align-middle">
                <Origin ai={o.ai} source={o.ai ? null : item.source.source} />
              </span>
            )}
          </button>
        ))}
      </div>
      {!submitted ? (
        <Button className="mt-3" variant="primary" disabled={chosen == null} onClick={() => setSubmitted(true)}>
          Submit
        </Button>
      ) : (
        <Feedback correct={right} onRetry={right ? undefined : () => (setChosen(null), setSubmitted(false))} onNext={next}>
          <p>{item.why}</p>
          {item.structure && (
            <p>
              <b>Structure:</b> {item.structure}
            </p>
          )}
          {item.errors.length > 0 && (
            <div>
              <p className="text-xs font-semibold tracking-wide text-muted uppercase">Mistakes in the wrong sentences</p>
              {item.errors.map((e, i) => (
                <p key={i}>
                  <span className="text-danger line-through">{e.wrong}</span> → <span className="text-[#52d6a0]">{e.right}</span> <span className="text-muted">({e.why})</span>
                </p>
              ))}
            </div>
          )}
        </Feedback>
      )}
    </div>
  )
}

// ---- 8. Error correction
export function ErrorGame({ notes }: { notes: Note[] }): ReactNode {
  const [round, setRound] = useState(0)
  const { items, loading, error } = usePractice('error', notes, round)
  const [index, setIndex] = useState(0)
  const [value, setValue] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const item = items[index]
  useEffect(() => setValue(item?.wrong[0] ?? ''), [item])
  if (loading) return <Loading />
  if (error) return <NotEnough>{error}</NotEnough>
  if (!item) return <NotEnough>Save a few sentences (4–22 words) from movies, YouTube or articles to play.</NotEnough>
  const diff = diffWords(value, item.source.text)
  const next = (): void => {
    setSubmitted(false)
    if (index + 1 < items.length) setIndex(index + 1)
    else {
      setIndex(0)
      setRound((r) => r + 1)
    }
  }
  return (
    <div>
      <Progress index={index} total={items.length} />
      <p className="mb-1 text-base font-medium">This sentence has mistakes. Correct it.</p>
      <p className="glass-inset rounded-xl px-4 py-3 text-[15px]">{item.wrong[0]}</p>
      <div className="mt-1">
        <Origin ai />
      </div>
      <Textarea className="mt-3" rows={2} value={value} disabled={submitted} onChange={(e) => setValue(e.target.value)} aria-label="Your corrected sentence" />
      {!submitted ? (
        <Button className="mt-2" variant="primary" disabled={!value.trim()} onClick={() => setSubmitted(true)}>
          Submit
        </Button>
      ) : (
        <Feedback correct={diff.correct} onRetry={diff.correct ? undefined : () => setSubmitted(false)} onNext={next}>
          <p className="leading-relaxed">
            Your sentence:{' '}
            {diff.words.map((w, i) => (
              <span key={i} className={cn('mr-1 rounded px-0.5', w.ok ? 'text-[#52d6a0]' : 'bg-danger-soft text-danger')}>
                {w.word}
              </span>
            ))}
          </p>
          {!diff.correct && diff.missing.length > 0 && <p>Missing or different: {diff.missing.map((m) => `“${m}”`).join(', ')}</p>}
          <p>
            Correct: <b className="text-[#52d6a0]">{item.source.text}</b> <Origin source={item.source.source} />
          </p>
          {item.errors.map((e, i) => (
            <p key={i}>
              <span className="text-danger line-through">{e.wrong}</span> → <span className="text-[#52d6a0]">{e.right}</span> <span className="text-muted">({e.why})</span>
            </p>
          ))}
          {item.structure && (
            <p>
              <b>Structure:</b> {item.structure}
            </p>
          )}
        </Feedback>
      )}
    </div>
  )
}

// ---- 9. Write your own sentence (checked by the same AI check as Sentence Practice)
const fspType = (n: Note): FspCardType => (n.kind === 'idiom' || n.kind === 'phrasal' ? 'idiom' : n.text.trim().includes(' ') ? 'phrase' : 'word')

export function WriteGame({ notes }: { notes: Note[] }): ReactNode {
  const targets = useMemo(() => shuffle(writingTargets(notes)), [notes])
  const hasKey = useApp((s) => !!s.settings?.hasGeminiKey)
  const [index, setIndex] = useState(0)
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<FspCheckResult | null>(null)
  const toastError = useApp((s) => s.toastError)
  if (!targets.length) return <NotEnough>Save some words, idioms, phrasal verbs or sentence structures first.</NotEnough>
  if (!hasKey) return <NotEnough>Add your Gemini API key in Settings — your sentence is checked by Gemini.</NotEnough>
  const t = targets[index % targets.length]
  const check = async (): Promise<void> => {
    setBusy(true)
    try {
      setResult(
        await invoke('fsp:check', {
          term: t.text,
          type: fspType(t),
          meaningBn: t.data?.meaning_bn ?? '',
          sentence: value.trim(),
          challenge: t.kind === 'structure' || t.kind === 'grammar' ? 'Use this structure correctly in a new sentence.' : 'Use it naturally and correctly in your own sentence.',
          context: t.contextSentence
        })
      )
    } catch (err) {
      toastError(err)
    } finally {
      setBusy(false)
    }
  }
  const right = result?.status === 'correct'
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted">Use this in your own sentence:</span>
        <Select value={index % targets.length} onChange={(e) => (setIndex(Number(e.target.value)), setResult(null), setValue(''))} className="h-8 max-w-72 text-sm" aria-label="Item to use">
          {targets.map((n, i) => (
            <option key={n.id} value={i}>
              {n.text}
            </option>
          ))}
        </Select>
        <Badge>{NOTE_KINDS.find((k) => k.value === t.kind)?.label}</Badge>
      </div>
      <p className="text-xl font-semibold">{t.text}</p>
      {t.data?.meaning_bn && <p className="text-sm text-muted">{t.data.meaning_bn}</p>}
      {t.contextSentence && (
        <p className="mt-1 text-xs text-muted">
          Saved from: <span className="italic">“{t.contextSentence}”</span> <Origin source={t.mediaTitle} />
        </p>
      )}
      <Textarea className="mt-3" rows={3} value={value} disabled={busy || !!result} onChange={(e) => setValue(e.target.value)} placeholder="Write your sentence…" aria-label="Your sentence" />
      {!result ? (
        <Button className="mt-2" variant="primary" loading={busy} disabled={!value.trim()} onClick={() => void check()}>
          Check my sentence
        </Button>
      ) : (
        <Feedback
          correct={right}
          title={right ? 'Correct and natural!' : 'Almost — see the fixes'}
          onRetry={() => setResult(null)}
          onNext={() => (setIndex((i) => i + 1), setResult(null), setValue(''))}
        >
          {result.errors.map((e, i) => (
            <p key={i}>
              <span className="text-danger line-through">{e.wrongText}</span> → <span className="text-[#52d6a0]">{e.fix}</span> <span className="text-muted">— {e.ruleBangla}</span>
            </p>
          ))}
          {!right && result.corrected && (
            <p>
              Better: <b className="text-[#52d6a0]">{result.corrected}</b> <Badge tone="warn">AI-corrected</Badge>
            </p>
          )}
          {result.optionalTip && <p className="text-muted">Tip: {result.optionalTip}</p>}
          <NoteWhy note={t} />
        </Feedback>
      )}
    </div>
  )
}
