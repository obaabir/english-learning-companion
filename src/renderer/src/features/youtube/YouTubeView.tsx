import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Group, Panel, Separator } from 'react-resizable-panels'
import { AlertTriangle, Clock, Link2, Loader2, Play, RotateCcw, Sparkles } from 'lucide-react'
import { formatTimestamp, type SubtitleLine, type TranscriptLine, type YouTubeVideo } from '@shared/types'
import { errorMessage, invoke, on } from '@renderer/lib/api'
import { useApp } from '@renderer/stores/app'
import { StudyStoreContext, type StudyActions } from '@renderer/stores/movie'
import { useYouTube, youtubeStudy } from '@renderer/stores/youtube'
import { Badge, Button, EmptyState, Input, PanelHeader } from '@renderer/components/ui'
import { ExplainPanel, StudyActionsContext } from '@renderer/features/movie/ExplainPanel'
import { LineRow } from '@renderer/features/movie/SubtitleFeed'
import { loadYouTubeApi, playerErrorMessage, type YTPlayer } from './youtubeApi'
import { YouTubeIcon } from './YouTubeIcon'
import { PracticeContext, usePractice, type PracticePlayer } from '@renderer/features/practice/practiceCore'
import { RepeatBar, usePracticeActions } from '@renderer/features/practice/PracticeControls'
import { SpeakPanel } from '@renderer/features/practice/SpeakPanel'

const STACK_BELOW = 640

const toLines = (video: YouTubeVideo, transcript: TranscriptLine[]): SubtitleLine[] =>
  transcript.map((l) => ({ id: `${video.url}@${l.start}`, text: l.text, start: l.start, end: l.end, mediaPath: video.url, mediaTitle: video.title }))

