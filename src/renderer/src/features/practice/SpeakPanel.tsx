import { useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { Check, CircleHelp, Loader2, Mic, Minus, Play, Plus, SkipForward, Square, Undo2, X } from 'lucide-react'
import type { PronounceResult, SubtitleLine } from '@shared/types'
import { invoke } from '@renderer/lib/api'
import { useApp } from '@renderer/stores/app'
import { useStudyStore } from '@renderer/stores/movie'
import { Button } from '@renderer/components/ui'
import { cn } from '@renderer/lib/cn'
import { PracticeContext, playAiVoice, playSegment, recordFor, usePractice } from './practiceCore'
import { ladder, matchHeard, type LadderStage } from './practiceLogic'
import { recordingToWavBase64 } from './audio'

const STAGE_COLOR: Record<LadderStage, string> = {
  listen: 'bg-[#b86c81]',
  mumble: 'bg-[#c98a9b]',
  shadow: 'bg-[#781b36]',
  noText: 'bg-[#5e1229]',
  memory: 'bg-[#3d0b1b]'
}

/**
 * Speak focus mode: only the line, in large text, and the Shadow Ladder. Meaning,
 * pronunciation and the Bangla hint are behind "?". Tap ✓ after each rep; Gemini checks
 * the "say from memory" reps (not in Quiet mode).
 */
export function SpeakPanel({ line }: { line: SubtitleLine }): ReactNode {
  const practice = useContext(PracticeContext)
  const store = useStudyStore()
  const host = usePractice((s) => s.speakHost)
  const isRemix = line.id.startsWith('remix:')
  const maxReps = isRemix ? 5 : 14
  const reps = Math.min(maxReps, usePractice((s) => s.speakCount))
  const quiet = usePractice((s) => s.quiet)
  const autoAdvance = usePractice((s) => s.autoAdvance)
  const { openSpeak, setSpeakCount, setQuiet, setAutoAdvance } = usePractice.getState()
  const hasKey = useApp((s) => !!s.settings?.hasGeminiKey)
  const { toastError } = useApp.getState()

  const plan = ladder(reps)
  const [index, setIndex] = useState(0)
  const [done, setDone] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const [meaning, setMeaning] = useState<string | null>(null)
  const [pron, setPron] = useState<PronounceResult | null>(null)
  const [recording, setRecording] = useState(false)
  const [checking, setChecking] = useState(false)
  const [heard, setHeard] = useState<{ words: boolean[]; text: string } | null>(null)
  const stopRec = useRef<(() => void) | null>(null)
  const cancelled = useRef(false)
  const saved = useRef(false)

  const rep = plan[Math.min(index, plan.length - 1)]
  const stageReps = plan.filter((r) => r.stage === rep.stage).length
  const stageIndex = plan.slice(0, index + 1).filter((r) => r.stage === rep.stage).length
  const words = line.text.split(/\s+/).filter(Boolean)
  const useOriginal = !!practice?.canPlay(line)
  const aiEar = hasKey && !quiet && typeof MediaRecorder !== 'undefined'
  const lines = store.getState().lines
  const nextLine = host !== 'room' ? lines[lines.findIndex((l) => l.id === line.id) + 1] : undefined

  /** Plays the original clip if that movie/video is loaded here, otherwise the AI voice. */
  const play = async (): Promise<void> => {
    setPlaying(true)
    cancelled.current = false
    try {
      if (useOriginal && practice) {
        await playSegment(practice.player, line, 1, () => cancelled.current)
        await practice.player.pause()
      } else {
        await playAiVoice(line.text)
      }
    } catch (err) {
      toastError(err)
    } finally {
      setPlaying(false)
    }
  }

  const advance = (): void => {
    setHeard(null)
    if (index + 1 >= plan.length) setDone(true)
    else setIndex(index + 1)
  }

  // Listen reps play by themselves and count when the audio ends. The first one starts on open
  // (so "Next line" loads the line and plays it).
  useEffect(() => {
    if (done || rep.stage !== 'listen') return
    let live = true
    void play().then(() => live && advance())
    return () => {
      live = false
      cancelled.current = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, done, reps])

  // Final rep reached: save as "shadowed today" (remix sentences are practice only).
  useEffect(() => {
    if (!done || saved.current) return
    saved.current = true
    recordFor(line, { speakReps: plan.length })
    if (!isRemix) {
      void invoke('room:shadowed', {
        line: { id: line.id, text: line.text, mediaPath: line.mediaPath || null, mediaTitle: line.mediaTitle || null, start: line.start, end: line.end },
        reps: plan.length
      }).catch(toastError)
    }
    if (autoAdvance && nextLine) {
      const t = setTimeout(() => openSpeak(nextLine, host ?? undefined), 1200)
      return () => clearTimeout(t)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [done])

  useEffect(
    () => () => {
      cancelled.current = true
      stopRec.current?.()
    },
    []
  )

  const openHelp = (): void => {
    const open = !helpOpen
    setHelpOpen(open)
    if (open && !pron) void invoke('practice:pronounce', line.text).then(setPron).catch(() => setPron({ words: [], tips: [] }))
    if (open && meaning === null && hasKey) void invoke('practice:meaning', line.text).then(setMeaning).catch(() => setMeaning(''))
  }

  const changeReps = (n: number): void => {
    setSpeakCount(Math.min(maxReps, Math.max(1, n)))
    setIndex(0)
    setDone(false)
    setHeard(null)
    saved.current = false
  }

  /** Memory rep with the mic: record, Gemini writes down what it heard, the rep counts. */
  const checkWithAi = async (): Promise<void> => {
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch {
      toastError(new Error("The microphone isn't available. Tap ✓ instead."))
      return
    }
    const chunks: Blob[] = []
    const recorder = new MediaRecorder(stream)
    recorder.addEventListener('dataavailable', (e) => chunks.push(e.data))
    const lineSec = Math.max(0, (line.end ?? 0) - (line.start ?? 0))
    const auto = setTimeout(() => recorder.state === 'recording' && recorder.stop(), Math.max(4000, lineSec * 2500 + 2500))
    recorder.addEventListener('stop', () => {
      clearTimeout(auto)
      stream.getTracks().forEach((t) => t.stop())
      stopRec.current = null
      setRecording(false)
      setChecking(true)
      void (async () => {
        try {
          const audioBase64 = await recordingToWavBase64(new Blob(chunks, { type: recorder.mimeType }))
          const text = await invoke('practice:transcribeSpeech', { audioBase64, mimeType: 'audio/wav' })
          setHeard({ words: matchHeard(words, text), text })
        } catch (err) {
          toastError(err)
        } finally {
          setChecking(false)
        }
      })()
    })
    stopRec.current = () => recorder.state === 'recording' && recorder.stop()
    setRecording(true)
    recorder.start()
  }

  const close = (): void => openSpeak(null)
  const backToVideo = (): void => {
    close()
    if (host !== 'room' && practice) void practice.player.play().catch(() => undefined)
  }

  const textHidden = !done && rep.hideText
  const heardCount = heard ? heard.words.filter(Boolean).length : 0

  return (
    <aside aria-label="Speak focus mode" className="glass-elevated anim-pop-in absolute inset-y-2 right-2 z-40 flex w-[min(460px,calc(100%-1rem))] flex-col overflow-hidden">
      {/* Stage + counter */}
      <div className="glass-header flex h-12 shrink-0 items-center gap-2 rounded-t-2xl px-4">
        <span className="min-w-0 flex-1 truncate text-sm font-semibold">
          {done ? 'Done ✓' : `${rep.label} · ${stageIndex}/${stageReps}`}
        </span>
        <span className="text-xs text-muted tabular-nums">
          {done ? plan.length : index + 1}/{plan.length}
        </span>
        <Button variant="ghost" size="sm" icon={<CircleHelp className="size-4" />} onClick={openHelp} aria-label="Meaning and pronunciation" aria-expanded={helpOpen} />
        <Button variant="ghost" size="sm" icon={<X className="size-4" />} onClick={close} aria-label="Close" />
      </div>

      {/* Ladder progress */}
      <div className="flex shrink-0 gap-1 px-4 pt-3" aria-hidden>
        {plan.map((r, i) => (
          <span key={i} className={cn('h-1.5 flex-1 rounded-full transition-opacity', STAGE_COLOR[r.stage], i < index || done ? 'opacity-100' : i === index ? 'opacity-60' : 'opacity-15')} />
        ))}
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5 py-5">
        {/* The line, large */}
        <div className="flex min-h-[8rem] flex-1 items-center justify-center text-center">
          {textHidden ? (
            <p className="text-lg font-medium text-accent">{rep.stage === 'memory' ? 'Say it from memory 🙂' : 'Say it without looking 🙂'}</p>
          ) : (
            <p className="text-[26px] leading-snug font-semibold">
              {words.map((w, i) => (
                <span key={i} className={cn(heard && (heard.words[i] ? 'text-[#1f7a3a]' : 'text-muted/60'))}>
                  {w}{' '}
                </span>
              ))}
            </p>
          )}
        </div>

        {helpOpen && (
          <div className="glass-inset anim-fade-in mb-4 space-y-1.5 rounded-xl p-3 text-sm">
            {meaning ? <p>{meaning}</p> : hasKey && meaning === null ? <p className="text-muted">Loading meaning…</p> : null}
            {pron && <p className="text-muted">/{pron.words.map((w) => w.ipa ?? w.word).join(' ')}/</p>}
            {pron && <p className="text-xs text-muted">উচ্চারণের ধারণা: {pron.words.map((w) => w.bangla ?? w.word).join(' ')}</p>}
            {pron?.tips.map((t, i) => (
              <p key={i} className="text-xs">
                {t.tip}
              </p>
            ))}
          </div>
        )}

        {heard && !textHidden && (
          <p className="mb-3 text-center text-xs text-muted">
            The app understood {heardCount} of {words.length} words. Gemini heard: “{heard.text || '…nothing clear'}”
          </p>
        )}

        {!done ? (
          <div className="space-y-2.5">
            <div className="flex gap-2">
              <Button className="flex-1" icon={playing ? <Square className="size-4" /> : <Play className="size-4" />} onClick={() => (playing ? (cancelled.current = true) : void play())}>
                {playing ? 'Stop' : 'Listen'}
                <span className="text-[11px] font-normal text-muted">{useOriginal ? '' : '· AI voice'}</span>
              </Button>
              <label className="flex items-center gap-1.5 rounded-[10px] px-2 text-xs text-muted" title="Mumbled or whispered reps count fully">
                <input type="checkbox" className="size-4 accent-[var(--accent)]" checked={quiet} onChange={(e) => setQuiet(e.target.checked)} />
                Quiet mode
              </label>
            </div>

            {rep.stage === 'listen' ? (
              <Button variant="secondary" className="h-14 w-full text-base" disabled icon={<Loader2 className={cn('size-5', playing && 'animate-spin')} />}>
                Listening…
              </Button>
            ) : heard ? (
              <Button variant="primary" className="h-14 w-full text-base" icon={<SkipForward className="size-5" />} onClick={advance}>
                Next rep
              </Button>
            ) : rep.stage === 'memory' && aiEar ? (
              <div className="flex gap-2">
                {checking ? (
                  <Button variant="secondary" className="h-14 flex-1 text-base" disabled icon={<Loader2 className="size-5 animate-spin" />}>
                    Gemini is listening…
                  </Button>
                ) : recording ? (
                  <Button variant="primary" className="h-14 flex-1 text-base" icon={<Square className="size-5" />} onClick={() => stopRec.current?.()}>
                    Tap when done
                  </Button>
                ) : (
                  <Button variant="primary" className="h-14 flex-1 text-base" icon={<Mic className="size-5" />} onClick={() => void checkWithAi()}>
                    Say it (Gemini checks)
                  </Button>
                )}
                <Button className="h-14 w-16" icon={<Check className="size-5" />} onClick={advance} aria-label="I said it" title="Skip the check: I said it" disabled={recording || checking} />
              </div>
            ) : (
              <Button variant="primary" className="h-14 w-full text-base" icon={<Check className="size-5" />} onClick={advance}>
                I said it
              </Button>
            )}
          </div>
        ) : (
          <div className="space-y-2.5">
            {!isRemix && <p className="text-center text-sm text-muted">Saved to today&apos;s Practice Room 🌱 First review in 3 days.</p>}
            <div className="flex gap-2">
              {nextLine && (
                <Button variant="primary" className="h-12 flex-1 text-base" icon={<SkipForward className="size-5" />} onClick={() => openSpeak(nextLine, host ?? undefined)}>
                  Next line
                </Button>
              )}
              <Button className="h-12 flex-1 text-base" icon={<Undo2 className="size-5" />} onClick={host === 'room' ? close : backToVideo}>
                {host === 'room' ? 'Done' : 'Back to video'}
              </Button>
            </div>
            {host !== 'room' && (
              <label className="flex items-center justify-center gap-1.5 text-xs text-muted">
                <input type="checkbox" className="size-4 accent-[var(--accent)]" checked={autoAdvance} onChange={(e) => setAutoAdvance(e.target.checked)} />
                Go to the next line automatically
              </label>
            )}
          </div>
        )}
      </div>

      {/* Rep stepper */}
      <div className="flex shrink-0 items-center justify-center gap-3 border-t border-line/70 bg-white/40 px-4 py-2.5 text-sm">
        <span className="text-xs text-muted">Reps</span>
        <Button size="sm" icon={<Minus className="size-3.5" />} onClick={() => changeReps(reps - 1)} disabled={reps <= 1} aria-label="Fewer reps" />
        <span className="w-6 text-center font-semibold tabular-nums">{reps}</span>
        <Button size="sm" icon={<Plus className="size-3.5" />} onClick={() => changeReps(reps + 1)} disabled={reps >= maxReps} aria-label="More reps" />
      </div>
    </aside>
  )
}
