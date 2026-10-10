// Flash Sentence Practice: a mode inside the Flashcards section (self-contained).
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Check, CheckCircle2, Import, Lightbulb, Loader2, Mic, PenLine, Radar, Send, SkipForward, Sparkles, Undo2, Library } from 'lucide-react'
import type { FspCardType, FspCheckResult, FspErrorType, FspLesson } from '@shared/fsp'
import { invoke } from '@renderer/lib/api'
import { useApp } from '@renderer/stores/app'
import { Badge, Button, EmptyState, PanelHeader, Select, Textarea } from '@renderer/components/ui'
import { cn } from '@renderer/lib/cn'
import { usePractice } from '@renderer/features/practice/practiceCore'
import { SpeakPanel } from '@renderer/features/practice/SpeakPanel'
import {
  FSP_CONTEXTS,
  FSP_ERROR_LABEL,
  FSP_LEVELS,
  dueCards,
  fspToday,
  highlightParts,
  localCheck,
  mergeCards,
  nextAutoLevel,
  parseDocText,
  sameSentence,
  sanitizeCheck,
  scheduleCard,
  topMistakes,
  type FspCard
} from './fspLogic'
import { useFsp } from './fspStore'
import './fsp.css'

type View = 'practice' | 'bank' | 'radar' | 'import'
const FILTERS: { id: FspCardType | 'all'; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'word', label: 'Word' },
  { id: 'phrase', label: 'Phrase' },
  { id: 'idiom', label: 'Idiom' }
]
const TYPE_LABEL: Record<FspCardType, string> = { word: 'Word', phrase: 'Phrase', idiom: 'Idiom' }
const SPEAK_PREFIX = 'remix:fsp:'

const pick = <T,>(list: T[]): T => list[Math.floor(Math.random() * list.length)]

export function FlashSentencePractice({ modeSwitch }: { modeSwitch: ReactNode }): ReactNode {
  const hasCards = useFsp((s) => s.cards.length > 0)
  const [view, setView] = useState<View>(hasCards ? 'practice' : 'import')
  const speakLine = usePractice((s) => s.speakLine)

  // Close a Speak panel opened from here when leaving this mode.
  useEffect(
    () => () => {
      if (usePractice.getState().speakLine?.id.startsWith(SPEAK_PREFIX)) usePractice.getState().openSpeak(null)
    },
    []
  )

  const tabs: { id: View; label: string; icon: ReactNode }[] = [
    { id: 'practice', label: 'Practice', icon: <PenLine className="size-3.5" /> },
    { id: 'bank', label: 'My Sentence Bank', icon: <Library className="size-3.5" /> },
    { id: 'radar', label: 'Error Radar', icon: <Radar className="size-3.5" /> },
    { id: 'import', label: 'Import', icon: <Import className="size-3.5" /> }
  ]

  return (
    <div className="fsp-root glass-panel relative flex h-full flex-col overflow-hidden">
      <PanelHeader title="Flashcards" icon={<Sparkles className="size-4" />}>
        {modeSwitch}
      </PanelHeader>
      <div className="flex shrink-0 gap-1 overflow-x-auto border-b border-line/60 px-3 py-2 [scrollbar-width:none]" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={view === t.id}
            onClick={() => setView(t.id)}
            className={cn(
              'fsp-tab motion-press flex h-8 shrink-0 items-center gap-1.5 rounded-[10px] border px-3 text-xs font-medium',
              view === t.id ? 'surface-selected' : 'border-transparent text-muted hover:bg-white/55 hover:text-fg'
            )}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {view === 'practice' && (hasCards ? <PracticeView /> : <NoCards onImport={() => setView('import')} />)}
        {view === 'bank' && <BankView />}
        {view === 'radar' && <RadarView />}
        {view === 'import' && <ImportView onDone={() => setView('practice')} />}
      </div>
      {speakLine?.id.startsWith(SPEAK_PREFIX) && <SpeakPanel key={speakLine.id} line={speakLine} />}
    </div>
  )
}