/** Watch & Learn: paste a YouTube link, watch in the official player, study the transcript below it. */
export function YouTubeView({ active }: { active: boolean }): ReactNode {
  const video = useYouTube((s) => s.video)
  const setVideo = useYouTube((s) => s.setVideo)
  const pendingOpen = useYouTube((s) => s.pendingOpen)
  const { toastError } = useApp.getState()
  const [link, setLink] = useState('')
  const [checking, setChecking] = useState(false)
  const [recent, setRecent] = useState<YouTubeVideo[]>([])
  const [player, setPlayer] = useState<YTPlayer | null>(null)
  const [playerError, setPlayerError] = useState<string | null>(null)
  const [playing, setPlaying] = useState(false)
  const [current, setCurrent] = useState<number | null>(null)
  const [transcribing, setTranscribing] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [transcriptError, setTranscriptError] = useState<string | null>(null)
  const startAt = useRef(0)
  const [stacked, setStacked] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  // Repeat / Speak practice drive the official YouTube player.
  const playerRef = useRef<YTPlayer | null>(null)
  playerRef.current = player
  const practicePlayer = useMemo<PracticePlayer>(
    () => ({
      play: async () => playerRef.current?.playVideo(),
      pause: async () => playerRef.current?.pauseVideo(),
      seek: async (seconds) => playerRef.current?.seekTo(seconds, true),
      setRate: async (rate) => playerRef.current?.setPlaybackRate(rate),
      currentTime: () => playerRef.current?.getCurrentTime() ?? null
    }),
    []
  )
  const canPlayYouTubeLine = useCallback(
    (line: SubtitleLine) => line.start != null && !!playerRef.current && useYouTube.getState().video?.url === line.mediaPath,
    []
  )
  const practice = usePracticeActions(practicePlayer, 'youtube', canPlayYouTubeLine)
  const speakLine = usePractice((s) => s.speakLine)
  const speakHost = usePractice((s) => s.speakHost)

  useEffect(() => {
    const el = rootRef.current
    if (!el) return
    const observer = new ResizeObserver(([entry]) => setStacked(entry.contentRect.width < STACK_BELOW))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (active && !video) void invoke('youtube:recent').then(setRecent).catch(() => undefined)
  }, [active, video])

  /** Shows a video: transcript lines go into YouTube's own study list. */
  const showVideo = useCallback(
    (v: YouTubeVideo, seconds: number) => {
      startAt.current = seconds
      setVideo(v)
      setPlayerError(null)
      setTranscriptError(null)
      setProgress(null)
      setCurrent(null)
      youtubeStudy.setState({ lines: toLines(v, v.transcript), feedMedia: v.url, selectedLineId: null, wordRange: null, custom: null })
    },
    [setVideo]
  )

  const check = async (input: string, seconds?: number): Promise<void> => {
    if (!input.trim()) return
    setChecking(true)
    try {
      const v = await invoke('youtube:info', input)
      showVideo(v, seconds ?? v.lastPositionSec ?? 0)
      setLink('')
    } catch (err) {
      toastError(err)
    } finally {
      setChecking(false)
    }
  }

  // Opened from a note's timestamp.
  useEffect(() => {
    if (!active || !pendingOpen) return
    const p = useYouTube.getState().takePendingOpen()
    if (p) void check(p.url, p.seconds)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, pendingOpen])

  // Transcript progress (lines appear part by part).
  useEffect(
    () =>
      on('youtube:transcriptProgress', (p) => {
        const v = useYouTube.getState().video
        if (!v || v.videoId !== p.videoId) return
        setProgress({ done: p.chunksDone, total: p.totalChunks })
        youtubeStudy.setState({ lines: toLines(v, p.transcript) })
      }),
    []
  )

  const makeTranscript = useCallback(
    async (v: YouTubeVideo, durationSec: number | null): Promise<void> => {
      if (v.transcriptComplete) return
      setTranscribing(true)
      setTranscriptError(null)
      try {
        const done = await invoke('youtube:transcribe', { videoId: v.videoId, durationSec })
        if (useYouTube.getState().video?.videoId === v.videoId) {
          setVideo(done)
          youtubeStudy.setState({ lines: toLines(done, done.transcript) })
        }
      } catch (err) {
        if (useYouTube.getState().video?.videoId === v.videoId) setTranscriptError(errorMessage(err))
      } finally {
        setTranscribing(false)
      }
    },
    [setVideo]
  )

  // YouTube's rules: no background play. Pause when this page is hidden.
  useEffect(() => {
    if (!active && player && playing) player.pauseVideo()
  }, [active, player, playing])

  // Follow playback: current time for the highlighted line; remember the position.
  useEffect(() => {
    if (!player || !playing) return
    const tick = setInterval(() => setCurrent(player.getCurrentTime()), 250)
    const save = setInterval(() => {
      const v = useYouTube.getState().video
      if (v) void invoke('youtube:savePosition', { videoId: v.videoId, seconds: player.getCurrentTime() })
    }, 5000)
    return () => {
      clearInterval(tick)
      clearInterval(save)
    }
  }, [player, playing])

  const actions = useMemo<StudyActions>(
    () => ({
      seek: async (line) => {
        if (!player || line.start == null) return
        player.seekTo(Math.max(0, line.start - 0.3), true)
        player.playVideo()
      }
    }),
    [player]
  )
  const jumpToLine = useCallback((line: SubtitleLine) => void actions.seek(line), [actions])

  return (
    <StudyStoreContext.Provider value={youtubeStudy}>
      <StudyActionsContext.Provider value={actions}>
        <PracticeContext.Provider value={practice}>
        <div ref={rootRef} className="relative h-full min-w-0 overflow-hidden">
          <Group key={stacked ? 'stacked' : 'side'} orientation={stacked ? 'vertical' : 'horizontal'} className="h-full">
            <Panel id="yt-watch" defaultSize={stacked ? '50' : '52'} minSize={stacked ? 220 : 320}>
              <div className="glass-panel flex h-full flex-col overflow-hidden">
                <PanelHeader title="YouTube" icon={<YouTubeIcon className="size-4" />} />
                <form
                  className="flex shrink-0 gap-2 border-b border-line/70 px-3 py-2.5"
                  onSubmit={(e) => {
                    e.preventDefault()
                    void check(link)
                  }}
                >
                  <div className="relative min-w-0 flex-1">
                    <Link2 className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-muted" />
                    <Input value={link} onChange={(e) => setLink(e.target.value)} placeholder="Paste a YouTube link…" className="pl-8" aria-label="YouTube link" />
                  </div>
                  <Button variant="primary" type="submit" loading={checking} disabled={!link.trim()}>
                    Check
                  </Button>
                </form>

                {video ? (
                  <VideoArea
                    key={video.videoId}
                    video={video}
                    startAt={startAt.current}
                    current={current}
                    playing={playing}
                    transcribing={transcribing}
                    progress={progress}
                    transcriptError={transcriptError}
                    playerError={playerError}
                    onPlayer={setPlayer}
                    onPlaying={setPlaying}
                    onPlayerError={setPlayerError}
                    onDuration={(d) => void makeTranscript(video, d)}
                    onRetryTranscript={() => void makeTranscript(video, player?.getDuration() ?? null)}
                    onJump={jumpToLine}
                  />
                ) : (
                  <RecentList recent={recent} onOpen={(v) => void check(v.url)} />
                )}
              </div>
            </Panel>
            <Separator className={stacked ? 'resize-handle-v' : 'resize-handle'} />
            <Panel id="yt-explain" defaultSize={stacked ? '50' : '48'} minSize={stacked ? 220 : 340}>
              <ExplainPanel />
            </Panel>
          </Group>
          {speakLine && speakHost === 'youtube' && <SpeakPanel key={speakLine.id} line={speakLine} />}
        </div>
        </PracticeContext.Provider>
      </StudyActionsContext.Provider>
    </StudyStoreContext.Provider>
  )
}

