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
import { ArticlesView } from '@renderer/features/articles/ArticlesView'
import { GamesView } from '@renderer/features/games/GamesView'
import { VocabBookView } from '@renderer/features/vocabbook/VocabBookView'
import { HomeView } from '@renderer/features/home/HomeView'
import { SpeakingCoachView } from '@renderer/features/speakingcoach/SpeakingCoachView' // Speaking Coach (added)
import { useArticles } from '@renderer/features/articles/articleStore'
import { Toasts } from '@renderer/components/Toasts'
import { SelectionSaveMenu } from '@renderer/components/SelectionSaveMenu'
import { VoiceAssistant } from '@renderer/features/voice/VoiceAssistant'
import { VoiceModePanel } from '@renderer/features/voice/VoiceMode'

export function App(): ReactNode {
  const page = useApp((s) => s.page)
  const [youtubeVisited, setYoutubeVisited] = useState(false)
  const [articlesVisited, setArticlesVisited] = useState(false)
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
    if (page === 'articles') setArticlesVisited(true)
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
    // Text sent from Chrome (English Companion extension) opens in Articles and is explained there.
    const offWeb = on('articles:external', (sel) => {
      useApp.getState().setPage('articles')
      void useArticles.getState().receiveWeb(sel, 'chrome').catch(toastError)
    })
    const offLearning = on('learning:changed', () => void refreshDue())
    const timer = setInterval(() => void refreshDue(), 60_000)
    return () => {
      offStatus()
      offLine()
      offDocs()
      offWeb()
      offLearning()
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
        {/* Kept mounted after the first visit so the open web page and reading position survive. */}
        {articlesVisited && (
          <div key={`articles-${reloads.articles ?? 0}`} className={page === 'articles' ? 'anim-fade-in h-full' : 'hidden'}>
            <ArticlesView active={page === 'articles'} />
          </div>
        )}
        {page !== 'movie' && page !== 'youtube' && page !== 'articles' && (
          <div key={`${page}-${reloads[page] ?? 0}`} className="anim-fade-in h-full">
            {page === 'home' && <HomeView />}
            {page === 'notes' && <NotesView key="notes" mode="all" />}
            {page === 'structures' && <NotesView key="structures" mode="structures" />}
            {page === 'vocabulary' && <NotesView key="vocabulary" mode="vocabulary" />}
            {page === 'idioms' && <NotesView key="idioms" mode="idioms" />}
            {page === 'room' && <PracticeRoom />}
            {page === 'world' && <EnglishWorld />}
            {page === 'flashcards' && <FlashcardsView />}
            {page === 'prompts' && <PromptManager />}
            {page === 'settings' && <SettingsView />}
            {page === 'games' && <GamesView />}
            {page === 'vocabbook' && <VocabBookView />}
            {page === 'speaking' && <SpeakingCoachView />}
            {(page === 'ielts' || page === 'errors') && <ComingSoon page={page} />}
          </div>
        )}
        <SelectionSaveMenu />
        <VoiceAssistant />
        <VoiceModePanel />
        <Toasts />
      </AppShell>
    </>
  )
}
