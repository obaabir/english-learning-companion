import { memo, useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { CheckCircle2, Copy, Download, FileAudio, Loader2, Paperclip, RotateCcw, Save, Sparkles, Square, TriangleAlert } from 'lucide-react'
import { useApp } from '@renderer/stores/app'
import { Badge, Button, EmptyState } from '@renderer/components/ui'
import { cn } from '@renderer/lib/cn'
import { ACCEPT_ATTR, useSpeakingCoach, type PartState } from './speakingCoachStore'
import { baseName, formatBytes, formatClock, toPlainText, toSrt, type TranscriptLine } from './transcriptFormat'

/** Left: the original recording + job progress. Right: the editable transcript. Stacks on narrow windows. */
export function TranscriptWorkspace(): ReactNode {
  const mediaRef = useRef<HTMLMediaElement | null>(null)

  const seek = useCallback((sec: number, play: boolean) => {
    const m = mediaRef.current
    if (!m) return
    m.currentTime = sec
    if (play) void m.play().catch(() => undefined)
  }, [])

  return (
    <div className="h-full overflow-y-auto lg:grid lg:grid-cols-[minmax(300px,380px)_1fr] lg:overflow-hidden">
      <div className="flex flex-col gap-3 p-4 lg:overflow-y-auto">
        <MediaCard mediaRef={mediaRef} />
        <JobCard />
      </div>
      <TranscriptPanel mediaRef={mediaRef} seek={seek} />
    </div>
  )
}

function MediaCard({ mediaRef }: { mediaRef: React.RefObject<HTMLMediaElement | null> }): ReactNode {
  const mediaUrl = useSpeakingCoach((s) => s.mediaUrl)
  const isVideo = useSpeakingCoach((s) => s.isVideo)
  const source = useSpeakingCoach((s) => s.source)
  const setDuration = useSpeakingCoach((s) => s.setDuration)
  const attachMedia = useSpeakingCoach((s) => s.attachMedia)
  const [previewFailed, setPreviewFailed] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => setPreviewFailed(false), [mediaUrl])
  if (!source) return null

  const media = {
    src: mediaUrl ?? undefined,
    controls: true,
    preload: 'metadata' as const,
    onLoadedMetadata: (e: React.SyntheticEvent<HTMLMediaElement>) => setDuration(e.currentTarget.duration),
    onError: () => setPreviewFailed(true)
  }

  return (
    <section className="rounded-xl border border-line/60 p-3">
      {mediaUrl ? (
        isVideo ? (
          <video ref={(el) => void (mediaRef.current = el)} {...media} className="max-h-64 w-full rounded-lg bg-black" />
        ) : (
          <audio ref={(el) => void (mediaRef.current = el)} {...media} className="w-full" />
        )
      ) : (
        <div className="flex flex-col items-start gap-2 rounded-lg bg-white/[0.04] p-3 text-sm text-muted">
          <p>The original file isn't loaded. Choose it again to play it and jump to lines.</p>
          <Button size="sm" icon={<Paperclip className="size-3.5" />} onClick={() => inputRef.current?.click()}>
            Choose original file
          </Button>
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPT_ATTR}
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) attachMedia(f)
              e.target.value = ''
            }}
          />
        </div>
      )}
      {previewFailed && <p className="mt-2 text-xs text-warn">This file can't be previewed in the app player, but the transcript still works.</p>}
      <div className="mt-2 flex items-start gap-2">
        <FileAudio className="mt-0.5 size-4 shrink-0 text-rose" />
        <div className="min-w-0">
          <p className="truncate text-sm font-medium" title={source.fileName}>
            {source.fileName}
          </p>
          <p className="text-xs text-muted tabular-nums">
            {formatBytes(source.fileSize)} · {source.durationSec ? formatClock(source.durationSec) : 'duration …'}
          </p>
        </div>
      </div>
    </section>
  )
}

const PART_LABEL: Record<PartState['status'], string> = {
  pending: 'waiting',
  uploading: 'uploading',
  transcribing: 'transcribing',
  done: 'done',
  failed: 'failed'
}

