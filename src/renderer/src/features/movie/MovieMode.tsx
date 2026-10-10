import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Group, Panel, Separator } from 'react-resizable-panels'
import { SubtitleFeed } from './SubtitleFeed'
import { ExplainPanel } from './ExplainPanel'
import { PracticeContext, getMoviePlayer, usePractice } from '@renderer/features/practice/practiceCore'
import { useMovie } from '@renderer/stores/movie'
import type { SubtitleLine } from '@shared/types'
import { usePracticeActions } from '@renderer/features/practice/PracticeControls'
import { SpeakPanel } from '@renderer/features/practice/SpeakPanel'

/** A movie line's original clip can play when that movie is open in the player. */
export function canPlayMovieLine(line: SubtitleLine): boolean {
  const st = useMovie.getState().status
  return line.start != null && st.connected && !!line.mediaPath && st.mediaPath === line.mediaPath
}

/** Below this width (px) the two panels stack vertically, e.g. in a narrow laptop split-screen window. */
const STACK_BELOW = 640

export function MovieMode(): ReactNode {
  const ref = useRef<HTMLDivElement>(null)
  const [stacked, setStacked] = useState(false)
  const player = useMemo(() => getMoviePlayer(), [])
  const practice = usePracticeActions(player, 'movie', canPlayMovieLine)
  const speakLine = usePractice((s) => s.speakLine)
  const speakHost = usePractice((s) => s.speakHost)

  // Respond to the space this view actually has, not the screen size.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const observer = new ResizeObserver(([entry]) => setStacked(entry.contentRect.width < STACK_BELOW))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  return (
    <PracticeContext.Provider value={practice}>
    <div ref={ref} className="relative h-full min-w-0 overflow-hidden">
      {stacked ? (
        <Group key="stacked" orientation="vertical" className="h-full">
          <Panel id="subtitles" defaultSize="40" minSize={160}>
            <SubtitleFeed />
          </Panel>
          <Separator className="resize-handle-v" />
          <Panel id="explain" defaultSize="60" minSize={260}>
            <ExplainPanel />
          </Panel>
        </Group>
      ) : (
        <Group key="side-by-side" orientation="horizontal" className="h-full">
          <Panel id="subtitles" defaultSize="36" minSize={220}>
            <SubtitleFeed />
          </Panel>
          <Separator className="resize-handle" />
          <Panel id="explain" defaultSize="64" minSize={340}>
            <ExplainPanel />
          </Panel>
        </Group>
      )}
      {speakLine && speakHost === 'movie' && <SpeakPanel key={speakLine.id} line={speakLine} />}
    </div>
    </PracticeContext.Provider>
  )
}
