import { useEffect, useState, type ReactNode } from 'react'
import { AlertTriangle, AudioLines, ChevronDown, Mic, MicOff, PhoneOff, Play, Send, Settings2, Square, X } from 'lucide-react'
import { useApp } from '@renderer/stores/app'
import { Badge, Button, Input } from '@renderer/components/ui'
import { cn } from '@renderer/lib/cn'
import { useVoice } from './voiceStore'
import { endVoiceMode, initVoiceMode, sendTyped, startVoiceMode, stopAnswer, toggleMute, useVoiceMode, voiceModeActive, type VoiceModeStatus } from './voiceModeStore'
import { useEscape } from '@renderer/lib/navigation'

const systemZone = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone

const LABEL: Record<VoiceModeStatus, string> = {
  off: 'Not listening',
  connecting: 'Connecting…',
  listening: 'Listening…',
  thinking: 'Thinking…',
  speaking: 'Speaking…',
  reconnecting: 'Reconnecting…',
  error: 'Stopped'
}

/** Navigation button: opens Voice Mode; a red dot shows a session is on (the microphone is in use). */
export function VoiceModeButton(): ReactNode {
  const status = useVoiceMode((s) => s.status)
  const open = useVoiceMode((s) => s.open)
  const on = status !== 'off' && status !== 'error'
  return (
    <button
      onClick={() => useVoiceMode.setState({ open: !open })}
      aria-label={on ? `Voice Mode is on (${LABEL[status]})` : 'Voice Mode'}
      title={on ? `Voice Mode is on — ${LABEL[status]}` : 'Voice Mode: talk with the assistant'}
      className={cn(
        'motion-press relative z-10 mb-2 flex size-9 shrink-0 items-center justify-center rounded-xl lg:size-10',
        on ? 'bg-accent text-accent-fg shadow-[0_0_0_4px_rgba(255,45,171,0.28)]' : open ? 'bg-accent-soft text-accent' : 'text-muted hover:bg-white/55 hover:text-fg'
      )}
    >
      <AudioLines className={cn('size-[18px]', on && status === 'speaking' && 'animate-pulse')} />
      {on && <span className="absolute top-1 right-1 size-2 rounded-full bg-[#ff4d6d] ring-2 ring-[#fff]" aria-hidden />}
    </button>
  )
}

