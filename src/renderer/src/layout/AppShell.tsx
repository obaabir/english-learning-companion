import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react'
import {
  BookA,
  BookOpen,
  ChevronRight,
  Clapperboard,
  Gamepad2,
  GraduationCap,
  Layers,
  Library,
  ListChecks,
  MessageSquareQuote,
  Newspaper,
  Puzzle,
  Settings,
  Sprout,
  Wand2
} from 'lucide-react'
import { useApp, type Page } from '@renderer/stores/app'
import { cn } from '@renderer/lib/cn'
import { YouTubeIcon } from '@renderer/features/youtube/YouTubeIcon'
import { Globe2, RotateCw } from 'lucide-react'
import { useState } from 'react'

interface NavItem {
  page: Page
  label: string
  icon: ReactNode
  soon?: boolean
}

const MAIN: NavItem[] = [
  { page: 'movie', label: 'Movie Mode', icon: <Clapperboard className="size-5" /> },
  { page: 'youtube', label: 'YouTube', icon: <YouTubeIcon className="size-5" /> },
  { page: 'room', label: 'Practice', icon: <Sprout className="size-5" /> },
  { page: 'articles', label: 'Articles', icon: <Newspaper className="size-5" /> },
  { page: 'world', label: 'English World', icon: <Globe2 className="size-5" /> }
]

/** Everything you have saved and your study tools, grouped under one Library menu. */
const LIBRARY: NavItem[] = [
  { page: 'notes', label: 'Notes', icon: <BookOpen className="size-4" /> },
  { page: 'vocabulary', label: 'English Vocabulary', icon: <BookA className="size-4" /> },
  { page: 'idioms', label: 'Idioms and Expressions', icon: <MessageSquareQuote className="size-4" /> },
  { page: 'structures', label: 'Sentence Structures', icon: <Puzzle className="size-4" /> },
  { page: 'flashcards', label: 'Flashcards', icon: <Layers className="size-4" /> },
  { page: 'games', label: 'Games', icon: <Gamepad2 className="size-4" />, soon: true },
  { page: 'ielts', label: 'IELTS', icon: <GraduationCap className="size-4" />, soon: true },
  { page: 'errors', label: 'Error Log', icon: <ListChecks className="size-4" />, soon: true }
]
const LIBRARY_PAGES = new Set<Page>(LIBRARY.map((i) => i.page))

const BOTTOM: NavItem[] = [
  { page: 'prompts', label: 'Prompts', icon: <Wand2 className="size-5" /> },
  { page: 'settings', label: 'Settings', icon: <Settings className="size-5" /> }
]

export function AppShell({ children }: { children: ReactNode }): ReactNode {
  const page = useApp((s) => s.page)
  const navRef = useRef<HTMLElement>(null)
  const indicatorRef = useRef<HTMLDivElement>(null)
  const [libraryAt, setLibraryAt] = useState<number | null>(null)

  // The selection highlight glides to the active item (transform only). Size is set without animation.
  useLayoutEffect(() => {
    const nav = navRef.current
    const indicator = indicatorRef.current
    if (!nav || !indicator) return
    const place = (animate: boolean): void => {
      const btn = nav.querySelector<HTMLElement>(`button[data-page="${LIBRARY_PAGES.has(page) ? 'library' : page}"]`)
      if (!btn) return
      indicator.style.transitionDuration = animate ? '' : '0ms'
      indicator.style.width = `${btn.offsetWidth}px`
      indicator.style.height = `${btn.offsetHeight}px`
      indicator.style.transform = `translate3d(${btn.offsetLeft}px, ${btn.offsetTop}px, 0)`
      indicator.style.opacity = '1'
    }
    place(true)
    const observer = new ResizeObserver(() => place(false))
    observer.observe(nav)
    return () => observer.disconnect()
  }, [page])

  return (
    <div className="relative z-10 flex h-full min-w-0 gap-2 p-2">
      {/* Icons only on narrow windows (e.g. laptop split-screen); names shown from 1024 px. */}
      <nav
        ref={navRef}
        className="glass-panel relative flex w-14 shrink-0 flex-col items-center gap-1 overflow-x-hidden overflow-y-auto py-3 [scrollbar-width:none] lg:w-[80px]"
        aria-label="Main"
      >
        <div
          ref={indicatorRef}
          aria-hidden
          className="surface-selected pointer-events-none absolute top-0 left-0 rounded-xl border opacity-0 transition-transform duration-[260ms] ease-[var(--ease)] motion-reduce:transition-none"
        />
        <div
          className="relative z-10 mb-3 flex size-9 shrink-0 items-center justify-center rounded-xl text-sm font-bold text-[#fff] shadow-[0_4px_14px_rgba(120,27,54,0.3),inset_0_1px_0_rgba(255,255,255,0.3)] lg:size-10"
          style={{ background: 'linear-gradient(145deg, #9a2a4a, #781b36 60%, #5e1229)' }}
          aria-hidden
        >
          En
        </div>
        <ReloadButton />
        {MAIN.map((item) => (
          <NavButton key={item.page} item={item} active={page === item.page} />
        ))}
        <LibraryButton active={LIBRARY_PAGES.has(page)} open={libraryAt !== null} onToggle={(top) => setLibraryAt(libraryAt === null ? top : null)} />
        <div className="flex-1" />
        {BOTTOM.map((item) => (
          <NavButton key={item.page} item={item} active={page === item.page} />
        ))}
      </nav>
      {libraryAt !== null && <LibraryMenu top={libraryAt} page={page} onClose={() => setLibraryAt(null)} />}
      <main className="relative min-w-0 flex-1">{children}</main>
    </div>
  )
}