function JobCard(): ReactNode {
  const file = useSpeakingCoach((s) => s.file)
  const phase = useSpeakingCoach((s) => s.phase)
  const status = useSpeakingCoach((s) => s.status)
  const progress = useSpeakingCoach((s) => s.progress)
  const error = useSpeakingCoach((s) => s.error)
  const parts = useSpeakingCoach((s) => s.parts)
  const complete = useSpeakingCoach((s) => s.complete)
  const lineCount = useSpeakingCoach((s) => s.lines.length)
  const bigFileWarning = useSpeakingCoach((s) => s.bigFileWarning)
  const { start, cancel, retryFailed, dismissBigWarning } = useSpeakingCoach.getState()
  const busy = phase === 'extracting' || phase === 'transcribing'
  const canRetryPart = phase === 'failed' && parts.some((p) => p.status !== 'done')

  return (
    <section className="flex flex-col gap-3 rounded-xl border border-line/60 p-3">
      {bigFileWarning && !busy && (
        <div className="rounded-lg bg-warn-soft p-3 text-sm text-warn">
          <p className="flex items-center gap-1.5 font-medium">
            <TriangleAlert className="size-4 shrink-0" /> Big file (over 300 MB)
          </p>
          <p className="mt-1">May take a few minutes. Close other tabs.</p>
          <div className="mt-2 flex gap-2">
            <Button size="sm" variant="primary" onClick={() => void start(true)}>
              Continue
            </Button>
            <Button size="sm" variant="ghost" onClick={dismissBigWarning}>
              Not now
            </Button>
          </div>
        </div>
      )}

      {phase === 'idle' && file && !bigFileWarning && (
        <>
          <Button variant="primary" icon={<Sparkles className="size-4" />} onClick={() => void start()}>
            Make transcript
          </Button>
          <p className="text-xs text-muted">Word for word, mistakes kept. The original file stays on this computer; only the extracted audio goes to Gemini.</p>
        </>
      )}

      {busy && (
        <div className="flex flex-col gap-2">
          <p className="flex items-center gap-2 text-sm">
            <Loader2 className="size-4 shrink-0 animate-spin text-rose" />
            <span className="min-w-0 flex-1">{status}</span>
          </p>
          <div className="h-1.5 overflow-hidden rounded-full bg-white/10" role="progressbar" aria-valuenow={progress ?? undefined} aria-valuemin={0} aria-valuemax={100}>
            {progress !== null ? (
              <div className="h-full rounded-full bg-accent transition-[width] duration-300" style={{ width: `${progress}%` }} />
            ) : (
              <div className="h-full w-1/3 animate-pulse rounded-full bg-accent/70" />
            )}
          </div>
          <Button size="sm" variant="ghost" icon={<Square className="size-3.5" />} onClick={cancel} className="self-start">
            Stop
          </Button>
        </div>
      )}

      {parts.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {parts.map((p) => (
            <li key={p.index}>
              <Badge tone={p.status === 'done' ? 'info' : p.status === 'failed' ? 'danger' : p.status === 'pending' ? 'neutral' : 'accent'}>
                {p.status === 'done' && <CheckCircle2 className="size-3" />}
                Part {p.index + 1}: {PART_LABEL[p.status]}
              </Badge>
            </li>
          ))}
        </ul>
      )}

      {phase === 'failed' && error && (
        <div className="rounded-lg bg-danger-soft p-3 text-sm text-danger">
          <p className="flex items-start gap-1.5">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" /> {error}
          </p>
          {canRetryPart ? (
            <Button size="sm" className="mt-2" icon={<RotateCcw className="size-3.5" />} onClick={() => void retryFailed()}>
              Retry failed part
            </Button>
          ) : (
            file && (
              <Button size="sm" className="mt-2" icon={<RotateCcw className="size-3.5" />} onClick={() => void start(true)}>
                Try again
              </Button>
            )
          )}
        </div>
      )}
      {phase === 'idle' && error && <p className="text-sm text-danger">{error}</p>}

      {phase === 'done' && (
        <div className="flex flex-col gap-2 text-sm">
          <p className="flex items-center gap-1.5">
            <CheckCircle2 className="size-4 text-[var(--success)]" /> {lineCount} lines{complete ? '' : ' (some parts are missing)'}
          </p>
          {file && (
            <Button size="sm" variant="ghost" icon={<RotateCcw className="size-3.5" />} onClick={() => void start(true)} className="self-start">
              Transcribe again
            </Button>
          )}
        </div>
      )}
    </section>
  )
}

