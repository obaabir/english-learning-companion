import { memo, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { AlertTriangle, ArrowDown, Check, Clapperboard, FilePlus2, FolderOpen, Loader2, Pause, Play, Subtitles, Trash2 } from 'lucide-react'
import { formatTimestamp, type SubtitleLine } from '@shared/types'
import { invoke } from '@renderer/lib/api'
import { useApp } from '@renderer/stores/app'
import { tokenize, useMovie, useStudy, useStudyStore } from '@renderer/stores/movie'
import { PracticeContext, usePractice } from '@renderer/features/practice/practiceCore'
import { LineActions, RepeatBar } from '@renderer/features/practice/PracticeControls'
import { Badge, Button, EmptyState, PanelHeader } from '@renderer/components/ui'
import { cn } from '@renderer/lib/cn'

export function SubtitleFeed(): ReactNode {
  const status = useMovie((s) => s.status)
  const lines = useMovie((s) => s.lines)
  const lastArrivedId = useMovie((s) => s.lastArrivedId)
  const followLive = useMovie((s) => s.followLive)
  const setFollowLive = useMovie((s) => s.setFollowLive)
  const clearLines = useMovie((s) => s.clearLines)
  const toastError = useApp((s) => s.toastError)
  const [opening, setOpening] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)
  const programmaticScroll = useRef(false)

  // Keep the newest subtitle in view while following live.
  useEffect(() => {
    if (!followLive || !lastArrivedId || !listRef.current) return
    const el = listRef.current.querySelector<HTMLElement>(`[data-line-id="${CSS.escape(lastArrivedId)}"]`)
    if (el) {
      programmaticScroll.current = true
      el.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
      setTimeout(() => (programmaticScroll.current = false), 400)
    }
  }, [lastArrivedId, followLive])

  const onScroll = (): void => {
    if (programmaticScroll.current || !listRef.current) return
    const { scrollTop, scrollHeight, clientHeight } = listRef.current
    const nearBottom = scrollHeight - scrollTop - clientHeight < 60
    if (nearBottom !== followLive) setFollowLive(nearBottom)
  }

  const open = async (): Promise<void> => {
    setOpening(true)
    try {
      await invoke('player:open')
    } catch (err) {
      toastError(err)
    } finally {
      setOpening(false)
    }
  }

  const run = (fn: () => Promise<unknown>) => () => void fn().catch(toastError)
  const currentTime = status.timePos

  return (
    <div className="glass-panel flex h-full flex-col overflow-hidden">
      <PanelHeader title="Subtitles" icon={<Subtitles className="size-4" />}>
        {lines.length > 0 && (
          <Button variant="ghost" size="sm" icon={<Trash2 className="size-3.5" />} onClick={clearLines} title="Clear the feed" />
        )}
      </PanelHeader>

      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line/70 px-3 py-2.5">
        <Button variant="primary" size="sm" icon={<FolderOpen className="size-3.5" />} loading={opening} onClick={() => void open()}>
          Open movie
        </Button>
        <Button size="sm" icon={<FilePlus2 className="size-3.5" />} disabled={!status.connected} onClick={run(() => invoke('player:addSubtitle'))}>
          Add .srt
        </Button>
        {status.connected && status.mediaPath && (
          <Button size="sm" variant="ghost" onClick={run(() => invoke('player:togglePause'))} icon={status.paused ? <Play className="size-3.5" /> : <Pause className="size-3.5" />}>
            {formatTimestamp(currentTime)}
          </Button>
        )}
      </div>

      {status.mediaTitle && (
        <div className="anim-fade-in flex shrink-0 items-center gap-2 border-b border-line/70 px-3 py-2 text-xs text-muted">
          <Clapperboard className="size-3.5 shrink-0" />
          <span className="truncate" title={status.mediaPath ?? ''}>
            {status.mediaTitle}
          </span>
          {status.subtitles.kind === 'text' && (
            <Badge className="ml-auto max-w-40 shrink-0 truncate" >
              {status.subtitles.codec}
              {status.subtitles.count ? ` · ${status.subtitles.count} lines` : ''}
            </Badge>
          )}
        </div>
      )}

      <SubtitleNotice />
      <RepeatBar />

      <div ref={listRef} onScroll={onScroll} className="relative min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {lines.length === 0 ? (
          <EmptyState icon={<Subtitles className="size-10" />} title={status.connected ? 'Waiting for subtitles…' : 'Start a movie'}>
            {status.connected
              ? 'Play the movie. Each subtitle line will appear here as it is shown.'
              : `Click "Open movie" and pick a film. It plays in ${status.player === 'mpv' ? 'mpv' : 'VLC'}, and its English subtitles appear here line by line. Click any line to get it explained.`}
          </EmptyState>
        ) : (
          lines.map((line) => <LineRow key={line.id} line={line} current={isCurrent(line, currentTime)} />)
        )}
      </div>

      {!followLive && lines.length > 0 && (
        <div className="pointer-events-none relative">
          <Button
            size="sm"
            variant="primary"
            className="anim-pop-in pointer-events-auto absolute bottom-3 left-1/2 -translate-x-1/2"
            icon={<ArrowDown className="size-3.5" />}
            onClick={() => {
              setFollowLive(true)
              listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' })
            }}
          >
            Follow live
          </Button>
        </div>
      )}
    </div>
  )
}

