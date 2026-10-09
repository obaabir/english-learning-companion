import { useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { Check, Headphones, Loader2, Lightbulb, Mic, MicOff, Play, RotateCcw, Square, Volume2, X } from 'lucide-react'
import { formatTimestamp, type PracticeRating, type PracticeStats, type PronounceResult, type SubtitleLine } from '@shared/types'
import { invoke } from '@renderer/lib/api'
import { useApp } from '@renderer/stores/app'
import { Button } from '@renderer/components/ui'
import { cn } from '@renderer/lib/cn'
import { CountPicker } from './PracticeControls'
import { PracticeContext, playSegment, recordFor, usePractice } from './practiceCore'
import { matchHeard } from './practiceLogic'
import { recordingToWavBase64 } from './audio'


type SpeechRecognitionCtor = new () => {
  lang: string
  interimResults: boolean
  continuous: boolean
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null
  onerror: ((e: { error: string }) => void) | null
  onend: (() => void) | null
  start(): void
  stop(): void
  abort(): void
}

function speechRecognition(): SpeechRecognitionCtor | null {
  const w = window as unknown as { SpeechRecognition?: SpeechRecognitionCtor; webkitSpeechRecognition?: SpeechRecognitionCtor }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

/** One-line reason why the mic can't be used, from a recognition/permission error. */
function micReason(error: string): string {
  if (error === 'network' || error === 'service-not-allowed')
    return "Speech recognition needs Google's online service, which this desktop app can't use. Using Self-check instead."
  if (error === 'not-allowed') return 'Microphone permission was denied. Using Self-check instead.'
  if (error === 'audio-capture' || error === 'no-mic') return 'No microphone was found. Using Self-check instead.'
  if (error === 'unsupported') return "Speech recognition isn't available here. Using Self-check instead."
  return `Speech recognition failed (${error}). Using Self-check instead.`
}

/** Voice panel for Speak ×N on one subtitle line. */
export function SpeakPanel({ line }: { line: SubtitleLine }): ReactNode {
  const practice = useContext(PracticeContext)
  const total = usePractice((s) => s.speakCount)
  const { openSpeak, setSpeakCount } = usePractice.getState()
  const { toastError } = useApp.getState()
  const words = line.text.split(/\s+/).filter(Boolean)
  const [pron, setPron] = useState<PronounceResult | null>(null)
  const [stats, setStats] = useState<PracticeStats | null>(null)
  const hasKey = useApp((s) => !!s.settings?.hasGeminiKey)
  // Desktop app: Chrome's speech service isn't available, so Gemini listens to the recording instead.
  const aiEar = hasKey && navigator.userAgent.includes('Electron') && typeof MediaRecorder !== 'undefined'
  const canMic = aiEar || !!speechRecognition()
  const [mode, setMode] = useState<'mic' | 'selfcheck'>(canMic ? 'mic' : 'selfcheck')
  const [reason, setReason] = useState<string | null>(canMic ? null : micReason('unsupported'))
  const [aiThinking, setAiThinking] = useState(false)
  const [heardText, setHeardText] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0) // attempts finished
  const [listening, setListening] = useState(false)
  const [heard, setHeard] = useState<boolean[] | null>(null)
  const [retryGrey, setRetryGrey] = useState(false)
  const [recording, setRecording] = useState<string | null>(null)
  const [rating, setRating] = useState<PracticeRating | null>(null)
  const [englishVoice, setEnglishVoice] = useState<SpeechSynthesisVoice | null>(null)
  const [busy, setBusy] = useState<'listen' | 'compare' | null>(null)
  const stopRef = useRef<(() => void) | null>(null)
  const cancelPlay = useRef(false)

  const finalAttempt = attempt === total - 1 && !retryGrey
  const finished = attempt >= total

  useEffect(() => {
    void invoke('practice:pronounce', line.text).then(setPron).catch(() => setPron({ words: [], tips: [] }))
    void invoke('practice:stats').then(setStats).catch(() => undefined)
    // Text-to-speech fallback only if an English voice exists.
    const pick = (): void => setEnglishVoice(speechSynthesis.getVoices().find((v) => /^en/i.test(v.lang)) ?? null)
    pick()
    speechSynthesis.addEventListener?.('voiceschanged', pick)
    return () => {
      speechSynthesis.removeEventListener?.('voiceschanged', pick)
      stopRef.current?.()
      cancelPlay.current = true
    }
  }, [line.text])

  // Recordings stay in memory only; free them when replaced or closed.
  useEffect(() => () => void (recording && URL.revokeObjectURL(recording)), [recording])

  const listen = async (): Promise<void> => {
    if (!practice) return
    setBusy('listen')
    cancelPlay.current = false
    try {
      await playSegment(practice.player, line, 1, () => cancelPlay.current)
      await practice.player.pause()
      recordFor(line, { listenReps: 1 })
    } catch (err) {
      toastError(err)
    } finally {
      setBusy(null)
    }
  }

  const speakTts = (): void => {
    if (!englishVoice) return
    const u = new SpeechSynthesisUtterance(line.text)
    u.voice = englishVoice
    u.lang = englishVoice.lang
    speechSynthesis.cancel()
    speechSynthesis.speak(u)
  }

  const compare = async (): Promise<void> => {
    if (!practice || !recording) return
    setBusy('compare')
    cancelPlay.current = false
    try {
      await playSegment(practice.player, line, 1, () => cancelPlay.current)
      await practice.player.pause()
      await new Promise<void>((resolve) => {
        const a = new Audio(recording)
        a.onended = () => resolve()
        a.onerror = () => resolve()
        void a.play().catch(() => resolve())
      })
    } catch (err) {
      toastError(err)
    } finally {
      setBusy(null)
    }
  }

  const switchToSelfCheck = (why: string): void => {
    setMode('selfcheck')
    setReason(micReason(why))
    setListening(false)
  }

  /** Gemini listens: record until stop (or a time limit), then Gemini writes down what it heard. */
  const startAiMic = async (): Promise<void> => {
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch (err) {
      return switchToSelfCheck((err as Error).name === 'NotAllowedError' ? 'not-allowed' : 'no-mic')
    }
    const target = retryGrey && heard ? words.filter((_, i) => !heard[i]) : words
    const retry = retryGrey
    const chunks: Blob[] = []
    const recorder = new MediaRecorder(stream)
    recorder.addEventListener('dataavailable', (e) => chunks.push(e.data))
    const lineSec = Math.max(0, (line.end ?? 0) - (line.start ?? 0))
    const autoStop = setTimeout(() => recorder.state === 'recording' && recorder.stop(), Math.max(4000, lineSec * 2500 + 2500))
    recorder.addEventListener('stop', () => {
      clearTimeout(autoStop)
      stream.getTracks().forEach((t) => t.stop())
      stopRef.current = null
      setListening(false)
      const blob = new Blob(chunks, { type: recorder.mimeType })
      setRecording(URL.createObjectURL(blob))
      setAiThinking(true)
      void (async () => {
        try {
          const text = await invoke('practice:transcribeSpeech', { audioBase64: await recordingToWavBase64(blob), mimeType: 'audio/wav' })
          setHeardText(text)
          setHeard((prev) => mergeHeard(prev, matchHeard(target, text), retry))
          if (!retry) {
            setAttempt((a) => a + 1)
            recordFor(line, { speakReps: 1 })
          }
          setRetryGrey(false)
        } catch (err) {
          toastError(err)
        } finally {
          setAiThinking(false)
        }
      })()
    })
    stopRef.current = () => recorder.state === 'recording' && recorder.stop()
    if (!retry) setHeard(words.map(() => false))
    setHeardText(null)
    setListening(true)
    recorder.start()
  }

  const startMic = async (): Promise<void> => {
    if (aiEar) return startAiMic()
    const SR = speechRecognition()
    if (!SR) return switchToSelfCheck('unsupported')
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch (err) {
      return switchToSelfCheck((err as Error).name === 'NotAllowedError' ? 'not-allowed' : 'no-mic')
    }
    const target = retryGrey && heard ? words.filter((_, i) => !heard[i]) : words
    const chunks: Blob[] = []
    const recorder = typeof MediaRecorder !== 'undefined' ? new MediaRecorder(stream) : null
    recorder?.addEventListener('dataavailable', (e) => chunks.push(e.data))
    recorder?.addEventListener('stop', () => {
      stream.getTracks().forEach((t) => t.stop())
      if (chunks.length) setRecording(URL.createObjectURL(new Blob(chunks, { type: recorder.mimeType })))
    })
    const rec = new SR()
    rec.lang = 'en-US'
    rec.interimResults = true
    rec.continuous = false
    let transcript = ''
    let failed: string | null = null
    rec.onresult = (e) => {
      transcript = Array.from(e.results)
        .map((r) => r[0].transcript)
        .join(' ')
      const live = matchHeard(target, transcript)
      setHeard((prev) => mergeHeard(prev, live, retryGrey))
    }
    rec.onerror = (e) => {
      if (e.error !== 'no-speech' && e.error !== 'aborted') failed = e.error
    }
    rec.onend = () => {
      if (recorder?.state === 'recording') recorder.stop()
      else stream.getTracks().forEach((t) => t.stop())
      setListening(false)
      stopRef.current = null
      if (failed) return switchToSelfCheck(failed)
      const final = matchHeard(target, transcript)
      setHeard((prev) => mergeHeard(prev, final, retryGrey))
      if (!retryGrey) {
        setAttempt((a) => a + 1)
        recordFor(line, { speakReps: 1 })
      }
      setRetryGrey(false)
    }
    stopRef.current = () => rec.stop()
    setListening(true)
    if (!retryGrey) setHeard(words.map(() => false))
    recorder?.start()
    rec.start()
  }

  /** In retry mode only the grey words are re-checked; earlier green words stay green. */
  function mergeHeard(prev: boolean[] | null, now: boolean[], retry: boolean): boolean[] {
    if (!retry || !prev) return now
    const out = [...prev]
    let k = 0
    prev.forEach((h, i) => {
      if (!h) out[i] = now[k++] ?? false
    })
    return out
  }

  const selfCheckDone = (): void => {
    setAttempt((a) => a + 1)
    recordFor(line, { speakReps: 1 })
  }

  const rate = (r: PracticeRating): void => {
    setRating(r)
    recordFor(line, { rating: r })
    void invoke('practice:stats').then(setStats).catch(() => undefined)
  }

  const restart = (): void => {
    setAttempt(0)
    setHeard(null)
    setRating(null)
    setRetryGrey(false)
  }

  const greyCount = heard ? heard.filter((h) => !h).length : 0
  const hideText = finalAttempt && !finished && (listening || attempt === total - 1)

  return (
    <aside
      aria-label="Speak practice"
      className="glass-elevated anim-pop-in absolute inset-y-2 right-2 z-40 flex w-[min(420px,calc(100%-1rem))] flex-col overflow-hidden"
    >
      <div className="glass-header flex h-12 shrink-0 items-center gap-2 rounded-t-2xl px-4">
        <Mic className="size-4 text-rose" />
        <h2 className="text-sm font-semibold">Speak ×{total}</h2>
        <CountPicker value={total} onChange={(c) => (setSpeakCount(c), restart())} label="Speak count" />
        {stats && (
          <span className="ml-auto hidden text-[11px] text-muted sm:inline" title="Your practice so far">
            {stats.linesPractised} lines · {stats.listenReps} listens · {stats.speakReps} speaks
          </span>
        )}
        <Button variant="ghost" size="sm" className={stats ? '' : 'ml-auto'} icon={<X className="size-4" />} onClick={() => openSpeak(null)} aria-label="Close" />
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
        {/* The line: words light up green as they're understood; hidden on the from-memory attempt. */}
        <div>
          {hideText ? (
            <p className="rounded-xl bg-accent-soft px-3 py-3 text-center text-sm font-medium text-accent">Final attempt: say it from memory 🙂</p>
          ) : (
            <p className="text-[17px] leading-relaxed font-medium">
              {words.map((w, i) => (
                <span
                  key={i}
                  className={cn(
                    'motion-hover rounded px-0.5',
                    heard?.[i] === true && 'bg-[rgba(31,122,58,0.12)] text-[#1f7a3a]',
                    heard?.[i] === false && !listening && 'text-muted/70'
                  )}
                >
                  {w}{' '}
                </span>
              ))}
            </p>
          )}
          {pron && !hideText && (
            <div className="mt-2 space-y-0.5 text-sm">
              <p className="text-muted">
                /{pron.words.map((w) => w.ipa ?? w.word).join(' ')}/
              </p>
              <p className="text-xs text-muted">উচ্চারণের ধারণা: {pron.words.map((w) => w.bangla ?? w.word).join(' ')}</p>
            </div>
          )}
          <p className="mt-1 text-[11px] text-muted tabular-nums">
            {line.mediaTitle} · {formatTimestamp(line.start)}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button icon={<Headphones className="size-4" />} loading={busy === 'listen'} onClick={() => void listen()} disabled={!practice || busy !== null}>
            Listen
          </Button>
          {englishVoice && (
            <Button variant="ghost" icon={<Volume2 className="size-4" />} onClick={speakTts} title={`Read aloud with ${englishVoice.name}`}>
              Voice
            </Button>
          )}
          {recording && (
            <Button variant="ghost" icon={<Play className="size-4" />} loading={busy === 'compare'} onClick={() => void compare()} disabled={busy !== null}>
              Original, then me
            </Button>
          )}
        </div>

        {/* Attempts */}
        <div className="glass-inset rounded-xl p-3">
          <div className="mb-3 flex items-center gap-1.5" aria-label={`Attempt ${Math.min(attempt + 1, total)} of ${total}`}>
            {Array.from({ length: total }, (_, i) => (
              <span key={i} className={cn('size-2.5 rounded-full transition-colors', i < attempt ? 'bg-accent' : i === attempt && !finished ? 'bg-rose/60' : 'bg-line')} />
            ))}
            <span className="ml-auto text-xs text-muted tabular-nums">
              {finished ? 'Done' : `Attempt ${attempt + 1} of ${total}`}
            </span>
          </div>

          {reason && (
            <p className="mb-2 flex items-start gap-1.5 text-xs text-warn">
              <MicOff className="mt-0.5 size-3.5 shrink-0" /> {reason}
            </p>
          )}

          {!finished && mode === 'mic' && (
            <div className="flex flex-col items-center gap-2">
              {aiThinking ? (
                <Button variant="secondary" className="h-12 w-full text-base" icon={<Loader2 className="size-4 animate-spin" />} disabled>
                  Gemini is listening to your recording…
                </Button>
              ) : listening ? (
                <Button variant="primary" className="h-12 w-full text-base" icon={<Square className="size-4" />} onClick={() => stopRef.current?.()}>
                  Listening… tap to stop
                </Button>
              ) : (
                <Button variant="primary" className="h-12 w-full text-base" icon={<Mic className="size-5" />} onClick={() => void startMic()}>
                  {retryGrey ? 'Say the grey words' : 'Speak'}
                </Button>
              )}
            </div>
          )}

          {!finished && mode === 'selfcheck' && (
            <Button variant="primary" className="h-12 w-full text-base" icon={<Check className="size-5" />} onClick={selfCheckDone}>
              I said it ({attempt + 1}/{total})
            </Button>
          )}

          {heard && !listening && mode === 'mic' && attempt > 0 && (
            <div className="mt-3 text-xs">
              <p className="text-muted">
                The app understood {heard.length - greyCount} of {heard.length} words (green). This shows what speech recognition heard; it can&apos;t judge pronunciation exactly.
              </p>
              {heardText !== null && (
                <p className="mt-1 text-muted">
                  Gemini heard: <span className="text-fg">“{heardText || '…nothing clear'}”</span>
                </p>
              )}
              {greyCount > 0 && !finished && (
                <Button size="sm" className="mt-2" icon={<RotateCcw className="size-3.5" />} onClick={() => setRetryGrey(true)}>
                  Retry grey words
                </Button>
              )}
            </div>
          )}

          {finished && (
            <div className="mt-1">
              <p className="mb-2 text-sm font-medium">How did it feel?</p>
              <div className="grid grid-cols-3 gap-2">
                {(['Easy', 'OK', 'Hard'] as PracticeRating[]).map((r) => (
                  <Button key={r} variant={rating === r ? 'primary' : 'secondary'} className="h-10" onClick={() => rate(r)}>
                    {r}
                  </Button>
                ))}
              </div>
              {rating === 'Hard' && <p className="mt-2 text-xs text-muted">Added to your Hard lines review list.</p>}
              <Button size="sm" variant="ghost" className="mt-2" icon={<RotateCcw className="size-3.5" />} onClick={restart}>
                Practise again
              </Button>
            </div>
          )}
        </div>

        {/* Bangla sound-trap tips */}
        {pron && pron.tips.length > 0 && (
          <div>
            <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold tracking-wide text-muted uppercase">
              <Lightbulb className="size-3.5 text-rose" /> Sound tips
            </p>
            <ul className="space-y-1.5 text-sm">
              {pron.tips.map((t, i) => (
                <li key={i} className="rounded-lg bg-white/55 px-2.5 py-1.5">
                  {t.tip}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Review list */}
        {stats && stats.hardLines.length > 0 && (
          <details className="text-sm">
            <summary className="cursor-pointer text-xs font-semibold tracking-wide text-muted uppercase">Hard lines to review ({stats.hardLines.length})</summary>
            <ul className="mt-2 space-y-1">
              {stats.hardLines.map((h) => (
                <li key={h.lineKey}>
                  <button
                    className="motion-hover w-full rounded-lg px-2 py-1.5 text-left hover:bg-white/70"
                    onClick={() =>
                      openSpeak({ id: h.lineKey, text: h.text, start: h.start, end: h.end, mediaPath: h.mediaPath ?? '', mediaTitle: h.mediaTitle ?? '' })
                    }
                  >
                    <span className="block truncate">{h.text}</span>
                    <span className="text-[11px] text-muted">
                      {h.mediaTitle} · {formatTimestamp(h.start)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </aside>
  )
}
