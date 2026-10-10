import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { CalendarDays, Check, ChevronLeft, ChevronRight, CircleHelp, Flame, Mic, Play, RefreshCw, Shield, Shuffle, Sprout, Sun } from 'lucide-react'
import type { CalendarDay, PracticeRating, RemixSet, RoomHome, ShadowLine, SubtitleLine } from '@shared/types'
import { invoke } from '@renderer/lib/api'
import { useApp } from '@renderer/stores/app'
import { Badge, Button, EmptyState, Select, Textarea } from '@renderer/components/ui'
import { cn } from '@renderer/lib/cn'
import { canPlayMovieLine } from '@renderer/features/movie/MovieMode'
import { PracticeContext, getMoviePlayer, playAiVoice, playSegment, usePractice, type PracticeActions } from '@renderer/features/practice/practiceCore'
import { SpeakPanel } from '@renderer/features/practice/SpeakPanel'

const CAPS = [5, 10, 15, 20, 30]
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const STATUS_LABEL: Record<ShadowLine['status'], string> = { new: 'New', learning: 'Learning', mastered: 'Mastered' }
const STATUS_TONE: Record<ShadowLine['status'], 'info' | 'warn' | 'accent'> = { new: 'info', learning: 'warn', mastered: 'accent' }

const toSubtitle = (l: ShadowLine): SubtitleLine => ({
  id: l.id,
  text: l.text,
  start: l.start,
  end: l.end,
  mediaPath: l.mediaPath ?? '',
  mediaTitle: l.mediaTitle ?? ''
})

/** Original clip if that movie is open in the player, otherwise the AI voice. */
async function playLine(line: ShadowLine): Promise<void> {
  const sub = toSubtitle(line)
  if (canPlayMovieLine(sub)) {
    const player = getMoviePlayer()
    await playSegment(player, sub, 1, () => false)
    await player.pause()
  } else {
    await playAiVoice(line.text)
  }
}

/** Practice Room: today's short review (Today) and the month view (Calendar). */
export function PracticeRoom(): ReactNode {
  const [tab, setTab] = useState<'today' | 'calendar'>('today')
  const [home, setHome] = useState<RoomHome | null>(null)
  const speakLine = usePractice((s) => s.speakLine)
  const speakHost = usePractice((s) => s.speakHost)
  const { toastError } = useApp.getState()

  const loadHome = useCallback(async () => {
    try {
      setHome(await invoke('room:home'))
    } catch (err) {
      toastError(err)
    }
  }, [toastError])

  useEffect(() => {
    void loadHome()
  }, [loadHome])

  // Re-shadowing or a Remix sentence finished: refresh the counts.
  useEffect(() => {
    if (!speakLine) void loadHome()
  }, [speakLine, loadHome])

  const player = useMemo(() => getMoviePlayer(), [])
  const practice = useMemo<PracticeActions>(
    () => ({ host: 'room', player, canPlay: canPlayMovieLine, startRepeat: () => undefined, stopRepeat: () => undefined, skipRep: () => undefined }),
    [player]
  )

  return (
    <PracticeContext.Provider value={practice}>
      <div className="glass-panel relative flex h-full flex-col overflow-hidden">
        <div className="glass-header flex h-12 shrink-0 items-center gap-3 rounded-t-2xl px-4">
          <Sprout className="size-5 text-accent" />
          <h1 className="text-sm font-semibold">Practice Room</h1>
          <div className="ml-2 flex gap-1" role="tablist">
            <TabButton active={tab === 'today'} onClick={() => setTab('today')} icon={<Sun className="size-4" />}>
              Today
            </TabButton>
            <TabButton active={tab === 'calendar'} onClick={() => setTab('calendar')} icon={<CalendarDays className="size-4" />}>
              Calendar
            </TabButton>
          </div>
          {home && (
            <div className="ml-auto flex items-center gap-3 text-xs text-muted">
              <span className="flex items-center gap-1" title="Days in a row">
                <Flame className="size-4 text-accent" />
                {home.streak} day streak
              </span>
              <span className="flex items-center gap-1" title="A shield saves your streak on a missed day (2 per month)">
                <Shield className="size-4" />
                {home.shieldsLeft} left
              </span>
            </div>
          )}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {tab === 'today' ? <TodayTab home={home} reload={loadHome} /> : <CalendarTab />}
        </div>
        {speakLine && speakHost === 'room' && <SpeakPanel key={speakLine.id} line={speakLine} />}
      </div>
    </PracticeContext.Provider>
  )
}