function NoCards({ onImport }: { onImport: () => void }): ReactNode {
  return (
    <EmptyState icon={<Import className="size-10" />} title="No sentence cards yet">
      <p>Import your words, phrases and idioms from your Google Doc first.</p>
      <Button variant="primary" className="mt-3" onClick={onImport}>
        Import cards
      </Button>
    </EmptyState>
  )
}

/* ------------------------------------------------------------------ */
/* Practice                                                            */
/* ------------------------------------------------------------------ */

function PracticeView(): ReactNode {
  const cards = useFsp((s) => s.cards)
  const stats = useFsp((s) => s.stats)
  const bank = useFsp((s) => s.bank)
  const { setStats, addToBank, updateCard } = useFsp.getState()
  const hasKey = useApp((s) => !!s.settings?.hasGeminiKey)
  const today = fspToday()

  const [filter, setFilter] = useState<FspCardType | 'all'>('all')
  const [currentId, setCurrentId] = useState<string | null>(null)
  const [sentence, setSentence] = useState('')
  const [flipped, setFlipped] = useState(false)
  const [attempts, setAttempts] = useState(0)
  const [hintStep, setHintStep] = useState(0)
  const [checking, setChecking] = useState(false)
  const [result, setResult] = useState<FspCheckResult | null>(null)
  const [checkedSentence, setCheckedSentence] = useState('')
  const [checkError, setCheckError] = useState<string | null>(null)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [context, setContext] = useState<string | null>(null)
  const autoNext = useRef<ReturnType<typeof setTimeout> | null>(null)
  const exampleAsked = useRef(new Set<string>())

  const queue = useMemo(() => dueCards(cards, stats.states, today, filter), [cards, stats.states, today, filter])
  const card = cards.find((c) => c.id === currentId) ?? null
  const level = stats.levelMode === 'auto' ? stats.autoLevel : stats.levelMode
  const lv = FSP_LEVELS[Math.min(5, Math.max(1, level)) - 1]
  const check = useMemo(() => (card ? localCheck(sentence, card) : { ok: false, reason: null }), [sentence, card])
  const own = card ? bank[card.id]?.at(-1) : undefined

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: 0, word: 0, phrase: 0, idiom: 0 }
    for (const x of dueCards(cards, stats.states, today, 'all')) {
      c.all++
      c[x.type]++
    }
    return c
  }, [cards, stats.states, today])

  const clearAuto = (): void => {
    if (autoNext.current) clearTimeout(autoNext.current)
    autoNext.current = null
  }
  useEffect(() => clearAuto, [])

  const startCard = useCallback(
    (id: string | null) => {
      clearAuto()
      setCurrentId(id)
      setSentence('')
      setFlipped(false)
      setAttempts(0)
      setHintStep(0)
      setResult(null)
      setCheckError(null)
      setSheetOpen(false)
      setContext(useFsp.getState().stats.contextNudge ? pick(FSP_CONTEXTS) : null)
    },
    []
  )

  // First card, or a new filter.
  useEffect(() => {
    const s = useFsp.getState()
    startCard(dueCards(s.cards, s.stats.states, fspToday(), filter)[0]?.id ?? null)
  }, [filter, startCard])

  const goNext = useCallback(() => {
    const s = useFsp.getState()
    const next = dueCards(s.cards, s.stats.states, fspToday(), filter).find((c) => c.id !== currentId)
    startCard(next?.id ?? null)
  }, [filter, currentId, startCard])

  // No example in the doc: ask AI once and cache it on the card.
  useEffect(() => {
    if (!card || card.example || !hasKey || exampleAsked.current.has(card.id)) return
    exampleAsked.current.add(card.id)
    void invoke('fsp:example', { term: card.term, type: card.type, meaningBn: card.meaningBn })
      .then((example) => example && updateCard(card.id, { example, aiExample: true }))
      .catch(() => undefined)
  }, [card, hasKey, updateCard])

  const submit = async (): Promise<void> => {
    if (!card || !check.ok || checking) return
    clearAuto()
    setSheetOpen(true)
    setResult(null)
    setCheckError(null)
    if (!hasKey) {
      setCheckError('Add your Gemini API key in Settings to get the grammar check.')
      return
    }
    const text = sentence.trim()
    setChecking(true)
    try {
      const raw = await invoke('fsp:check', { term: card.term, type: card.type, meaningBn: card.meaningBn, sentence: text, challenge: lv.ask, context })
      const res = sanitizeCheck(raw, text)
      setResult(res)
      setCheckedSentence(text)
      if (res.status === 'correct') onCorrect(card, text, res)
      else onWrong(text, res)
    } catch {
      setCheckError("Couldn't check, try again.")
    } finally {
      setChecking(false)
    }
  }

  const onCorrect = (c: FspCard, text: string, res: FspCheckResult): void => {
    addToBank(c.id, { sentence: text, date: today })
    const firstTry = attempts === 0
    setStats((s) => {
      const streak = firstTry && res.challengeMet ? s.streak + 1 : 0
      const auto = s.levelMode === 'auto' ? nextAutoLevel(s.autoLevel, streak) : { level: s.autoLevel, streak }
      return { states: { ...s.states, [c.id]: scheduleCard(s.states[c.id], firstTry, today) }, streak: auto.streak, autoLevel: auto.level }
    })
    autoNext.current = setTimeout(goNext, 2500)
  }

  const onWrong = (text: string, res: FspCheckResult): void => {
    setAttempts((n) => n + 1)
    setStats((s) => ({
      streak: 0,
      errors: [...s.errors, ...res.errors.map((e) => ({ type: e.type, date: today, wrong: text, fix: res.corrected }))]
    }))
  }

  const nextAnyway = (): void => {
    if (card) setStats((s) => ({ states: { ...s.states, [card.id]: scheduleCard(s.states[card.id], false, today) } }))
    goNext()
  }

  const tryAgain = (): void => {
    setSheetOpen(false)
    requestAnimationFrame(() => document.getElementById('fsp-input')?.focus())
  }

  const sayIt = (text: string): void => {
    clearAuto()
    usePractice.getState().openSpeak({ id: `${SPEAK_PREFIX}${Date.now()}`, text, start: null, end: null, mediaPath: '', mediaTitle: 'Flash Sentence Practice' }, 'room')
  }

  const showHint = (): void => {
    if (hintStep === 2 && !context) setContext(pick(FSP_CONTEXTS))
    setHintStep((n) => Math.min(3, n + 1))
  }

  if (!card) {
    const upcoming = Object.values(stats.states)
      .map((s) => s.due)
      .filter((d) => d > today)
      .sort()[0]
    return (
      <div className="mx-auto max-w-xl">
        <FilterBar filter={filter} setFilter={setFilter} counts={counts} />
        <EmptyState icon={<CheckCircle2 className="size-10" />} title="All caught up 🎉">
          {upcoming ? `The next cards come back on ${upcoming}.` : 'Import more cards to keep practising.'}
        </EmptyState>
      </div>
    )
  }

  const correct = result?.status === 'correct'
  const outOfTries = !correct && attempts >= 2

  return (
    <div className="fsp-layout">
      <div className="flex min-w-0 flex-col gap-3">
        <FilterBar filter={filter} setFilter={setFilter} counts={counts} />

        <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
          <span>{queue.length} to practise</span>
          <span className="ml-auto">Level</span>
          <Select
            value={String(stats.levelMode)}
            onChange={(e) => setStats({ levelMode: e.target.value === 'auto' ? 'auto' : Number(e.target.value) })}
            className="h-7 w-[150px] px-1.5 text-xs"
            aria-label="Challenge level"
          >
            <option value="auto">Auto (now {stats.autoLevel})</option>
            {FSP_LEVELS.map((l) => (
              <option key={l.n} value={l.n}>
                {l.n} · {l.name}
              </option>
            ))}
          </Select>
          <label className="flex cursor-pointer items-center gap-1" title="Suggest a topic for each sentence">
            <input
              type="checkbox"
              className="size-3.5 accent-[var(--accent)]"
              checked={stats.contextNudge}
              onChange={(e) => {
                setStats({ contextNudge: e.target.checked })
                setContext(e.target.checked ? pick(FSP_CONTEXTS) : null)
              }}
            />
            Topic
          </label>
        </div>

        {/* Card: tap to flip */}
        <div
          className="fsp-card"
          role="button"
          tabIndex={0}
          aria-label={flipped ? 'Show the term' : 'Show meaning and example'}
          onClick={() => setFlipped((f) => !f)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              setFlipped((f) => !f)
            }
          }}
        >
          <div className={cn('fsp-card-inner', flipped && 'fsp-flipped')}>
            <div className="fsp-face" aria-hidden={flipped}>
              <Badge tone="accent">{TYPE_LABEL[card.type]}</Badge>
              <p className="text-[28px] leading-tight font-semibold">{card.term}</p>
              <p className="text-[11px] text-muted">Tap to see the meaning</p>
            </div>
            <div className="fsp-face fsp-back" aria-hidden={!flipped}>
              <p className="text-[11px] font-medium text-muted uppercase">Meaning</p>
              <p className="text-[17px]">{card.meaningBn || '—'}</p>
              <p className="mt-2 text-[11px] font-medium text-muted uppercase">
                Example {card.aiExample && <Badge className="ml-1 normal-case">AI example</Badge>}
              </p>
              <p className="text-[15px]">{card.example || (hasKey ? 'Making an example…' : 'No example yet.')}</p>
              {own && (
                <>
                  <p className="mt-2 text-[11px] font-medium text-muted uppercase">Your sentence</p>
                  <p className="text-[15px] text-accent">{own.sentence}</p>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Challenge */}
        <div className="glass-inset rounded-xl px-3 py-2 text-sm">
          <span className="font-semibold text-accent">Challenge · Level {lv.n}:</span> {lv.ask}
          {context && <span className="text-muted"> Write about {context}.</span>}
        </div>

        {hintStep > 0 && (
          <div className="fsp-fade glass-inset space-y-1 rounded-xl px-3 py-2 text-sm">
            <p>
              <span className="text-muted">Meaning:</span> {card.meaningBn || '—'}
            </p>
            {hintStep > 1 && (
              <p>
                <span className="text-muted">Frame:</span> {lv.frame(card.term)}
              </p>
            )}
            {hintStep > 2 && context && (
              <p>
                <span className="text-muted">Idea:</span> Write about {context}.
              </p>
            )}
          </div>
        )}

        <Textarea
          id="fsp-input"
          value={sentence}
          rows={3}
          placeholder={`Write your own sentence with “${card.term}”…`}
          onChange={(e) => setSentence(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              void submit()
            }
          }}
          disabled={checking || correct}
          aria-describedby="fsp-reason"
          className="text-[15px]"
        />
        <div className="flex items-center gap-2">
          <p id="fsp-reason" className="min-h-[1.25rem] flex-1 text-xs text-muted" aria-live="polite">
            {check.reason}
          </p>
          <Button size="sm" variant="ghost" icon={<Lightbulb className="size-3.5" />} onClick={showHint} disabled={hintStep >= 3}>
            {hintStep === 0 ? 'Hint' : 'More help'}
          </Button>
          <Button variant="primary" icon={checking ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />} onClick={() => void submit()} disabled={!check.ok || checking || correct}>
            {checking ? 'Checking…' : 'Submit'}
          </Button>
        </div>
      </div>

      {/* Feedback: right panel on wide screens, bottom sheet on narrow ones */}
      <aside className={cn('fsp-feedback', sheetOpen ? 'fsp-open' : 'fsp-idle')} aria-live="polite" aria-label="Feedback">
        <span className="fsp-sheet-handle" aria-hidden />
        {checking ? (
          <p className="fsp-fade flex items-center gap-2 text-sm text-muted">
            <Loader2 className="size-4 animate-spin" /> Checking…
          </p>
        ) : checkError ? (
          <div className="fsp-fade space-y-3">
            <p className="text-sm">{checkError}</p>
            <div className="flex gap-2">
              {hasKey && (
                <Button size="sm" variant="primary" onClick={() => void submit()}>
                  Try again
                </Button>
              )}
              <Button size="sm" onClick={() => setSheetOpen(false)}>
                Close
              </Button>
            </div>
          </div>
        ) : result && correct ? (
          <div className="fsp-fade space-y-3">
            <p className="flex items-center gap-2 text-lg font-semibold text-[#1f7a3a]">
              <Check className="size-6" /> Correct!
            </p>
            <p className="text-sm">{checkedSentence}</p>
            {!result.challengeMet && <p className="text-xs text-warn">Grammar is correct, but this level asks: {lv.ask}</p>}
            {result.optionalTip && <p className="text-sm text-muted">{result.optionalTip}</p>}
            <p className="text-xs text-muted">Saved to My Sentence Bank · next card in a moment…</p>
            <div className="flex gap-2">
              <Button size="sm" variant="primary" icon={<SkipForward className="size-3.5" />} onClick={goNext}>
                Next card
              </Button>
              <Button size="sm" icon={<Mic className="size-3.5" />} onClick={() => sayIt(checkedSentence)}>
                Say it
              </Button>
            </div>
          </div>
        ) : result ? (
          <div className="fsp-fade space-y-3">
            <p className="text-lg font-semibold text-warn">Almost!</p>
            <p className="text-sm leading-relaxed">
              {highlightParts(checkedSentence, result.errors).map((p, i) => (
                <span key={i} className={cn(p.wrong && 'fsp-wrong')}>
                  {p.text}
                </span>
              ))}
            </p>
            <div className="rounded-xl bg-[rgba(31,122,58,0.08)] px-3 py-2 text-sm">
              <span className="text-xs text-muted">Corrected: </span>
              {result.corrected}
            </div>
            <ul className="space-y-2">
              {result.errors.slice(0, 2).map((e, i) => (
                <li key={i} className="text-sm">
                  <p className="text-xs font-semibold text-accent">{FSP_ERROR_LABEL[e.type].en}</p>
                  {e.wrongText && (
                    <p>
                      <span className="line-through opacity-70">{e.wrongText}</span> → <b>{e.fix}</b>
                    </p>
                  )}
                  <p className="text-muted">{e.ruleBangla}</p>
                </li>
              ))}
            </ul>
            {outOfTries && <p className="text-xs text-muted">This card will come back tomorrow.</p>}
            <div className="flex gap-2">
              {outOfTries ? (
                <Button size="sm" variant="primary" icon={<SkipForward className="size-3.5" />} onClick={nextAnyway}>
                  Next anyway
                </Button>
              ) : (
                <Button size="sm" variant="primary" icon={<Undo2 className="size-3.5" />} onClick={tryAgain}>
                  Try again
                </Button>
              )}
              <Button size="sm" icon={<Mic className="size-3.5" />} onClick={() => sayIt(result.corrected)}>
                Say it
              </Button>
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted">Write your own sentence and press Submit. Feedback appears here.</p>
        )}
      </aside>
    </div>
  )
}

