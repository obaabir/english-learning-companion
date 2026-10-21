import { useEffect, useState, type ReactNode } from 'react'
import { AlertTriangle, CheckCircle2, Loader2, Mic, MicOff, Send, Settings2, Square, X } from 'lucide-react'
import { isWakeOnly, VOICE_EXAMPLES } from '@shared/voice'
import { invoke, on, errorMessage } from '@renderer/lib/api'
import { useApp } from '@renderer/stores/app'
import { recordingToWavBase64 } from '@renderer/features/practice/audio'
import { Markdown } from '@renderer/components/Markdown'
import { Badge, Button, Input } from '@renderer/components/ui'
import { cn } from '@renderer/lib/cn'
import { currentSelection, handleText, runAction } from './voiceActions'
import { normalizeWav, recordCommand, speak, stopSpeaking, useVoice } from './voiceStore'
import { voiceModeActive } from './voiceModeStore'
import { useEscape } from '@renderer/lib/navigation'

let stopRecording: (() => void) | null = null

/**
 * Listens for ONE command: only after the mic button is pressed (or Alt+J, or "Hey Jarvis" when that
 * mode is on). Windows recognizes it offline; Gemini helps only if Windows can't match it.
 */
/** "Hey Jarvis" was heard on its own: answer "Yes?" so the user knows to go on. */
async function acknowledgeWake(text: string, engine: 'windows' | 'gemini' | 'none'): Promise<void> {
  const v = useVoice.getState()
  v.patch({ open: true, heard: { text, engine }, reply: 'Yes?', status: 'success', clarify: null, confirm: null })
  if (v.settings.speak) await speak('Yes?')
  // A short pause so the end of "Yes?" isn't recorded as the start of the command.
  await new Promise((r) => setTimeout(r, 250))
}

/** followUp: this listen comes right after "Hey Jarvis" (so the wake phrase alone won't start another). */
export async function listenOnce(followUp = false): Promise<void> {
  // Voice Mode is already listening: one microphone user at a time.
  if (voiceModeActive()) return
  const v = useVoice.getState()
  if (v.status === 'listening') {
    stopRecording?.()
    return
  }
  stopSpeaking()
  // "This" = what was selected when you asked (clicking around afterwards doesn't change it).
  const selection = currentSelection()
  v.patch({ open: true, status: 'listening', heard: null, reply: null, clarify: null, confirm: null })
  try {
    const rec = recordCommand()
    stopRecording = rec.stop
    const blob = await rec.done
    stopRecording = null
    if (!blob) {
      useVoice.getState().patch({ status: 'error', reply: "I didn't hear anything. Press the mic and speak, or type the command below." })
      return
    }
    useVoice.getState().patch({ status: 'processing' })
    const audioBase64 = normalizeWav(await recordingToWavBase64(blob))
    const r = await invoke('voice:recognize', { audioBase64, allowGemini: useVoice.getState().settings.gemini && !!useApp.getState().settings?.hasGeminiKey })
    // Only "Hey Jarvis": reply and keep listening for the actual command (once).
    if (!followUp && isWakeOnly(r.text)) {
      await acknowledgeWake(r.text, r.engine)
      return listenOnce(true)
    }
    await handleText(r.text, r.engine, selection)
  } catch (err) {
    stopRecording = null
    const msg = errorMessage(err)
    useVoice.getState().patch({
      status: 'error',
      reply: /permission|notallowed|denied|not allowed|could not start|NotFound/i.test(msg)
        ? 'The microphone is not available (no permission or no microphone). You can still type commands below.'
        : msg
    })
  }
}

/** Mic button in the navigation: shows listening / processing / success / error. */
export function MicButton(): ReactNode {
  const status = useVoice((s) => s.status)
  const wake = useVoice((s) => s.wake)
  const label = status === 'listening' ? 'Listening… (click to stop)' : status === 'processing' ? 'Working…' : 'Voice command (Alt+J)'
  return (
    <button
      onClick={() => void listenOnce()}
      onContextMenu={(e) => {
        e.preventDefault()
        useVoice.getState().setOpen(!useVoice.getState().open)
      }}
      aria-label={label}
      title={`${label} · right-click for the voice panel`}
      className={cn(
        'motion-press relative z-10 mb-2 flex size-9 shrink-0 items-center justify-center rounded-xl lg:size-10',
        status === 'listening' ? 'bg-accent text-accent-fg shadow-[0_0_0_4px_rgba(255,45,171,0.28)]' : status === 'processing' ? 'text-accent' : status === 'error' ? 'text-danger' : status === 'success' ? 'text-[#52d6a0]' : 'text-muted hover:bg-white/55 hover:text-fg'
      )}
    >
      {status === 'processing' ? <Loader2 className="size-[18px] animate-spin" /> : status === 'error' ? <MicOff className="size-[18px]" /> : <Mic className={cn('size-[18px]', status === 'listening' && 'animate-pulse')} />}
      {wake === 'on' && <span className="absolute top-1 right-1 size-2 rounded-full bg-[#52d6a0]" aria-label="Hey Jarvis is listening" />}
    </button>
  )
}

