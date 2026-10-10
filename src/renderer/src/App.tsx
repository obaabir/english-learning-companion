import { useEffect, useState, type ReactNode } from 'react'
import { invoke, on } from '@renderer/lib/api'
import { useApp } from '@renderer/stores/app'
import { useMovie } from '@renderer/stores/movie'
import { AppShell } from '@renderer/layout/AppShell'
import { MovieMode } from '@renderer/features/movie/MovieMode'
import { NotesView } from '@renderer/features/notes/NotesView'
import { FlashcardsView } from '@renderer/features/flashcards/FlashcardsView'
import { PromptManager } from '@renderer/features/prompts/PromptManager'
import { SettingsView } from '@renderer/features/settings/SettingsView'
import { ComingSoon } from '@renderer/features/ComingSoon'
import { YouTubeView } from '@renderer/features/youtube/YouTubeView'
import { PracticeRoom } from '@renderer/features/room/PracticeRoom'
import { EnglishWorld } from '@renderer/features/englishworld/EnglishWorld'
import { Toasts } from '@renderer/components/Toasts'
import { SelectionSaveMenu } from '@renderer/components/SelectionSaveMenu'

export function App(): ReactNode {
  const page = useApp((s) => s.page)
  const [youtubeVisited, setYoutubeVisited] = useState(false)
  // Reload button (top left): remounts only the section on screen so it loads its data again.
  const [reloads, setReloads] = useState<Record<string, number>>({})
  useEffect(() => {
    const onReload = (): void => {
      const p = useApp.getState().page
      setReloads((r) => ({ ...r, [p]: (r[p] ?? 0) + 1 }))
    }
    window.addEventListener('elc:reload-section', onReload)
    return () => window.removeEventListener('elc:reload-section', onReload)
  }, [])
  useEffect(() => {
    if (page === 'youtube') setYoutubeVisited(true)
  }, [page])

  useEffect(() => {
    const { loadSettings, loadPrompts, refreshDue, toastError } = useApp.getState()
    const { setStatus, addLine } = useMovie.getState()
    Promise.all([loadSettings(), loadPrompts(), refreshDue()]).catch(toastError)
    void invoke('player:status').then(setStatus)
    const offStatus = on('player:status', setStatus)
    const offLine = on('player:subtitle', addLine)
    const offDocs = on('notes:docsResult', (r) => {
      const { toast } = useApp.getState()
      if (r.ok) toast('success', 'Added to Google Docs')
      else toast('error', `Saved to notes, but Google Docs failed: ${r.error ?? 'unknown error'}`)
    })
    const timer = setInterval(() => void refreshDue(), 60_000)
    return () => {
      offStatus()
      offLine()
      offDocs()
      clearInterval(timer)
    }
  }, [])

  return (
    <>
      {/* Static soft shapes behind the glass panels (painted once, never animated). */}
      <div className="ambient" aria-hidden>
        <span className="orb-1" />
        <span className="orb-2" />
        <span className="orb-3" />
      </div>
      <AppShell>
        {/* Movie Mode stays mounted so the subtitle feed and scroll position survive page switches. */}
        <div key={`movie-${reloads.movie ?? 0}`} className={page === 'movie' ? 'anim-fade-in h-full' : 'hidden'}>
          <MovieMode />
        </div>
        {/* Mounted on first visit, then kept (paused while hidden) so the video and selection survive. */}
        {youtubeVisited && (
          <div key={`youtube-${reloads.youtube ?? 0}`} className={page === 'youtube' ? 'anim-fade-in h-full' : 'hidden'}>
            <YouTubeView active={page === 'youtube'} />
          </div>
        )}
        {page !== 'movie' && page !== 'youtube' && (
          <div key={`${page}-${reloads[page] ?? 0}`} className="anim-fade-in h-full">
            {page === 'notes' && <NotesView key="notes" mode="all" />}
            {page === 'structures' && <NotesView key="structures" mode="structures" />}
            {page === 'room' && <PracticeRoom />}
            {page === 'world' && <EnglishWorld />}
            {page === 'flashcards' && <FlashcardsView />}
            {page === 'prompts' && <PromptManager />}
            {page === 'settings' && <SettingsView />}
            {(page === 'games' || page === 'ielts' || page === 'errors') && <ComingSoon page={page} />}
          </div>
        )}
        <SelectionSaveMenu />
        <Toasts />
      </AppShell>
    </>
  )
}