/** Reloads only the section on screen (its data is fetched again); the movie and subtitles keep playing. */
function ReloadButton(): ReactNode {
  const [spin, setSpin] = useState(false)
  return (
    <button
      onClick={() => {
        setSpin(true)
        setTimeout(() => setSpin(false), 700)
        window.dispatchEvent(new CustomEvent('elc:reload-section'))
      }}
      aria-label="Reload this section"
      title="Reload this section"
      className="motion-press relative z-10 mb-2 flex size-9 shrink-0 items-center justify-center rounded-xl text-muted hover:bg-white/55 hover:text-fg lg:size-10"
    >
      <RotateCw className={spin ? 'size-[18px] animate-spin' : 'size-[18px]'} />
    </button>
  )
}

function NavButton({ item, active }: { item: NavItem; active: boolean }): ReactNode {
  const setPage = useApp((s) => s.setPage)
  const due = useApp((s) => (item.page === 'flashcards' ? s.dueCount : 0))
  return (
    <button
      data-page={item.page}
      onClick={() => setPage(item.page)}
      aria-current={active ? 'page' : undefined}
      aria-label={item.label}
      title={item.label}
      className={cn(
        'motion-press relative z-10 flex w-11 shrink-0 flex-col items-center gap-1 rounded-xl px-1 py-2 text-[10.5px] font-medium lg:w-[66px]',
        active ? 'text-accent' : 'text-muted hover:bg-white/55 hover:text-fg',
        item.soon && !active && 'opacity-60'
      )}
    >
      {item.icon}
      <span className="hidden leading-none lg:block">{item.label}</span>
      {due > 0 && (
        <span className="absolute top-0.5 right-0.5 min-w-4 rounded-full bg-accent px-1 text-[10px] leading-4 text-accent-fg tabular-nums shadow-[0_2px_6px_rgba(120,27,54,0.35)] lg:top-1 lg:right-2">
          {due > 99 ? '99+' : due}
        </span>
      )}
    </button>
  )
}

function LibraryButton({ active, open, onToggle }: { active: boolean; open: boolean; onToggle: (top: number) => void }): ReactNode {
  const due = useApp((s) => s.dueCount)
  return (
    <button
      data-page="library"
      data-library-toggle
      onClick={(e) => onToggle(e.currentTarget.getBoundingClientRect().top)}
      aria-haspopup="menu"
      aria-expanded={open}
      aria-label="Library"
      title="Library"
      className={cn(
        'motion-press relative z-10 flex w-11 shrink-0 flex-col items-center gap-1 rounded-xl px-1 py-2 text-[10.5px] font-medium lg:w-[66px]',
        active || open ? 'text-accent' : 'text-muted hover:bg-white/55 hover:text-fg'
      )}
    >
      <Library className="size-5" />
      <span className="hidden leading-none lg:block">Library</span>
      {due > 0 && (
        <span className="absolute top-0.5 right-0.5 min-w-4 rounded-full bg-accent px-1 text-[10px] leading-4 text-accent-fg tabular-nums shadow-[0_2px_6px_rgba(120,27,54,0.35)] lg:top-1 lg:right-2">
          {due > 99 ? '99+' : due}
        </span>
      )}
    </button>
  )
}

/** The Library menu, opened beside the nav. Closes on choosing an item, clicking outside or Escape. */
function LibraryMenu({ top, page, onClose }: { top: number; page: Page; onClose: () => void }): ReactNode {
  const ref = useRef<HTMLDivElement>(null)
  const setPage = useApp((s) => s.setPage)
  const due = useApp((s) => s.dueCount)

  useEffect(() => {
    const onDown = (e: MouseEvent): void => {
      const t = e.target as Element
      if (!ref.current?.contains(t) && !t.closest?.('[data-library-toggle]')) onClose()
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  // Keep the whole menu on screen (8 items, about 390px).
  const y = Math.max(8, Math.min(top - 8, window.innerHeight - 400))
  return (
    <div
      ref={ref}
      role="menu"
      aria-label="Library"
      style={{ top: y }}
      className="glass-elevated anim-pop-in fixed left-[72px] z-50 w-60 rounded-2xl p-1.5 lg:left-[96px]"
      onKeyDown={(e) => {
        if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
        e.preventDefault()
        const items = [...(ref.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])]
        const i = items.indexOf(document.activeElement as HTMLElement)
        items[(i + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus()
      }}
    >
      <p className="px-2.5 pt-1 pb-1.5 text-[11px] font-semibold tracking-wide text-muted uppercase">Library</p>
      {LIBRARY.map((item) => {
        const active = page === item.page
        return (
          <button
            key={item.page}
            role="menuitem"
            onClick={() => {
              setPage(item.page)
              onClose()
            }}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'motion-press flex h-9 w-full items-center gap-2.5 rounded-[10px] border px-2.5 text-left text-sm font-medium outline-none',
              active ? 'surface-selected text-accent' : 'border-transparent hover:bg-white/55 focus-visible:bg-white/55',
              !active && (item.soon ? 'text-muted' : 'text-fg')
            )}
          >
            <span className="shrink-0">{item.icon}</span>
            <span className="min-w-0 flex-1 truncate">{item.label}</span>
            {item.page === 'flashcards' && due > 0 && (
              <span className="min-w-4 rounded-full bg-accent px-1 text-[10px] leading-4 text-accent-fg tabular-nums">{due > 99 ? '99+' : due}</span>
            )}
            {item.soon ? <span className="text-[10px] text-muted">soon</span> : <ChevronRight className="size-3.5 shrink-0 text-muted/60" />}
          </button>
        )
      })}
    </div>
  )
}