function FilterBar({ filter, setFilter, counts }: { filter: FspCardType | 'all'; setFilter: (f: FspCardType | 'all') => void; counts: Record<string, number> }): ReactNode {
  return (
    <div className="flex flex-wrap gap-1" role="tablist" aria-label="Card type">
      {FILTERS.map((f) => (
        <button
          key={f.id}
          role="tab"
          aria-selected={filter === f.id}
          onClick={() => setFilter(f.id)}
          className={cn(
            'fsp-tab motion-press flex h-7 items-center gap-1 rounded-full border px-3 text-xs font-medium',
            filter === f.id ? 'surface-selected' : 'border-transparent text-muted hover:bg-white/55'
          )}
        >
          {f.label}
          <span className="text-[10px] tabular-nums opacity-70">{counts[f.id] ?? 0}</span>
        </button>
      ))}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* My Sentence Bank                                                    */
/* ------------------------------------------------------------------ */

function BankView(): ReactNode {
  const cards = useFsp((s) => s.cards)
  const bank = useFsp((s) => s.bank)
  const withSentences = cards.filter((c) => bank[c.id]?.length)
  if (!withSentences.length) {
    return (
      <EmptyState icon={<Library className="size-10" />} title="Your Sentence Bank is empty">
        Every correct sentence you write is saved here.
      </EmptyState>
    )
  }
  return (
    <ul className="mx-auto flex max-w-2xl flex-col gap-2">
      {withSentences.map((c) => (
        <li key={c.id} className="glass-inset rounded-xl px-4 py-3">
          <div className="mb-1 flex items-center gap-2">
            <p className="font-semibold">{c.term}</p>
            <Badge>{TYPE_LABEL[c.type]}</Badge>
          </div>
          <ul className="space-y-1">
            {bank[c.id].map((e, i) => (
              <li key={i} className="flex gap-2 text-sm">
                <span className="flex-1">{e.sentence}</span>
                <span className="text-[11px] text-muted tabular-nums">{e.date}</span>
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  )
}

/* ------------------------------------------------------------------ */
/* Error Radar                                                         */
/* ------------------------------------------------------------------ */

function RadarView(): ReactNode {
  const errors = useFsp((s) => s.stats.errors)
  const top = useMemo(() => topMistakes(errors, fspToday()), [errors])
  const [open, setOpen] = useState<FspErrorType | null>(null)
  if (!top.length) {
    return (
      <EmptyState icon={<Radar className="size-10" />} title="No mistakes this week">
        When the grammar check finds mistakes, your most common ones show up here with a short lesson.
      </EmptyState>
    )
  }
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-3">
      <h3 className="text-sm font-semibold">Your top {top.length} mistakes this week</h3>
      {top.map((t, i) => (
        <div key={t.type} className="glass-inset rounded-xl px-4 py-3">
          <div className="flex items-center gap-3">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-accent-soft text-sm font-semibold text-accent">{i + 1}</span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">{FSP_ERROR_LABEL[t.type].en}</p>
              <p className="text-xs text-muted">
                {FSP_ERROR_LABEL[t.type].bn} · {t.count} time{t.count === 1 ? '' : 's'}
              </p>
            </div>
            <Button size="sm" variant={open === t.type ? 'primary' : 'secondary'} onClick={() => setOpen(open === t.type ? null : t.type)}>
              1-minute lesson
            </Button>
          </div>
          {open === t.type && <LessonBox type={t.type} />}
        </div>
      ))}
    </div>
  )
}

function LessonBox({ type }: { type: FspErrorType }): ReactNode {
  const hasKey = useApp((s) => !!s.settings?.hasGeminiKey)
  const cached = useFsp((s) => s.stats.lessons[type])
  const [lesson, setLesson] = useState<FspLesson | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const today = fspToday()
    const weekAgo = new Date()
    weekAgo.setDate(weekAgo.getDate() - 7)
    if (cached && cached.date > fspToday(weekAgo)) {
      setLesson(cached.lesson)
      return
    }
    if (!hasKey) return
    const samples = useFsp
      .getState()
      .stats.errors.filter((e) => e.type === type)
      .slice(-3)
      .map((e) => ({ wrong: e.wrong, fix: e.fix }))
    void invoke('fsp:lesson', { type, label: FSP_ERROR_LABEL[type].en, samples })
      .then((l) => {
        const safe: FspLesson = { lessonBn: typeof l?.lessonBn === 'string' ? l.lessonBn : '', items: Array.isArray(l?.items) ? l.items.slice(0, 3) : [] }
        setLesson(safe)
        useFsp.getState().setStats((s) => ({ lessons: { ...s.lessons, [type]: { date: today, lesson: safe } } }))
      })
      .catch(() => setFailed(true))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, hasKey])

  if (!hasKey && !lesson) return <p className="mt-3 text-sm text-muted">The lesson needs a Gemini API key (Settings).</p>
  if (failed) return <p className="mt-3 text-sm text-muted">Couldn&apos;t make the lesson, try again.</p>
  if (!lesson)
    return (
      <p className="mt-3 flex items-center gap-2 text-sm text-muted">
        <Loader2 className="size-4 animate-spin" /> Making your lesson…
      </p>
    )
  return (
    <div className="fsp-fade mt-3 space-y-3 border-t border-line/70 pt-3">
      <p className="text-sm leading-relaxed whitespace-pre-line">{lesson.lessonBn}</p>
      <p className="text-xs font-semibold text-muted">Fix it</p>
      {lesson.items.map((it, i) => (
        <FixIt key={i} wrong={it.wrong} fix={it.fix} />
      ))}
    </div>
  )
}

function FixIt({ wrong, fix }: { wrong: string; fix: string }): ReactNode {
  const [answer, setAnswer] = useState(wrong)
  const [state, setState] = useState<'idle' | 'right' | 'shown'>('idle')
  return (
    <div className="space-y-1.5 rounded-xl bg-white/60 p-2.5">
      <p className="text-sm">
        <span className="fsp-wrong">{wrong}</span>
      </p>
      <div className="flex gap-2">
        <input
          className="glass-field h-8 min-w-0 flex-1 rounded-[10px] border px-2 text-sm"
          value={answer}
          onChange={(e) => {
            setAnswer(e.target.value)
            if (state === 'right') setState('idle')
          }}
          onKeyDown={(e) => e.key === 'Enter' && sameSentence(answer, fix) && setState('right')}
          aria-label="Your correction"
        />
        <Button size="sm" onClick={() => setState(sameSentence(answer, fix) ? 'right' : 'shown')}>
          Check
        </Button>
      </div>
      {state === 'right' && <p className="text-xs font-medium text-[#1f7a3a]">✓ Correct</p>}
      {state === 'shown' && <p className="text-xs text-muted">Answer: {fix}</p>}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Import                                                              */
/* ------------------------------------------------------------------ */

const SAMPLE = `break the ice | idiom | আড়ষ্টতা কাটানো | He told a joke to break the ice.
figure out | phrase | বুঝে বের করা |
reluctant | word | অনিচ্ছুক | She was reluctant to leave.`

function ImportView({ onDone }: { onDone: () => void }): ReactNode {
  const cards = useFsp((s) => s.cards)
  const [text, setText] = useState('')
  const { toast } = useApp.getState()

  const run = (): void => {
    const parsed = parseDocText(text)
    if (!parsed.length) {
      toast('error', 'No lines like “term | type | Bangla meaning | example” were found.')
      return
    }
    const { cards: merged, added, updated } = mergeCards(useFsp.getState().cards, parsed)
    useFsp.getState().setCards(merged)
    toast('success', `Imported ${added} new card${added === 1 ? '' : 's'}${updated ? `, updated ${updated}` : ''}`)
    setText('')
    onDone()
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-3">
      <div>
        <h3 className="text-sm font-semibold">Import from your Google Doc</h3>
        <p className="text-xs text-muted">
          Open your Doc, select all (Ctrl+A), copy (Ctrl+C) and paste it here. Each line: <b>term | type | Bangla meaning | example sentence</b>. Lines without “|” are skipped. A missing
          example is written by AI and marked “AI example”.
        </p>
      </div>
      <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={10} placeholder={SAMPLE} className="font-mono text-[13px]" />
      <div className="flex items-center gap-2">
        <span className="flex-1 text-xs text-muted">
          {cards.length} card{cards.length === 1 ? '' : 's'} saved. Importing again updates the same terms.
        </span>
        <Button variant="primary" icon={<Import className="size-4" />} onClick={run} disabled={!text.trim()}>
          Import
        </Button>
      </div>
    </div>
  )
}