function TabButton({ active, onClick, icon, children }: { active: boolean; onClick: () => void; icon: ReactNode; children: ReactNode }): ReactNode {
  return (
    <button
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn('motion-press flex h-8 items-center gap-1.5 rounded-[10px] border px-3 text-xs font-medium', active ? 'surface-selected text-accent' : 'border-transparent text-muted hover:bg-white/55 hover:text-fg')}
    >
      {icon}
      {children}
    </button>
  )
}

/* ---------------------------------- Today ---------------------------------- */

function TodayTab({ home, reload }: { home: RoomHome | null; reload: () => Promise<void> }): ReactNode {
  const { toastError } = useApp.getState()
  const [queue, setQueue] = useState<ShadowLine[]>([])
  const [reviewed, setReviewed] = useState(0)
  const [running, setRunning] = useState(false)

  useEffect(() => {
    if (home && !running) setQueue(home.queue)
  }, [home, running])

  const rate = async (line: ShadowLine, rating: PracticeRating): Promise<void> => {
    try {
      await invoke('room:review', { id: line.id, rating })
      setQueue((q) => q.filter((l) => l.id !== line.id))
      // After the first one (today's minimum), pause and offer "Continue".
      if (reviewed === 0) setRunning(false)
      setReviewed((n) => n + 1)
      await reload()
    } catch (err) {
      toastError(err)
    }
  }

  const changeCap = async (cap: number): Promise<void> => {
    try {
      await invoke('room:setDailyCap', cap)
      await reload()
    } catch (err) {
      toastError(err)
    }
  }

  if (!home) return null
  const current = running ? queue[0] : undefined
  const minimumDone = home.practisedToday || reviewed > 0

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      {/* Day card */}
      <div className="glass-elevated anim-rise-in flex items-center gap-4 rounded-2xl p-5">
        <div className="flex size-14 shrink-0 flex-col items-center justify-center rounded-2xl text-white" style={{ background: 'linear-gradient(145deg, #9a2a4a, #781b36 60%, #5e1229)' }}>
          <span className="text-[10px] uppercase opacity-80">Day</span>
          <span className="text-xl leading-none font-bold tabular-nums">{home.dayNumber}</span>
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-base font-semibold">
            Day {home.dayNumber} · You shadowed {home.shadowedToday} {home.shadowedToday === 1 ? 'line' : 'lines'} today
          </p>
          <p className="text-sm text-muted">
            {minimumDone ? 'Streak kept for today ✓' : 'Practice time 🌱 One sentence keeps your streak.'}
          </p>
        </div>
      </div>

      {current ? (
        <ReviewCard key={current.id} line={current} onRate={(r) => void rate(current, r)} left={queue.length} />
      ) : queue.length > 0 ? (
        <div className="glass-inset flex flex-col items-center gap-3 rounded-2xl p-6 text-center">
          {reviewed === 0 ? (
            <>
              <p className="text-sm">
                {queue.length === 1 ? '1 sentence is' : `${queue.length} sentences are`} ready for today. Just one keeps your streak.
              </p>
              <Button variant="primary" className="h-11 px-6 text-base" icon={<Play className="size-4" />} onClick={() => setRunning(true)}>
                Start
              </Button>
            </>
          ) : (
            <>
              <p className="text-sm font-medium">Nice! Today&apos;s minimum is done ✓</p>
              <p className="text-xs text-muted">{queue.length} more ready if you want.</p>
              <div className="flex gap-2">
                <Button variant="primary" onClick={() => setRunning(true)}>
                  Continue
                </Button>
                <Button onClick={() => void reload()}>Stop for today</Button>
              </div>
            </>
          )}
        </div>
      ) : (
        <div className="glass-inset rounded-2xl">
          <EmptyState icon={<Sprout className="size-10" />} title={reviewed > 0 ? 'All done for today 🎉' : 'Nothing to review today'}>
            {reviewed > 0
              ? 'Come back tomorrow for the next ones.'
              : 'Shadow a line with Speak in Movie Mode or YouTube. It comes back here after 3 days, then 7, 14 and 30.'}
          </EmptyState>
        </div>
      )}

      {/* After the minimum, offer Continue between cards instead of running on forever. */}
      {running && reviewed > 0 && current && (
        <div className="text-center">
          <Button variant="ghost" size="sm" onClick={() => setRunning(false)}>
            Take a break
          </Button>
        </div>
      )}

      <label className="flex items-center justify-center gap-2 text-xs text-muted">
        Sentences per day
        <Select value={home.dailyCap} onChange={(e) => void changeCap(Number(e.target.value))} className="h-7 w-[64px] px-1.5 text-xs" aria-label="Daily limit">
          {[...new Set([...CAPS, home.dailyCap])]
            .sort((a, b) => a - b)
            .map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
        </Select>
      </label>
    </div>
  )
}