/** The voice panel: what was heard, the answer, questions back, confirmation, typed commands, settings. */
export function VoiceAssistant(): ReactNode {
  const v = useVoice()
  const [typed, setTyped] = useState('')
  const [showSettings, setShowSettings] = useState(false)

  // Alt+J: listen for one command.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.altKey && (e.key === 'j' || e.key === 'J')) {
        e.preventDefault()
        void listenOnce()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // "Hey Jarvis": events from the offline Windows listener (only while switched on).
  useEffect(() => {
    const offHeard = on('voice:wakeHeard', ({ text }) => {
      const s = useVoice.getState()
      if (s.status === 'listening' || s.status === 'processing' || voiceModeActive()) return
      if (isWakeOnly(text)) {
        void acknowledgeWake(text, 'windows').then(() => listenOnce(true))
      } else {
        s.patch({ open: true })
        void handleText(text, 'windows')
      }
    })
    const offState = on('voice:wakeState', ({ state, message }) =>
      useVoice.getState().patch({ wake: state === 'ready' ? 'on' : state === 'error' ? 'error' : 'off', wakeMessage: message ?? null })
    )
    if (useVoice.getState().settings.wakeOnStart) void setWake(true)
    return () => {
      offHeard()
      offState()
    }
  }, [])

  // Escape closes the panel (like ×).
  useEscape(() => (stopSpeaking(), v.setOpen(false)), v.open)
  if (!v.open) return null
  const submitTyped = (): void => {
    if (!typed.trim()) return
    void handleText(typed, 'typed')
    setTyped('')
  }
  return (
    <aside aria-label="Voice assistant" className="glass-elevated anim-pop-in fixed bottom-3 left-[72px] z-50 flex max-h-[min(560px,80vh)] w-[min(380px,calc(100vw-90px))] flex-col overflow-hidden rounded-2xl lg:left-[96px]">
      <div className="glass-header flex h-11 shrink-0 items-center gap-2 px-3">
        <StatusIcon status={v.status} />
        <span className="flex-1 text-sm font-semibold">{v.status === 'listening' ? 'Listening…' : v.status === 'processing' ? 'Working…' : 'Voice assistant'}</span>
        <Button size="sm" variant="ghost" icon={<Settings2 className="size-4" />} aria-label="Voice settings" aria-expanded={showSettings} onClick={() => setShowSettings(!showSettings)} />
        <Button size="sm" variant="ghost" icon={<X className="size-4" />} aria-label="Close voice panel" onClick={() => (stopSpeaking(), v.setOpen(false))} />
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3 text-sm">
        {showSettings && <VoiceSettingsBox />}
        {v.status === 'listening' && (
          <div className="flex items-center gap-2">
            <span className="flex gap-1">
              {[0, 1, 2].map((i) => (
                <span key={i} className="size-2 animate-bounce rounded-full bg-accent" style={{ animationDelay: `${i * 120}ms` }} />
              ))}
            </span>
            <span className="text-muted">Speak now — it stops when you pause.</span>
            <Button size="sm" variant="ghost" icon={<Square className="size-3.5" />} onClick={() => stopRecording?.()}>
              Stop
            </Button>
          </div>
        )}
        {v.heard && (
          <p>
            <span className="text-muted">You: </span>“{v.heard.text || '…'}”{' '}
            <Badge tone={v.heard.engine === 'gemini' ? 'warn' : 'info'}>{v.heard.engine === 'windows' ? 'Windows (offline)' : v.heard.engine === 'gemini' ? 'Gemini' : v.heard.engine === 'typed' ? 'typed' : '—'}</Badge>
          </p>
        )}
        {v.reply && (
          <div className={cn('rounded-xl px-3 py-2', v.status === 'error' ? 'bg-danger-soft text-danger' : 'glass-inset')}>
            {v.reply.length > 160 || v.reply.includes('\n') ? <Markdown text={v.reply} /> : <p>{v.reply}</p>}
          </div>
        )}
        {v.clarify && (
          <div className="flex flex-wrap gap-1.5">
            {v.clarify.options.map((o) => (
              <Button
                key={o.label}
                size="sm"
                variant="secondary"
                onClick={() => {
                  const sel = currentSelection()
                  useVoice.getState().patch({ clarify: null, status: 'processing' })
                  void runAction(o.action, sel)
                    .then((r) => r && (useVoice.getState().patch({ status: r.ok ? 'success' : 'error', reply: r.reply }), useVoice.getState().settings.speak && r.say !== '' && void speak(r.say ?? r.reply)))
                    .catch((err) => useVoice.getState().patch({ status: 'error', reply: errorMessage(err) }))
                }}
              >
                {o.label}
              </Button>
            ))}
          </div>
        )}
        {v.confirm && (
          <div className="rounded-xl border border-danger/40 bg-danger-soft px-3 py-2">
            <p className="text-danger">{v.confirm.question}</p>
            <div className="mt-2 flex gap-2">
              <Button
                size="sm"
                variant="danger"
                onClick={() => {
                  const c = useVoice.getState().confirm!
                  useVoice.getState().patch({ confirm: null, status: 'processing' })
                  void c
                    .run()
                    .then((reply) => useVoice.getState().patch({ status: 'success', reply }))
                    .catch((err) => useVoice.getState().patch({ status: 'error', reply: errorMessage(err) }))
                }}
              >
                {v.confirm.confirmLabel}
              </Button>
              <Button size="sm" variant="secondary" onClick={() => useVoice.getState().patch({ confirm: null, status: 'idle', reply: 'Cancelled — nothing was deleted.' })}>
                Cancel
              </Button>
            </div>
          </div>
        )}
        {!v.heard && !v.reply && v.status !== 'listening' && (
          <div className="text-xs text-muted">
            <p className="mb-1">Press the mic (or Alt+J) and say a command, e.g.:</p>
            <ul className="space-y-0.5">
              {VOICE_EXAMPLES.slice(0, 8).map((e) => (
                <li key={e}>• {e}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
      <div className="shrink-0 border-t border-line/70 p-2">
        <form
          className="flex gap-1.5"
          onSubmit={(e) => {
            e.preventDefault()
            submitTyped()
          }}
        >
          <Input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={v.awaitingCity ? 'City name…' : 'Type a command or question…'} aria-label="Type a command" className="h-9 text-sm" />
          <Button type="submit" variant="primary" className="h-9 w-9 shrink-0 px-0" aria-label="Run command" disabled={!typed.trim()}>
            <Send className="size-4 shrink-0" />
          </Button>
          <Button type="button" variant={v.status === 'listening' ? 'primary' : 'secondary'} className="h-9 w-9 shrink-0 px-0" aria-label="Speak a command" onClick={() => void listenOnce()}>
            <Mic className="size-4 shrink-0" />
          </Button>
        </form>
      </div>
    </aside>
  )
}

function StatusIcon({ status }: { status: string }): ReactNode {
  if (status === 'listening') return <Mic className="size-4 animate-pulse text-accent" />
  if (status === 'processing') return <Loader2 className="size-4 animate-spin text-accent" />
  if (status === 'success') return <CheckCircle2 className="size-4 text-[#52d6a0]" />
  if (status === 'error') return <AlertTriangle className="size-4 text-danger" />
  return <Mic className="size-4 text-muted" />
}

async function setWake(on: boolean): Promise<void> {
  useVoice.getState().patch({ wake: on ? 'starting' : 'off', wakeMessage: null })
  try {
    const r = await invoke('voice:wake', { on })
    if (!on || !r.running) useVoice.getState().patch({ wake: 'off' })
  } catch (err) {
    useVoice.getState().patch({ wake: 'error', wakeMessage: errorMessage(err) })
  }
}

function VoiceSettingsBox(): ReactNode {
  const { settings, setSettings, wake, wakeMessage } = useVoice()
  const hasKey = useApp((s) => !!s.settings?.hasGeminiKey)
  const row = (checked: boolean, onChange: (v: boolean) => void, title: string, desc: string, disabled = false): ReactNode => (
    <label className={cn('flex cursor-pointer items-start gap-2', disabled && 'opacity-50')}>
      <input type="checkbox" className="mt-0.5 size-4 accent-[var(--accent)]" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span>
        <span className="block font-medium">{title}</span>
        <span className="block text-xs text-muted">{desc}</span>
      </span>
    </label>
  )
  return (
    <div className="glass-inset space-y-2.5 rounded-xl px-3 py-2.5">
      {row(
        wake === 'on' || wake === 'starting',
        (on) => void setWake(on),
        `“Hey Jarvis” ${wake === 'on' ? '(listening)' : wake === 'starting' ? '(starting…)' : ''}`,
        'While on, Windows listens on this computer (offline) for “Hey Jarvis”. Nothing is recorded or sent anywhere. A green dot on the mic shows it is on.'
      )}
      {wakeMessage && <p className="text-xs text-danger">{wakeMessage}</p>}
      {row(settings.wakeOnStart, (v) => setSettings({ wakeOnStart: v }), 'Turn on “Hey Jarvis” when the app opens', 'Off by default.')}
      {row(settings.speak, (v) => setSettings({ speak: v }), 'Speak answers', 'Free Windows voice (English).')}
      {row(
        settings.gemini && hasKey,
        (v) => setSettings({ gemini: v }),
        'Use Gemini when Windows doesn’t understand',
        hasKey ? 'For questions and unclear speech. Uses your free Gemini quota; the clip is sent to Google.' : 'Add a Gemini key in Settings to use this.',
        !hasKey
      )}
      <label className="block">
        <span className="block font-medium">Weather city</span>
        <Input value={settings.city} onChange={(e) => setSettings({ city: e.target.value })} placeholder="e.g. Dhaka" className="mt-1 h-8 text-sm" />
        <span className="mt-0.5 block text-xs text-muted">Weather is free from Open-Meteo (needs internet).</span>
      </label>
    </div>
  )
}