function isCurrent(line: SubtitleLine, t: number | null): boolean {
  if (t == null || line.start == null) return false
  return t >= line.start && t <= (line.end ?? line.start + 3)
}

function SubtitleNotice(): ReactNode {
  const subs = useMovie((s) => s.status.subtitles)
  if (subs.kind === 'loading') {
    return (
      <div className="anim-fade-in mx-3 mt-2.5 flex shrink-0 items-center gap-2 rounded-[10px] bg-info-soft px-3 py-2 text-xs text-info">
        <Loader2 className="size-3.5 shrink-0 animate-spin" />
        <p>
          Reading subtitles from the movie… {subs.count > 0 && `${subs.count} lines so far. `}You can start watching now.
        </p>
      </div>
    )
  }
  if (subs.kind === 'image') {
    return (
      <Notice>
        This movie&apos;s subtitles are images ({subs.codec}), so their text can&apos;t be read yet. Use <b>Add .srt</b> to load a text subtitle
        file for this movie.
      </Notice>
    )
  }
  if (subs.kind === 'none') {
    return (
      <Notice>
        No English text subtitles were found in this movie. Put an .srt file with the same name next to the movie, or use <b>Add .srt</b>.
      </Notice>
    )
  }
  return null
}

function Notice({ children }: { children: ReactNode }): ReactNode {
  return (
    <div className="anim-fade-in mx-3 mt-2.5 flex shrink-0 gap-2 rounded-[10px] bg-warn-soft px-3 py-2 text-xs text-warn">
      <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
      <p>{children}</p>
    </div>
  )
}

/** Memoized: the feed re-renders on every playback-time update, but a row only when its own props change. */
export const LineRow = memo(function LineRow({
  line,
  current,
  onActivate
}: {
  line: SubtitleLine
  current: boolean
  /** Called when a line gets selected (YouTube uses it to jump the player there). */
  onActivate?: (line: SubtitleLine) => void
}): ReactNode {
  const store = useStudyStore()
  const practice = useContext(PracticeContext)
  const textHidden = usePractice((s) => s.repeat?.lineId === line.id && s.repeat.rep.hideText)
  const selected = useStudy((s) => s.selectedLineId === line.id && !s.custom)
  const wordRange = useStudy((s) => (s.selectedLineId === line.id ? s.wordRange : null))
  const selectLine = useStudy((s) => s.selectLine)
  const setWordRange = useStudy((s) => s.setWordRange)
  const words = tokenize(line.text)

  const onWordClick = (i: number, e: React.MouseEvent): void => {
    if (!selected) return
    e.stopPropagation()
    // Read the latest range from the store so quick successive clicks don't see a stale value.
    const range = store.getState().wordRange
    if (e.shiftKey && range) setWordRange([range[0], i])
    else if (range && range[0] === i && range[1] === i) setWordRange(null)
    else setWordRange([i, i])
  }

  const inRange = (i: number): boolean =>
    !!wordRange && i >= Math.min(wordRange[0], wordRange[1]) && i <= Math.max(wordRange[0], wordRange[1])

  return (
    <div
      data-line-id={line.id}
      role="button"
      tabIndex={0}
      onClick={() => {
        if (selected) return setWordRange(null)
        selectLine(line.id)
        onActivate?.(line)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          selectLine(line.id)
        }
      }}
      className={cn(
        'motion-hover group mb-1 flex cursor-pointer gap-2.5 rounded-xl border px-2.5 py-2',
        selected ? 'surface-selected' : 'border-transparent hover:border-white/80 hover:bg-white/55',
        current && !selected && 'bg-white/45'
      )}
    >
      <span
        className={cn(
          'motion-hover mt-0.5 flex size-4.5 shrink-0 items-center justify-center rounded-full border',
          selected
            ? 'border-accent bg-accent text-accent-fg shadow-[0_2px_6px_rgba(120,27,54,0.35)]'
            : 'border-line bg-white/50 text-transparent group-hover:border-rose/60'
        )}
      >
        {/* The tick springs in on selection (transform + opacity). */}
        <span className={cn('block transition-[scale,opacity] duration-200 ease-[var(--ease)]', selected ? 'scale-100 opacity-100' : 'scale-50 opacity-0')}>
          <Check className="size-3" strokeWidth={3} />
        </span>
      </span>
      <div className="min-w-0 flex-1">
        <p className={cn('text-[15px] leading-snug', textHidden && 'blur-sm select-none')}>
          {selected
            ? words.map((w, i) => (
                <span key={i}>
                  <span
                    onClick={(e) => onWordClick(i, e)}
                    className={cn('motion-hover rounded px-0.5 hover:bg-rose/20', inRange(i) && 'bg-accent text-accent-fg hover:bg-accent')}
                  >
                    {w}
                  </span>{' '}
                </span>
              ))
            : line.text}
        </p>
        <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted">
          <span className="tabular-nums">{formatTimestamp(line.start)}</span>
          {current && <span className="font-medium text-accent">● now</span>}
          {selected && <span className="ml-auto opacity-80">Click a word · Shift+click for a phrase</span>}
        </div>
        {selected && practice && <LineActions line={line} />}
      </div>
    </div>
  )
})
