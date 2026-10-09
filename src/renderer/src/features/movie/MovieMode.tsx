import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Group, Panel, Separator } from 'react-resizable-panels'
import { SubtitleFeed } from './SubtitleFeed'
import { ExplainPanel } from './ExplainPanel'
import { PracticeContext, createMoviePlayer, usePractice } from '@renderer/features/practice/practiceCore'
import { usePracticeActions } from '@renderer/features/practice/PracticeControls'
import { SpeakPanel } from '@renderer/features/practice/SpeakPanel'

/** Below this width (px) the two panels stack vertically, e.g. in a narrow laptop split-screen window. */
const STACK_BELOW = 640

export function MovieMode(): ReactNode {
  const ref = useRef<HTMLDivElement>(null)
  const [stacked, setStacked] = useState(false)
  const player = useMemo(() => createMoviePlayer(), [])
  const practice = usePracticeActions(player)
  const speakLine = usePractice((s) => s.speakLine)

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
      {speakLine && !/^https?:\/\//i.test(speakLine.mediaPath) && <SpeakPanel key={speakLine.id} line={speakLine} />}
    </div>
    </PracticeContext.Provider>
  )
}
