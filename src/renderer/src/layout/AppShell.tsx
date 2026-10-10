import { useLayoutEffect, useRef, type ReactNode } from 'react'
import { BookOpen, Clapperboard, Gamepad2, GraduationCap, Layers, ListChecks, Puzzle, Settings, Sprout, Wand2 } from 'lucide-react'
import { useApp, type Page } from '@renderer/stores/app'
import { cn } from '@renderer/lib/cn'
import { YouTubeIcon } from '@renderer/features/youtube/YouTubeIcon'
import { Globe2 } from 'lucide-react'

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
  { page: 'world', label: 'English World', icon: <Globe2 className="size-5" /> },
  { page: 'notes', label: 'Notes', icon: <BookOpen className="size-5" /> },
  { page: 'structures', label: 'Structures', icon: <Puzzle className="size-5" /> },
  { page: 'flashcards', label: 'Flashcards', icon: <Layers className="size-5" /> },
  { page: 'games', label: 'Games', icon: <Gamepad2 className="size-5" />, soon: true },
  { page: 'ielts', label: 'IELTS', icon: <GraduationCap className="size-5" />, soon: true },
  { page: 'errors', label: 'Error Log', icon: <ListChecks className="size-5" />, soon: true }
]

const BOTTOM: NavItem[] = [
  { page: 'prompts', label: 'Prompts', icon: <Wand2 className="size-5" /> },
  { page: 'settings', label: 'Settings', icon: <Settings className="size-5" /> }
]

export function AppShell({ children }: { children: ReactNode }): ReactNode {
  const page = useApp((s) => s.page)
  const navRef = useRef<HTMLElement>(null)
  const indicatorRef = useRef<HTMLDivElement>(null)

  // The selection highlight glides to the active item (transform only). Size is set without animation.
  useLayoutEffect(() => {
    const nav = navRef.current
    const indicator = indicatorRef.current
    if (!nav || !indicator) return
    const place = (animate: boolean): void => {
      const btn = nav.querySelector<HTMLElement>(`button[data-page="${page}"]`)
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
          className="relative z-10 mb-3 flex size-9 shrink-0 items-center justify-center rounded-xl text-sm font-bold text-white shadow-[0_4px_14px_rgba(120,27,54,0.3),inset_0_1px_0_rgba(255,255,255,0.3)] lg:size-10"
          style={{ background: 'linear-gradient(145deg, #9a2a4a, #781b36 60%, #5e1229)' }}
          aria-hidden
        >
          En
        </div>
        {MAIN.map((item) => (
          <NavButton key={item.page} item={item} active={page === item.page} />
        ))}
        <div className="flex-1" />
        {BOTTOM.map((item) => (
          <NavButton key={item.page} item={item} active={page === item.page} />
        ))}
      </nav>
      <main className="relative min-w-0 flex-1">{children}</main>
    </div>
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
