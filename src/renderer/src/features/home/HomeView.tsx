import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { ArrowRight, BookOpen, CalendarDays, Cloud, CloudDrizzle, CloudFog, CloudLightning, CloudRain, CloudSnow, CloudSun, Mic, MoonStar, Pencil, Square, Sun, Target } from 'lucide-react'
import type { Article } from '@shared/articles'
import type { HomeWeather } from '@shared/voice'
import type { RoomHome } from '@shared/types'
import { errorMessage, invoke } from '@renderer/lib/api'
import { cn } from '@renderer/lib/cn'
import { useApp } from '@renderer/stores/app'
import { useArticles } from '@renderer/features/articles/articleStore'
import { useVoice } from '@renderer/features/voice/voiceStore'
import { endVoiceMode, startVoiceMode, useVoiceMode, voiceModeActive, type VoiceModeStatus } from '@renderer/features/voice/voiceModeStore'

/**
 * Home: the whole screen, built around JARVIS. Greeting and date from this computer's clock, live
 * weather (Open-Meteo), the JARVIS orb (the real Voice Mode), and two small learning cards from saved data.
 */
export function HomeView(): ReactNode {
  return (
    <div className="relative h-full overflow-x-hidden overflow-y-auto">
      <div className="home-ribbons" aria-hidden />
      <div className="relative mx-auto flex min-h-full max-w-[1400px] flex-col px-6 pt-20 pb-6 sm:px-10 lg:px-16">
        <div className="flex flex-wrap items-start justify-between gap-6">
          <Greeting />
          <WeatherCard />
        </div>
        <div className="flex flex-1 flex-col items-center justify-center py-6">
          <Jarvis />
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <TodaysFocus />
          <ContinueLearning />
        </div>
      </div>
    </div>
  )
}

/** "Good morning" etc. from the local hour; refreshed every minute. */
function useNow(): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(t)
  }, [])
  return now
}

function Greeting(): ReactNode {
  const now = useNow()
  const h = now.getHours()
  const part = h >= 5 && h < 12 ? 'Good morning' : h >= 12 && h < 17 ? 'Good afternoon' : h >= 17 && h < 22 ? 'Good evening' : 'Good night'
  return (
    <div>
      <p className="text-xl text-fg/85">{part},</p>
      <h1 className="mt-1 text-4xl font-semibold tracking-tight sm:text-5xl">
        Keep <span style={{ color: 'var(--pink)' }}>going!</span>
      </h1>
      <p className="mt-2 text-base text-muted">Better English. Bigger opportunities.</p>
      <p className="mt-5 flex items-center gap-2 text-sm text-fg/85">
        <CalendarDays className="size-4" />
        {now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
      </p>
    </div>
  )
}

// ---- Weather (Open-Meteo, free, no key). Never invented: errors and missing data are said as such.
const DEFAULT_CITY = 'Dhaka'
const REFRESH_MS = 30 * 60_000

function WeatherIcon({ code, isDay }: { code: number; isDay: boolean }): ReactNode {
  const cls = 'size-7 shrink-0'
  if (code === 0) return isDay ? <Sun className={cls} /> : <MoonStar className={cls} />
  if (code <= 2) return <CloudSun className={cls} />
  if (code === 3) return <Cloud className={cls} />
  if (code === 45 || code === 48) return <CloudFog className={cls} />
  if (code >= 51 && code <= 57) return <CloudDrizzle className={cls} />
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return <CloudRain className={cls} />
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return <CloudSnow className={cls} />
  if (code >= 95) return <CloudLightning className={cls} />
  return <Cloud className={cls} />
}

const fmtTime = (hhmm: string): string => {
  const [h, m] = hhmm.split(':').map(Number)
  return `${((h + 11) % 12) + 1}${m ? `:${String(m).padStart(2, '0')}` : ''} ${h < 12 ? 'AM' : 'PM'}`
}

/** What the forecast says about rain, in words (only from the real hourly data). */
export function rainLine(w: HomeWeather): string {
  if (!w.hourlyAvailable) return 'Rain forecast details unavailable'
  if (!w.rain) return 'No rain expected in the next 18 hours'
  const when = w.rain.tomorrow ? 'tomorrow' : w.localTime.slice(11, 16) >= w.rain.start ? 'now' : 'later'
  if (when === 'now') return `Rain likely until about ${fmtTime(w.rain.end)} (${w.rain.chance}%)`
  return `Rain expected ${when} · ${fmtTime(w.rain.start)}–${fmtTime(w.rain.end)} (${w.rain.chance}%)`
}

function WeatherCard(): ReactNode {
  const savedCity = useVoice((s) => s.settings.city)
  const setSettings = useVoice((s) => s.setSettings)
  const city = savedCity.trim() || DEFAULT_CITY
  const [w, setW] = useState<HomeWeather | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(city)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setW(await invoke('weather:home', { city }))
      setError(null)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setLoading(false)
    }
  }, [city])
  useEffect(() => {
    void load()
    const t = setInterval(() => void load(), REFRESH_MS)
    return () => clearInterval(t)
  }, [load])

  const stale = w && Date.now() - w.fetchedAt > 2 * REFRESH_MS
  return (
    <section aria-label="Weather" className="glass-panel w-full max-w-[360px] rounded-2xl! px-4 py-3">
      {editing ? (
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            setSettings({ city: draft.trim() })
            setEditing(false)
          }}
        >
          <input autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && setEditing(false)} placeholder="City, e.g. Dhaka" aria-label="City" className="glass-field h-8 min-w-0 flex-1 rounded-lg px-2.5 text-sm" />
          <button type="submit" className="btn-burgundy motion-press h-8 rounded-lg px-3 text-xs font-semibold">
            Save
          </button>
        </form>
      ) : (
        <div className="flex items-start gap-3">
          {w ? <WeatherIcon code={w.code} isDay={w.isDay} /> : <Cloud className="size-7 shrink-0 text-muted" />}
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-1.5 text-[15px] font-medium">
              <span className="truncate">{w ? w.place.split(',')[0] : city}</span>
              {!savedCity.trim() && <span className="text-[11px] font-normal text-muted">(default)</span>}
              {w && <span className="text-fg/85">· {Math.round(w.temperature)}°C</span>}
              <button
                onClick={() => (setDraft(city), setEditing(true))}
                aria-label="Change city"
                title="Change city"
                className="motion-press ml-auto flex size-6 shrink-0 items-center justify-center rounded-md text-muted hover:text-fg"
              >
                <Pencil className="size-3" />
              </button>
            </p>
            {w && !error && (
              <>
                <p className="text-xs text-muted">
                  {w.description[0].toUpperCase() + w.description.slice(1)} · feels {Math.round(w.feelsLike)}° · H {Math.round(w.high)}° L {Math.round(w.low)}°
                </p>
                <p className="mt-1 text-xs text-fg/90">{rainLine(w)}</p>
                <p className={cn('mt-1 text-[10.5px]', stale ? 'text-warn' : 'text-muted/80')}>
                  Updated {new Date(w.fetchedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} · Open-Meteo{stale ? ' · may be out of date' : ''}
                </p>
              </>
            )}
            {!w && !error && <p className="text-xs text-muted">{loading ? 'Loading the weather…' : ''}</p>}
            {error && (
              <p className="text-xs text-warn">
                {w ? 'Could not update: ' : 'Weather unavailable: '}
                {error}{' '}
                <button onClick={() => void load()} className="underline">
                  Try again
                </button>
              </p>
            )}
          </div>
        </div>
      )}
    </section>
  )
}