function TranscriptPanel({ mediaRef, seek }: { mediaRef: React.RefObject<HTMLMediaElement | null>; seek: (sec: number, play: boolean) => void }): ReactNode {
  const lines = useSpeakingCoach((s) => s.lines)
  const phase = useSpeakingCoach((s) => s.phase)
  const dirty = useSpeakingCoach((s) => s.dirty)
  const savedId = useSpeakingCoach((s) => s.savedId)
  const source = useSpeakingCoach((s) => s.source)
  const mediaUrl = useSpeakingCoach((s) => s.mediaUrl)
  const { editLine, save } = useSpeakingCoach.getState()
  const { toast, toastError } = useApp.getState()
  const [activeId, setActiveId] = useState<number | null>(null)
  const listRef = useRef<HTMLDivElement>(null)

  // Highlight the line being played (and keep it in view unless you are editing).
  useEffect(() => {
    const m = mediaRef.current
    if (!m) return
    const onTime = (): void => {
      const t = m.currentTime
      let id: number | null = null
      for (const l of lines) {
        if (l.start <= t + 0.05) id = l.id
        else break
      }
      setActiveId((prev) => {
        if (prev !== id && id !== null && !m.paused && !listRef.current?.contains(document.activeElement)) {
          listRef.current?.querySelector(`[data-line="${id}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
        }
        return id
      })
    }
    m.addEventListener('timeupdate', onTime)
    m.addEventListener('seeked', onTime)
    return () => {
      m.removeEventListener('timeupdate', onTime)
      m.removeEventListener('seeked', onTime)
    }
  }, [lines, mediaRef, mediaUrl])

  const name = baseName(source?.fileName ?? 'transcript')
  const download = (text: string, ext: string, mime: string): void => {
    const url = URL.createObjectURL(new Blob([text], { type: mime }))
    const a = document.createElement('a')
    a.href = url
    a.download = `${name}.${ext}`
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 10_000)
  }
  const empty = lines.length === 0

  return (
    <section className="flex min-h-[420px] flex-col border-t border-line/60 lg:min-h-0 lg:border-t-0 lg:border-l">
      <div className="flex flex-wrap items-center gap-2 px-4 py-2.5">
        <h3 className="text-sm font-semibold">Transcript</h3>
        {!empty && <span className="text-xs text-muted tabular-nums">{lines.length} lines</span>}
        {!empty && (dirty ? <Badge tone="warn">Unsaved edits</Badge> : savedId ? <Badge>Saved</Badge> : null)}
        <div className="ml-auto flex flex-wrap gap-1.5">
          <Button
            size="sm"
            disabled={empty}
            icon={<Copy className="size-3.5" />}
            onClick={() =>
              void navigator.clipboard
                .writeText(toPlainText(lines))
                .then(() => toast('success', 'Transcript copied'))
                .catch(toastError)
            }
          >
            Copy all
          </Button>
          <Button size="sm" disabled={empty} icon={<Download className="size-3.5" />} onClick={() => download(toPlainText(lines), 'txt', 'text/plain')}>
            .txt
          </Button>
          <Button size="sm" disabled={empty} icon={<Download className="size-3.5" />} onClick={() => download(toSrt(lines), 'srt', 'application/x-subrip')}>
            .srt
          </Button>
          <Button size="sm" variant={dirty || !savedId ? 'primary' : 'secondary'} disabled={empty} icon={<Save className="size-3.5" />} onClick={() => void save().catch(toastError)}>
            Save
          </Button>
        </div>
      </div>
      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
        {empty ? (
          <EmptyState title={phase === 'extracting' || phase === 'transcribing' ? 'Working on it…' : 'No transcript yet'}>
            {phase === 'extracting' || phase === 'transcribing'
              ? 'Lines appear here part by part as Gemini finishes them.'
              : 'Press "Make transcript". Then click a line to jump to it in the recording, and fix any word Gemini misheard.'}
          </EmptyState>
        ) : (
          <>
            <p className="px-2 pb-2 text-xs text-muted">Click a line to jump there · click the time to play from it · type to fix a misheard word.</p>
            {lines.map((l) => (
              <LineRow key={l.id} line={l} active={l.id === activeId} onSeek={seek} onEdit={editLine} />
            ))}
          </>
        )}
      </div>
    </section>
  )
}

const LineRow = memo(function LineRow({
  line,
  active,
  onSeek,
  onEdit
}: {
  line: TranscriptLine
  active: boolean
  onSeek: (sec: number, play: boolean) => void
  onEdit: (id: number, text: string) => void
}): ReactNode {
  return (
    <div
      data-line={line.id}
      onClick={() => onSeek(line.start, false)}
      className={cn('flex cursor-pointer items-start gap-2 rounded-xl border px-2 py-1', active ? 'surface-selected' : 'border-transparent hover:bg-white/[0.06]')}
    >
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          onSeek(line.start, true)
        }}
        title="Play from here"
        className="motion-press mt-1 shrink-0 rounded-md px-1.5 py-0.5 text-xs text-rose tabular-nums hover:bg-white/10"
      >
        {formatClock(line.start)}
      </button>
      <textarea
        value={line.text}
        rows={1}
        spellCheck={false}
        aria-label={`Line at ${formatClock(line.start)}`}
        onChange={(e) => onEdit(line.id, e.target.value)}
        className="field-sizing-content min-h-0 w-full resize-none rounded-md border border-transparent bg-transparent px-1.5 py-1 text-[15px] leading-relaxed text-fg outline-none focus:border-line focus:bg-white/[0.05]"
      />
    </div>
  )
})