type Step = 'listen' | 'say' | 'reveal' | 'shadow' | 'rate'

/** One review: play → say it before seeing → reveal → 1–2 shadow reps → rate. */
function ReviewCard({ line, onRate, left }: { line: ShadowLine; onRate: (r: PracticeRating) => void; left: number }): ReactNode {
  const { toastError } = useApp.getState()
  const [step, setStep] = useState<Step>('listen')
  const [playing, setPlaying] = useState(false)
  const [shadowReps, setShadowReps] = useState(0)
  const original = canPlayMovieLine(toSubtitle(line))

  const play = async (): Promise<void> => {
    if (playing) return
    setPlaying(true)
    try {
      await playLine(line)
    } catch (err) {
      toastError(err)
    } finally {
      setPlaying(false)
    }
  }

  useEffect(() => {
    void play().then(() => setStep((s) => (s === 'listen' ? 'say' : s)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const textShown = step === 'reveal' || step === 'shadow' || step === 'rate'
  const STEPS: Step[] = ['listen', 'say', 'reveal', 'shadow', 'rate']

  return (
    <div className="glass-elevated anim-pop-in flex flex-col gap-4 rounded-2xl p-5">
      <div className="flex items-center gap-2 text-xs text-muted">
        <div className="flex flex-1 gap-1" aria-hidden>
          {STEPS.map((s, i) => (
            <span key={s} className={cn('h-1.5 flex-1 rounded-full bg-accent transition-opacity', i <= STEPS.indexOf(step) ? 'opacity-100' : 'opacity-15')} />
          ))}
        </div>
        <span className="tabular-nums">{left} for today</span>
      </div>

      <div className="flex min-h-[7rem] items-center justify-center text-center">
        {textShown ? (
          <p className="anim-fade-in text-[24px] leading-snug font-semibold">{line.text}</p>
        ) : step === 'listen' ? (
          <p className="text-lg text-muted">Listen…</p>
        ) : (
          <p className="text-lg font-medium text-accent">Say it before you see it 🙂</p>
        )}
      </div>
      {line.mediaTitle && <p className="-mt-2 text-center text-xs text-muted">from {line.mediaTitle}</p>}

      <div className="flex flex-col gap-2">
        <Button icon={<Play className="size-4" />} onClick={() => void play()} loading={playing}>
          Play again
          <span className="text-[11px] font-normal text-muted">{original ? '' : '· AI voice'}</span>
        </Button>

        {step === 'listen' && (
          <Button variant="primary" className="h-12 text-base" onClick={() => setStep('say')}>
            I listened
          </Button>
        )}
        {step === 'say' && (
          <Button variant="primary" className="h-12 text-base" icon={<Mic className="size-4" />} onClick={() => setStep('reveal')}>
            I said it, show the text
          </Button>
        )}
        {step === 'reveal' && (
          <Button variant="primary" className="h-12 text-base" onClick={() => setStep('shadow')}>
            Now shadow it
          </Button>
        )}
        {step === 'shadow' && (
          <div className="flex gap-2">
            <Button
              variant="primary"
              className="h-12 flex-1 text-base"
              icon={<Check className="size-4" />}
              onClick={() => {
                const n = shadowReps + 1
                setShadowReps(n)
                if (n >= 2) setStep('rate')
                else void play()
              }}
            >
              Shadowed {shadowReps + 1}/2
            </Button>
            {shadowReps >= 1 && (
              <Button className="h-12" onClick={() => setStep('rate')}>
                Rate now
              </Button>
            )}
          </div>
        )}
        {step === 'rate' && (
          <div className="grid grid-cols-3 gap-2">
            <Button className="h-12 text-base text-warn" onClick={() => onRate('Hard')} title="Comes back in 3 days">
              Hard
            </Button>
            <Button className="h-12 text-base" onClick={() => onRate('OK')} title="Moves up a step">
              OK
            </Button>
            <Button className="h-12 text-base text-info" onClick={() => onRate('Easy')} title="Moves up a step">
              Easy
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}

/* -------------------------------- Calendar -------------------------------- */

const DOT: Record<CalendarDay['dot'], string> = {
  none: '',
  shadowed: 'bg-accent',
  due: 'bg-[#c58a2a]',
  done: 'bg-[#1f7a3a]',
  upcoming: 'bg-muted/40'
}

function CalendarTab(): ReactNode {
  const { toastError } = useApp.getState()
  const now = new Date()
  const [ym, setYm] = useState({ year: now.getFullYear(), month: now.getMonth() + 1 })
  const [days, setDays] = useState<CalendarDay[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [lines, setLines] = useState<ShadowLine[]>([])
  const [remixOpen, setRemixOpen] = useState(false)
  const speakLine = usePractice((s) => s.speakLine)

  useEffect(() => {
    void invoke('room:calendar', ym).then(setDays).catch(toastError)
  }, [ym, toastError, speakLine])

  useEffect(() => {
    setRemixOpen(false)
    if (selected) void invoke('room:day', selected).then(setLines).catch(toastError)
    else setLines([])
  }, [selected, toastError, speakLine])

  const move = (delta: number): void => {
    const m = ym.month - 1 + delta
    setYm({ year: ym.year + Math.floor(m / 12), month: ((m % 12) + 12) % 12 + 1 })
    setSelected(null)
  }

  // Monday-first grid.
  const lead = (new Date(ym.year, ym.month - 1, 1).getDay() + 6) % 7

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      <div className="glass-elevated rounded-2xl p-4">
        <div className="mb-3 flex items-center gap-2">
          <Button variant="ghost" size="sm" icon={<ChevronLeft className="size-4" />} onClick={() => move(-1)} aria-label="Previous month" />
          <h2 className="flex-1 text-center text-sm font-semibold">
            {MONTHS[ym.month - 1]} {ym.year}
          </h2>
          <Button variant="ghost" size="sm" icon={<ChevronRight className="size-4" />} onClick={() => move(1)} aria-label="Next month" />
        </div>
        <div className="grid grid-cols-7 gap-1 text-center text-[11px] text-muted">
          {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
            <span key={d} className="pb-1">
              {d}
            </span>
          ))}
          {Array.from({ length: lead }, (_, i) => (
            <span key={`b${i}`} />
          ))}
          {days.map((d) => {
            const n = Number(d.date.slice(8))
            const count = d.dot === 'due' || d.dot === 'upcoming' ? d.due : d.learned
            return (
              <button
                key={d.date}
                onClick={() => setSelected(d.date === selected ? null : d.date)}
                className={cn(
                  'motion-press flex aspect-square flex-col items-center justify-center gap-0.5 rounded-xl border text-sm',
                  d.date === selected ? 'surface-selected text-accent' : 'border-transparent hover:bg-white/55'
                )}
                aria-label={`${d.date}${count ? `, ${count} lines` : ''}`}
              >
                <span className="tabular-nums">{n}</span>
                <span className="flex h-3 items-center gap-0.5">
                  {d.dot !== 'none' && <span className={cn('size-1.5 rounded-full', DOT[d.dot])} />}
                  {count > 0 && <span className="text-[10px] leading-none text-muted tabular-nums">{count}</span>}
                </span>
              </button>
            )
          })}
        </div>
        <div className="mt-3 flex flex-wrap justify-center gap-3 text-[11px] text-muted">
          <Legend className={DOT.shadowed}>Shadowed</Legend>
          <Legend className={DOT.done}>Reviewed</Legend>
          <Legend className={DOT.due}>Due</Legend>
          <Legend className={DOT.upcoming}>Coming up</Legend>
        </div>
      </div>

      {selected && (
        <div className="glass-elevated anim-rise-in rounded-2xl p-4">
          <div className="mb-3 flex items-center gap-2">
            <h3 className="flex-1 text-sm font-semibold">Lines shadowed on {selected}</h3>
            {lines.length > 0 && (
              <Button size="sm" icon={<Shuffle className="size-3.5" />} onClick={() => setRemixOpen(!remixOpen)} aria-expanded={remixOpen}>
                Remix
              </Button>
            )}
          </div>
          {lines.length === 0 ? (
            <p className="text-sm text-muted">No lines were shadowed this day.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {lines.map((l) => (
                <li key={l.id} className="glass-inset flex items-center gap-2 rounded-xl px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm">{l.text}</p>
                    {l.mediaTitle && <p className="truncate text-[11px] text-muted">{l.mediaTitle}</p>}
                  </div>
                  <Badge tone={STATUS_TONE[l.status]}>{STATUS_LABEL[l.status]}</Badge>
                  <Button size="sm" icon={<Mic className="size-3.5" />} onClick={() => usePractice.getState().openSpeak(toSubtitle(l), 'room')}>
                    Re-shadow
                  </Button>
                </li>
              ))}
            </ul>
          )}
          {remixOpen && <RemixView date={selected} />}
        </div>
      )}
    </div>
  )
}

function Legend({ className, children }: { className: string; children: ReactNode }): ReactNode {
  return (
    <span className="flex items-center gap-1">
      <span className={cn('size-1.5 rounded-full', className)} />
      {children}
    </span>
  )
}

/* --------------------------------- Remix ---------------------------------- */

function RemixView({ date }: { date: string }): ReactNode {
  const { toastError } = useApp.getState()
  const hasKey = useApp((s) => !!s.settings?.hasGeminiKey)
  const [set, setSet] = useState<RemixSet | null>(null)
  const [loading, setLoading] = useState(false)
  const [shown, setShown] = useState<Record<string, boolean>>({})
  const [mine, setMine] = useState('')
  const [checking, setChecking] = useState(false)
  const [feedback, setFeedback] = useState<{ corrected: string; tip_bn: string; ok: boolean } | null>(null)

  const load = useCallback(
    async (refresh: boolean) => {
      setLoading(true)
      try {
        setSet(await invoke('room:remix', { date, refresh }))
        setShown({})
      } catch (err) {
        toastError(err)
      } finally {
        setLoading(false)
      }
    },
    [date, toastError]
  )

  useEffect(() => {
    if (hasKey) void load(false)
  }, [hasKey, load])

  const toggle = (k: string): void => setShown((s) => ({ ...s, [k]: !s[k] }))

  const check = async (): Promise<void> => {
    if (!set || !mine.trim()) return
    setChecking(true)
    try {
      setFeedback(await invoke('room:yourTurn', { sentence: mine.trim(), phrases: set.phrases.map((p) => p.phrase) }))
    } catch (err) {
      toastError(err)
    } finally {
      setChecking(false)
    }
  }

  if (!hasKey) return <p className="mt-4 text-sm text-muted">Remix needs a Gemini API key (Settings).</p>

  return (
    <div className="anim-fade-in mt-4 flex flex-col gap-4 border-t border-line/70 pt-4">
      <div className="flex items-center gap-2">
        <h4 className="flex-1 text-sm font-semibold">Remix: the same phrases in new sentences</h4>
        <Button size="sm" variant="ghost" icon={<RefreshCw className="size-3.5" />} onClick={() => void load(true)} loading={loading}>
          New remix
        </Button>
      </div>

      {!set ? (
        <p className="text-sm text-muted">{loading ? 'Making a remix…' : ''}</p>
      ) : (
        <>
          <div className="flex flex-wrap gap-1.5">
            {set.phrases.map((p, i) => (
              <button key={i} onClick={() => toggle(`p${i}`)} className="btn-glass motion-press rounded-full border px-3 py-1 text-xs" title="Tap for the Bangla meaning">
                {p.phrase}
                {shown[`p${i}`] && <span className="ml-1.5 text-muted">· {p.meaning_bn}</span>}
              </button>
            ))}
          </div>

          <ol className="flex flex-col gap-2">
            {set.sentences.map((s, i) => (
              <li key={i} className="glass-inset rounded-xl px-3 py-2.5">
                <div className="flex items-start gap-2">
                  <p className="min-w-0 flex-1 text-[15px] font-medium">{s.en}</p>
                  <Button size="sm" variant="ghost" icon={<CircleHelp className="size-4" />} onClick={() => toggle(`s${i}`)} aria-label="Bangla meaning" aria-expanded={!!shown[`s${i}`]} />
                  <Button
                    size="sm"
                    icon={<Mic className="size-3.5" />}
                    onClick={() =>
                      usePractice.getState().openSpeak({ id: `remix:${date}:${i}`, text: s.en, start: null, end: null, mediaPath: '', mediaTitle: 'Remix' }, 'room')
                    }
                  >
                    Say it
                  </Button>
                </div>
                {shown[`s${i}`] && <p className="anim-fade-in mt-1 text-sm text-muted">{s.bn}</p>}
              </li>
            ))}
          </ol>

          <div className="flex flex-col gap-2">
            <h4 className="text-sm font-semibold">Your turn</h4>
            <p className="text-xs text-muted">Write your own sentence with one of the phrases above.</p>
            <Textarea value={mine} onChange={(e) => setMine(e.target.value)} rows={2} placeholder="Type your sentence…" />
            <div>
              <Button variant="primary" size="sm" onClick={() => void check()} loading={checking} disabled={!mine.trim()}>
                Check
              </Button>
            </div>
            {feedback && (
              <div className="glass-inset anim-fade-in rounded-xl p-3 text-sm">
                <p className="font-medium">{feedback.ok ? 'Correct ✓' : 'Better:'}</p>
                {!feedback.ok && <p className="mt-0.5">{feedback.corrected}</p>}
                <p className="mt-1.5 text-muted">{feedback.tip_bn}</p>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