// ---- JARVIS: the real Voice Mode (Gemini Live), shown as the orb.
const STATUS_TEXT: Record<VoiceModeStatus, string> = {
  off: 'Tap to speak',
  connecting: 'Connecting…',
  listening: 'Listening… say what you need',
  thinking: 'Thinking…',
  speaking: 'Speaking…',
  reconnecting: 'Reconnecting…',
  error: 'Tap to try again'
}

function Jarvis(): ReactNode {
  const status = useVoiceMode((s) => s.status)
  const level = useVoiceMode((s) => s.level)
  const error = useVoiceMode((s) => s.error)
  const mode = useVoiceMode((s) => s.mode)
  const lastReply = useVoiceMode((s) => [...s.transcript].reverse().find((t) => t.role === 'model')?.text ?? '')
  const lastHeard = useVoiceMode((s) => [...s.transcript].reverse().find((t) => t.role === 'user')?.text ?? '')
  const active = status !== 'off' && status !== 'error'
  const setPage = useApp((s) => s.setPage)

  // Started from Home, the orb is the interface: the Voice Mode panel stays closed (it would pop up on the
  // next page). It still opens for the one-time consent question; the side button reopens it later.
  const start = (prefer: 'live' | 'basic'): void =>
    void startVoiceMode(prefer).then(() => {
      if (!useVoiceMode.getState().askConsent) useVoiceMode.setState({ open: false })
    })
  const toggle = (): void => {
    if (voiceModeActive()) void endVoiceMode()
    else start('live')
  }
  const lvl = status === 'listening' || status === 'speaking' ? Math.min(1, level * 2.5) : 0
  return (
    <div className="flex flex-col items-center text-center">
      <button
        className="jarvis-orb"
        data-state={status}
        style={{ ['--lvl' as string]: lvl.toFixed(2) }}
        onClick={toggle}
        aria-label={active ? 'Stop JARVIS' : 'Talk to JARVIS'}
        aria-pressed={active}
      >
        <span className="swirl" />
        <span className="swirl-2" />
        <span className="core" />
        <span className="glass" />
      </button>
      <p className="mt-7 text-sm font-semibold tracking-[0.35em] text-[#7fd6ff]">JARVIS</p>
      <span className="mt-1.5 h-[3px] w-20 rounded-full bg-gradient-to-r from-[#ff2dab] to-[#3fd2ff]" aria-hidden />
      <div className="mt-5 flex items-center gap-3">
        <button className="jarvis-mic motion-press" data-active={active} onClick={toggle} aria-label={active ? 'Stop' : 'Tap to speak'} title={active ? 'Stop the conversation' : 'Tap to speak'}>
          {active ? <Square className="size-5 fill-current" /> : <Mic className="size-6" />}
        </button>
      </div>
      <p className="mt-2.5 min-h-5 text-sm text-[#9fdcff]" aria-live="polite">
        {STATUS_TEXT[status]}
        {active && mode === 'basic' ? ' (basic mode)' : ''}
      </p>
      {active && (lastHeard || lastReply) && (
        <div className="mt-2 max-w-xl space-y-1 text-sm">
          {lastHeard && <p className="text-muted">You: {lastHeard}</p>}
          {lastReply && <p className="text-fg/90">JARVIS: {lastReply}</p>}
        </div>
      )}
      {!active && error && (
        <div className="mt-2 max-w-md text-sm text-warn">
          <p>{error.message}</p>
          {error.reason === 'auth' && (
            <div className="mt-2 flex justify-center gap-2">
              <button onClick={() => start('basic')} className="motion-press rounded-lg border border-white/15 px-3 py-1.5 text-xs font-medium text-fg">
                Use basic voice
              </button>
              <button onClick={() => setPage('settings')} className="motion-press rounded-lg border border-white/15 px-3 py-1.5 text-xs font-medium text-fg">
                Open Settings
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ---- Learning cards: only real saved data.
function TodaysFocus(): ReactNode {
  const due = useApp((s) => s.dueCount)
  const setPage = useApp((s) => s.setPage)
  const [room, setRoom] = useState<RoomHome | null>(null)
  useEffect(() => {
    invoke('room:home').then(setRoom, () => setRoom(null))
  }, [])
  // Today's practice: lines reviewed today out of today's reviews (real counts, capped per day).
  const done = room?.reviewedToday ?? 0
  const goal = room ? done + room.queue.length : 0
  const pct = goal ? Math.min(100, Math.round((done / goal) * 100)) : 0
  return (
    <button onClick={() => setPage('room')} className="glass-panel motion-press flex items-center gap-4 rounded-2xl! border-[rgba(255,45,171,0.35)]! p-4 text-left">
      <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-[rgba(255,45,171,0.14)]" style={{ color: 'var(--pink)' }}>
        <Target className="size-6" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[11px] font-semibold tracking-wider uppercase" style={{ color: 'var(--lime)' }}>
          Today&apos;s focus
        </span>
        {room && goal > 0 ? (
          <>
            <span className="mt-0.5 block text-[15px] font-medium">Review {goal} practice lines today</span>
            <span className="mt-2 flex items-center gap-3">
              <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
                <span className="block h-full rounded-full" style={{ width: `${pct}%`, background: 'var(--pink)' }} />
              </span>
              <span className="text-xs text-muted tabular-nums">
                {done}/{goal}
              </span>
            </span>
          </>
        ) : (
          <span className="mt-0.5 block text-[15px] font-medium">{room && room.practisedToday ? "Today's practice is done ✓" : 'Start today’s practice'}</span>
        )}
        {due > 0 && <span className="mt-1 block text-xs text-muted">{due} flashcards due for revision</span>}
      </span>
    </button>
  )
}

function ContinueLearning(): ReactNode {
  const setPage = useApp((s) => s.setPage)
  const [last, setLast] = useState<Article | null | undefined>(undefined)
  useEffect(() => {
    invoke('articles:list').then(
      (list) => setLast([...list].sort((a, b) => b.lastOpenedAt.localeCompare(a.lastOpenedAt))[0] ?? null),
      () => setLast(null)
    )
  }, [])
  const open = (): void => {
    if (last && last.url && /^https?:/.test(last.url)) useArticles.getState().openUrl(last.url)
    setPage('articles')
  }
  return (
    <button onClick={open} className="glass-panel motion-press flex items-center gap-4 rounded-2xl! border-[rgba(212,255,63,0.35)]! p-4 text-left">
      <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-[rgba(212,255,63,0.1)]" style={{ color: 'var(--lime)' }}>
        <BookOpen className="size-6" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[11px] font-semibold tracking-wider uppercase" style={{ color: 'var(--lime)' }}>
          Continue learning
        </span>
        <span className="mt-0.5 block truncate text-[15px] font-medium">{last ? last.title : last === null ? 'Open an article to start reading' : ' '}</span>
        {last && <span className="block truncate text-xs text-muted">Article · {last.domain}</span>}
      </span>
      <ArrowRight className="size-5 shrink-0 text-muted" />
    </button>
  )
}