/** The Voice Mode panel: start, a clear listening / thinking / speaking state, mute, stop, end. */
export function VoiceModePanel(): ReactNode {
  const s = useVoiceMode()
  const hasKey = useApp((a) => !!a.settings?.hasGeminiKey)
  const [showSettings, setShowSettings] = useState(false)
  const [typed, setTyped] = useState('')

  useEffect(() => initVoiceMode(), [])
  // The command panel and Voice Mode don't overlap.
  useEffect(() => {
    if (s.open) useVoice.getState().setOpen(false)
  }, [s.open])

  // Escape closes the panel (like ×; a running session keeps running, as before).
  useEscape(() => useVoiceMode.setState({ open: false, error: null, activity: null }), s.open)
  if (!s.open) return null
  const active = voiceModeActive()
  const live = s.mode === 'live'
  return (
    <aside aria-label="Voice Mode" className="glass-elevated anim-pop-in fixed bottom-3 left-[72px] z-50 flex max-h-[min(640px,86vh)] w-[min(400px,calc(100vw-90px))] flex-col overflow-hidden rounded-2xl lg:left-[96px]">
      <div className="glass-header flex h-11 shrink-0 items-center gap-2 px-3">
        <AudioLines className="size-4 text-accent" />
        <span className="flex-1 text-sm font-semibold">Voice Mode</span>
        {s.mode && <Badge tone={live ? 'accent' : 'info'}>{live ? 'Live · real-time' : 'Basic · one sentence at a time'}</Badge>}
        <Button size="sm" variant="ghost" icon={<Settings2 className="size-4" />} aria-label="Voice Mode settings" aria-expanded={showSettings} onClick={() => setShowSettings(!showSettings)} />
        <Button size="sm" variant="ghost" icon={<ChevronDown className="size-4" />} aria-label="Hide Voice Mode panel" title="Hide (the session stays on)" onClick={() => useVoiceMode.setState({ open: false })} />
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3 text-sm">
        {showSettings && <SettingsBox />}

        {s.askConsent ? (
          <Consent />
        ) : (
          <>
            <Orb status={s.status} muted={s.muted} level={s.level} />
            <p className="text-center text-xs text-muted">
              {active
                ? live
                  ? s.muted
                    ? 'Muted — the microphone is paused.'
                    : 'Just talk. You can interrupt the answer by speaking.'
                  : 'Say one sentence, then wait for the answer. (Basic mode can’t be interrupted by talking — use Stop.)'
                : 'Press Start and talk — ask about English, the time or the weather, or say “take me to Articles”.'}
            </p>
            {s.model && live && active && <p className="text-center text-[11px] text-muted">Gemini Live · {s.model}</p>}
          </>
        )}

        {s.activity && (
          <p className={cn('rounded-lg px-3 py-1.5 text-xs', s.activity.ok ? 'glass-inset' : 'bg-danger-soft text-danger')} role="status">
            {s.activity.text}
          </p>
        )}

        {s.error && !active && (
          <div className="rounded-xl bg-danger-soft px-3 py-2 text-danger" role="alert">
            <p className="flex gap-2">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <span>{s.error.message}</span>
            </p>
            {s.error.reason !== 'mic' && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {hasKey && s.error.reason !== 'billing' && (
                  <Button size="sm" variant="secondary" onClick={() => void startVoiceMode('live')}>
                    Try again
                  </Button>
                )}
                <Button size="sm" variant="secondary" onClick={() => void startVoiceMode('basic')}>
                  Use Basic voice mode
                </Button>
              </div>
            )}
          </div>
        )}

        {s.transcript.length > 0 && (
          <div>
            <button className="text-xs font-medium text-muted hover:text-fg" aria-expanded={s.settings.showTranscript} onClick={() => s.setSettings({ showTranscript: !s.settings.showTranscript })}>
              {s.settings.showTranscript ? 'Hide transcript' : 'Show transcript'}
            </button>
            {s.settings.showTranscript && (
              <div className="glass-inset mt-1.5 max-h-48 space-y-1.5 overflow-y-auto rounded-xl px-3 py-2 text-xs" aria-label="Voice transcript">
                {s.transcript.map((t, i) => (
                  <p key={i}>
                    <span className="font-semibold text-muted">{t.role === 'user' ? 'You: ' : 'Jarvis: '}</span>
                    {t.text}
                  </p>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {!s.askConsent && (
        <div className="shrink-0 space-y-2 border-t border-line/70 p-2">
          {active && live && (
            <form
              className="flex gap-1.5"
              onSubmit={(e) => {
                e.preventDefault()
                sendTyped(typed)
                setTyped('')
              }}
            >
              <Input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Or type to the assistant (optional)…" aria-label="Type to Voice Mode" className="h-8 text-xs" />
              <Button type="submit" size="sm" variant="ghost" className="h-8 w-8 shrink-0 px-0" aria-label="Send to Voice Mode" disabled={!typed.trim()} icon={<Send className="size-3.5" />} />
            </form>
          )}
          <div className="flex items-center justify-center gap-2">
            {!active ? (
              <>
                <Button variant="primary" icon={<Play className="size-4" />} onClick={() => void startVoiceMode(hasKey ? 'live' : 'basic')}>
                  {hasKey ? 'Start Voice Mode' : 'Start (Basic mode)'}
                </Button>
                <Button variant="ghost" icon={<X className="size-4" />} aria-label="Close Voice Mode" onClick={() => useVoiceMode.setState({ open: false, error: null, activity: null })} />
              </>
            ) : (
              <>
                {live && (
                  <Button variant="secondary" icon={s.muted ? <MicOff className="size-4" /> : <Mic className="size-4" />} aria-pressed={s.muted} onClick={toggleMute}>
                    {s.muted ? 'Unmute' : 'Mute'}
                  </Button>
                )}
                <Button variant="secondary" icon={<Square className="size-3.5" />} disabled={s.status !== 'speaking'} onClick={stopAnswer} title="Stop the answer (the conversation goes on)">
                  Stop answer
                </Button>
                <Button variant="danger" icon={<PhoneOff className="size-4" />} onClick={() => void endVoiceMode()}>
                  End
                </Button>
              </>
            )}
          </div>
        </div>
      )}
    </aside>
  )
}

function Orb({ status, muted, level }: { status: VoiceModeStatus; muted: boolean; level: number }): ReactNode {
  const scale = status === 'listening' && !muted ? 1 + Math.min(0.35, level * 6) : 1
  const label = muted && status === 'listening' ? 'Muted' : LABEL[status]
  return (
    <div className="flex flex-col items-center gap-2 pt-2" aria-live="polite">
      <div className="relative flex size-28 items-center justify-center">
        <span
          aria-hidden
          className={cn(
            'absolute inset-0 rounded-full transition-transform duration-100',
            status === 'speaking' ? 'animate-pulse bg-accent/35' : status === 'thinking' || status === 'connecting' || status === 'reconnecting' ? 'animate-spin bg-[conic-gradient(var(--accent),transparent_70%)] opacity-60' : status === 'listening' && !muted ? 'bg-accent/20' : 'bg-white/10'
          )}
          style={{ transform: `scale(${scale})` }}
        />
        <span
          className={cn(
            'relative flex size-20 items-center justify-center rounded-full text-[#fff] shadow-[0_6px_24px_rgba(255,45,171,0.35)]',
            status === 'off' || status === 'error' || muted ? 'bg-[#5b5560]' : 'bg-[linear-gradient(145deg,#ff5cbe,#ff2dab)]'
          )}
        >
          {muted ? <MicOff className="size-8" /> : status === 'speaking' ? <AudioLines className="size-8" /> : <Mic className="size-8" />}
        </span>
      </div>
      <p className="text-base font-semibold" data-voice-state={muted && status === 'listening' ? 'muted' : status}>
        {label}
      </p>
    </div>
  )
}

function Consent(): ReactNode {
  return (
    <div className="space-y-2.5">
      <p className="font-semibold">Before the first conversation</p>
      <ul className="list-disc space-y-1 pl-4 text-xs text-muted">
        <li>Voice Mode streams your microphone sound to Google’s Gemini Live API while a session is on (only after you press Start; End stops it at once). Your API key stays in the app’s secure part.</li>
        <li>It uses your Gemini key’s free tier. Free use is limited (few sessions at a time, a daily limit, about 15 minutes per conversation) and Google may change it. The app never turns on billing.</li>
        <li>If your Google project ever had billing switched on, Google would charge about $0.005 per minute of your speech and $0.018 per minute of answers.</li>
        <li>Basic voice mode works without sending sound to Live: Windows recognizes speech offline (questions may still use Gemini if allowed).</li>
      </ul>
      <div className="flex flex-wrap gap-1.5">
        <Button
          variant="primary"
          onClick={() => {
            useVoiceMode.getState().setSettings({ consented: true })
            void startVoiceMode('live')
          }}
        >
          Agree and start
        </Button>
        <Button variant="secondary" onClick={() => void startVoiceMode('basic')}>
          Use Basic mode
        </Button>
        <Button variant="ghost" onClick={() => useVoiceMode.setState({ askConsent: false })}>
          Cancel
        </Button>
      </div>
    </div>
  )
}

function SettingsBox(): ReactNode {
  const { settings, setSettings } = useVoiceMode()
  const city = useVoice((v) => v.settings.city)
  return (
    <div className="glass-inset space-y-2.5 rounded-xl px-3 py-2.5 text-sm">
      <label className="block">
        <span className="block font-medium">Weather city</span>
        <Input value={city} onChange={(e) => useVoice.getState().setSettings({ city: e.target.value })} placeholder="e.g. Dhaka" className="mt-1 h-8 text-sm" />
        <span className="mt-0.5 block text-xs text-muted">Live weather from Open-Meteo (free). Without a city, the assistant asks you.</span>
      </label>
      <label className="block">
        <span className="block font-medium">Time zone</span>
        <Input value={settings.timezone} onChange={(e) => setSettings({ timezone: e.target.value.trim() })} placeholder={`This computer: ${systemZone()}`} className="mt-1 h-8 text-sm" />
        <span className="mt-0.5 block text-xs text-muted">Leave empty to use this computer’s clock and zone. Example: Asia/Dhaka.</span>
      </label>
      <p className="text-xs text-muted">Applies from the next Start.</p>
    </div>
  )
}