function VideoArea(props: {
  video: YouTubeVideo
  startAt: number
  current: number | null
  playing: boolean
  transcribing: boolean
  progress: { done: number; total: number } | null
  transcriptError: string | null
  playerError: string | null
  onPlayer: (p: YTPlayer | null) => void
  onPlaying: (v: boolean) => void
  onPlayerError: (m: string | null) => void
  onDuration: (seconds: number | null) => void
  onRetryTranscript: () => void
  onJump: (line: SubtitleLine) => void
}): ReactNode {
  const { video, current } = props
  const hostRef = useRef<HTMLDivElement>(null)
  const [duration, setDuration] = useState<number | null>(video.durationSec)
  const lines = youtubeStudy((s) => s.lines)
  const listRef = useRef<HTMLDivElement>(null)
  const userScrollAt = useRef(0)

  // The official embedded player (nothing is drawn over it).
  useEffect(() => {
    let player: YTPlayer | null = null
    let cancelled = false
    const { onPlayer, onPlaying, onPlayerError, onDuration } = props
    loadYouTubeApi()
      .then((YT) => {
        if (cancelled || !hostRef.current) return
        const el = document.createElement('div')
        hostRef.current.replaceChildren(el)
        player = new YT.Player(el, {
          videoId: video.videoId,
          host: 'https://www.youtube-nocookie.com',
          width: '100%',
          height: '100%',
          playerVars: { playsinline: 1, rel: 0, start: Math.floor(props.startAt) },
          events: {
            onReady: (e) => {
              onPlayer(e.target)
              const d = e.target.getDuration()
              setDuration(d > 0 ? d : null)
              onDuration(d > 0 ? d : null)
            },
            onStateChange: (e) => {
              onPlaying(e.data === YT.PlayerState.PLAYING)
              const d = e.target.getDuration()
              if (d > 0) setDuration(d)
            },
            onError: (e) => onPlayerError(playerErrorMessage(e.data))
          }
        })
      })
      .catch((err) => onPlayerError(errorMessage(err)))
    return () => {
      cancelled = true
      props.onPlayer(null)
      props.onPlaying(false)
      player?.destroy()
    }
    // One player per video.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [video.videoId])

  const currentId = useMemo(() => {
    if (current == null) return null
    for (let i = lines.length - 1; i >= 0; i--) {
      if (lines[i].start! <= current) return current <= (lines[i].end ?? lines[i].start! + 3) ? lines[i].id : null
    }
    return null
  }, [lines, current])

  // Keep the spoken line in view while playing (unless you scrolled in the last 3 s).
  useEffect(() => {
    if (!currentId || !props.playing || Date.now() - userScrollAt.current < 3000) return
    const el = listRef.current?.querySelector<HTMLElement>(`[data-line-id="${CSS.escape(currentId)}"]`)
    el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [currentId, props.playing])

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 px-3 pt-3">
        <div className="aspect-video w-full overflow-hidden rounded-xl bg-black/90 shadow-[0_6px_20px_rgba(55,35,45,0.18)]" ref={hostRef} />
        {props.playerError && (
          <div className="anim-fade-in mt-2 flex gap-2 rounded-[10px] bg-danger-soft px-3 py-2 text-xs text-danger">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" /> <p>{props.playerError}</p>
          </div>
        )}
        <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1">
          <p className="min-w-0 flex-1 truncate text-sm font-semibold" title={video.title}>
            {video.title}
          </p>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted">
          {video.channel && <span className="truncate">{video.channel}</span>}
          {duration != null && (
            <span className="inline-flex items-center gap-1 tabular-nums">
              <Clock className="size-3" /> {formatTimestamp(duration)}
            </span>
          )}
          <Badge tone="warn" className="ml-auto">
            <Sparkles className="size-3" /> AI transcript — may contain errors
          </Badge>
          {video.level && <Badge tone="accent">Level: {video.level}</Badge>}
        </div>
      </div>

      <div className="mt-2.5 flex shrink-0 items-center gap-2 border-y border-line/70 bg-white/35 px-3 py-2 text-xs">
        <span className="font-medium">Transcript</span>
        {props.transcribing && (
          <span className="inline-flex items-center gap-1.5 text-muted">
            <Loader2 className="size-3.5 animate-spin" />
            Making the transcript with Gemini…{props.progress && props.progress.total > 1 ? ` part ${Math.min(props.progress.done + 1, props.progress.total)} of ${props.progress.total}` : ''}
          </span>
        )}
        {!props.transcribing && video.transcriptComplete && <span className="text-muted">{lines.length} lines</span>}
        {props.transcriptError && (
          <span className="ml-auto inline-flex min-w-0 items-center gap-2 text-danger">
            <span className="truncate" title={props.transcriptError}>
              {props.transcriptError}
            </span>
            <Button size="sm" icon={<RotateCcw className="size-3.5" />} onClick={props.onRetryTranscript}>
              Try again
            </Button>
          </span>
        )}
      </div>

      <RepeatBar />
      <div
        ref={listRef}
        onWheel={() => (userScrollAt.current = Date.now())}
        className="min-h-0 flex-1 overflow-y-auto px-2 py-2"
      >
        {lines.length === 0 ? (
          <EmptyState icon={<Play className="size-10" />} title={props.transcribing ? 'Transcript on its way…' : 'No transcript yet'}>
            {props.transcribing
              ? 'You can start watching now. Lines appear here as soon as they are ready; click one to jump there and get it explained.'
              : props.transcriptError
                ? 'The transcript could not be made. Press "Try again". The video still plays normally.'
                : 'The transcript starts when the player is ready.'}
          </EmptyState>
        ) : (
          lines.map((line) => <LineRow key={line.id} line={line} current={line.id === currentId} onActivate={props.onJump} />)
        )}
      </div>
    </div>
  )
}

function RecentList({ recent, onOpen }: { recent: YouTubeVideo[]; onOpen: (v: YouTubeVideo) => void }): ReactNode {
  if (!recent.length) {
    return (
      <EmptyState icon={<YouTubeIcon className="size-10" />} title="Learn from any YouTube video">
        Paste a link above. The video plays in YouTube&apos;s own player, and a transcript appears below it. Click any line to jump there and get it explained.
      </EmptyState>
    )
  }
  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-3">
      <p className="mb-2 text-xs font-medium text-muted">Continue watching</p>
      <div className="space-y-1.5">
        {recent.map((v) => (
          <button
            key={v.videoId}
            onClick={() => onOpen(v)}
            className="motion-hover flex w-full items-center gap-3 rounded-xl border border-transparent p-1.5 text-left hover:border-white/80 hover:bg-white/55"
          >
            {v.thumbnailUrl ? (
              <img src={v.thumbnailUrl} alt="" className="aspect-video w-28 shrink-0 rounded-lg object-cover" />
            ) : (
              <div className="aspect-video w-28 shrink-0 rounded-lg bg-black/10" />
            )}
            <span className="min-w-0 flex-1">
              <span className="line-clamp-2 text-sm font-medium">{v.title}</span>
              <span className="mt-0.5 block truncate text-xs text-muted">
                {v.channel}
                {v.lastPositionSec > 5 ? ` · stopped at ${formatTimestamp(v.lastPositionSec)}` : ''}
                {v.level ? ` · ${v.level}` : ''}
              </span>
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}
