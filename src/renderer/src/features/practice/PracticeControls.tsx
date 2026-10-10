import { useContext, useMemo, useRef, type ReactNode } from 'react'
import { Mic, Repeat2, SkipForward, Square } from 'lucide-react'
import type { SubtitleLine } from '@shared/types'
import { useApp } from '@renderer/stores/app'
import { Button, Select } from '@renderer/components/ui'
import { COUNTS, PracticeContext, playSegment, recordFor, repeatPlan, usePractice, type Count, type PracticeActions, type PracticePlayer, type SpeakHost } from './practiceCore'

/** Runs Repeat ×N sessions on a player (one at a time). */
export function usePracticeActions(player: PracticePlayer, host: SpeakHost, canPlay: (line: SubtitleLine) => boolean): PracticeActions {
  const run = useRef<{ cancel: boolean; skip: boolean } | null>(null)
  return useMemo<PracticeActions>(() => {
    const { setRepeat } = usePractice.getState()
    return {
      host,
      player,
      canPlay,
      startRepeat: (line) => {
        if (run.current) run.current.cancel = true
        const token = { cancel: false, skip: false }
        run.current = token
        const { repeatCount: n, smart } = usePractice.getState()
        const plan = repeatPlan(n, smart)
        void (async () => {
          let done = 0
          try {
            for (let i = 0; i < n && !token.cancel; i++) {
              token.skip = false
              setRepeat({ lineId: line.id, index: i + 1, total: n, rep: plan[i] })
              await playSegment(player, line, plan[i].rate, () => token.cancel || token.skip)
              done++
            }
          } catch (err) {
            useApp.getState().toastError(err)
          } finally {
            await player.pause().catch(() => undefined)
            await player.setRate(1).catch(() => undefined)
            if (run.current === token) {
              run.current = null
              setRepeat(null)
            }
            if (done) recordFor(line, { listenReps: done })
          }
        })()
      },
      stopRepeat: () => {
        if (run.current) run.current.cancel = true
      },
      skipRep: () => {
        if (run.current) run.current.skip = true
      }
    }
  }, [player, host, canPlay])
}

export function CountPicker({ value, onChange, label }: { value: Count; onChange: (c: Count) => void; label: string }): ReactNode {
  return (
    <Select value={value} onChange={(e) => onChange(Number(e.target.value) as Count)} className="h-7 w-[62px] px-1.5 text-xs" aria-label={label}>
      {COUNTS.map((c) => (
        <option key={c} value={c}>
          ×{c}
        </option>
      ))}
    </Select>
  )
}

/** Repeat and Speak actions shown on the selected subtitle line (Explain stays the line click). */
export function LineActions({ line }: { line: SubtitleLine }): ReactNode {
  const practice = useContext(PracticeContext)
  const repeatCount = usePractice((s) => s.repeatCount)
  const smart = usePractice((s) => s.smart)
  const { setRepeatCount, setSmart, openSpeak } = usePractice.getState()
  if (!practice || line.start == null) return null
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
      <Button size="sm" icon={<Repeat2 className="size-3.5" />} onClick={() => practice.startRepeat(line)} title="Play this line several times">
        Repeat
      </Button>
      <CountPicker value={repeatCount} onChange={setRepeatCount} label="Repeat count" />
      <label className="flex cursor-pointer items-center gap-1 text-[11px] text-muted" title="Vary the reps: slower, then without the text">
        <input type="checkbox" className="size-3.5 accent-[var(--accent)]" checked={smart} onChange={(e) => setSmart(e.target.checked)} />
        Smart
      </label>
      <span className="mx-1 h-4 w-px bg-line" />
      <Button size="sm" icon={<Mic className="size-3.5" />} onClick={() => openSpeak(line, practice.host)} title="Shadow this line (Speak focus mode)">
        Speak
      </Button>
    </div>
  )
}

/** Counter with Skip / Stop while a line repeats. */
export function RepeatBar(): ReactNode {
  const practice = useContext(PracticeContext)
  const repeat = usePractice((s) => s.repeat)
  if (!practice || !repeat) return null
  return (
    <div className="anim-fade-in mx-3 mt-2.5 flex shrink-0 items-center gap-2 rounded-[10px] bg-accent-soft px-3 py-2 text-xs text-accent ring-1 ring-rose/30">
      <Repeat2 className="size-4 shrink-0" />
      <span className="font-semibold tabular-nums">
        Repeating {repeat.index}/{repeat.total}
      </span>
      <span className="text-muted">
        {repeat.rep.rate !== 1 ? `${repeat.rep.rate}× speed` : 'normal speed'}
        {repeat.rep.hideText ? ' · text hidden' : ''}
      </span>
      <Button size="sm" variant="ghost" className="ml-auto" icon={<SkipForward className="size-3.5" />} onClick={practice.skipRep}>
        Skip
      </Button>
      <Button size="sm" icon={<Square className="size-3.5" />} onClick={practice.stopRepeat}>
        Stop
      </Button>
    </div>
  )
}
