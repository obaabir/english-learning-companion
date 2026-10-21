import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react'
import {
  BookA,
  BookMarked,
  BookOpen,
  ChevronRight,
  Clapperboard,
  Gamepad2,
  GraduationCap,
  Layers,
  Library,
  ListChecks,
  Menu,
  Mic,
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
import { listenOnce } from '@renderer/features/voice/VoiceAssistant'
import { VoiceModeButton } from '@renderer/features/voice/VoiceMode'
import { openVoiceMode, useVoiceMode } from '@renderer/features/voice/voiceModeStore'
import { Globe2, RotateCw } from 'lucide-react'
import { useState } from 'react'
import { AudioLines } from 'lucide-react' // Speaking Coach (added)

interface NavItem {
  page: Page
  label: string
  icon: ReactNode
  soon?: boolean
}

/** Always visible in the side bar. */
const RAIL: NavItem[] = [{ page: 'room', label: 'Practice', icon: <Sprout className="size-5" /> }]

/** In the ☰ menu (with the voice icon, JARVIS and Refresh). */
const MENU: NavItem[] = [
  { page: 'movie', label: 'Movies', icon: <Clapperboard className="size-[18px]" /> },
  { page: 'youtube', label: 'YouTube', icon: <YouTubeIcon className="size-[18px]" /> },
  { page: 'speaking', label: 'Speaking Coach', icon: <AudioLines className="size-[18px]" /> },
  { page: 'articles', label: 'Articles', icon: <Newspaper className="size-[18px]" /> },
  { page: 'world', label: 'English World', icon: <Globe2 className="size-[18px]" /> }
]

/** Everything you have saved and your study tools, grouped under one Library menu (side bar). */
const LIBRARY: NavItem[] = [
  { page: 'notes', label: 'Notes', icon: <BookOpen className="size-4" /> },
  { page: 'vocabulary', label: 'English Vocabulary', icon: <BookA className="size-4" /> },
  { page: 'idioms', label: 'Idioms and Expressions', icon: <MessageSquareQuote className="size-4" /> },
  { page: 'structures', label: 'Sentence Structures', icon: <Puzzle className="size-4" /> },
  { page: 'flashcards', label: 'Flashcards', icon: <Layers className="size-4" /> },
  { page: 'games', label: 'Games', icon: <Gamepad2 className="size-4" /> },
  { page: 'vocabbook', label: 'Vocabulary Book Learning', icon: <BookMarked className="size-4" /> },
  { page: 'ielts', label: 'IELTS', icon: <GraduationCap className="size-4" />, soon: true },
  { page: 'errors', label: 'Error Log', icon: <ListChecks className="size-4" />, soon: true }
]
const LIBRARY_PAGES = new Set<Page>(LIBRARY.map((i) => i.page))
const MENU_PAGES = new Set<Page>(MENU.map((i) => i.page))

const BOTTOM: NavItem[] = [
  { page: 'prompts', label: 'Prompts', icon: <Wand2 className="size-5" /> },
  { page: 'settings', label: 'Settings', icon: <Settings className="size-5" /> }
]

export function AppShell({ children }: { children: ReactNode }): ReactNode {
  const page = useApp((s) => s.page)
  const navRef = useRef<HTMLElement>(null)
  const indicatorRef = useRef<HTMLDivElement>(null)
  const menuButtonRef = useRef<HTMLButtonElement>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [libraryAt, setLibraryAt] = useState<number | null>(null)
  // While a JARVIS (Voice Mode) session is on, its button stays in the side bar: you always see that the
  // microphone is in use and can end it with one click.
  const voiceOn = useVoiceMode((s) => s.status !== 'off' && s.status !== 'error')

  // The selection highlight glides to the active item (transform only). Size is set without animation.
  useLayoutEffect(() => {
    const nav = navRef.current
    const indicator = indicatorRef.current
    if (!nav || !indicator) return
    const place = (animate: boolean): void => {
      const btn = nav.querySelector<HTMLElement>(`button[data-page="${MENU_PAGES.has(page) ? 'menu' : LIBRARY_PAGES.has(page) ? 'library' : page}"]`)
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
  }, [page, voiceOn])

  return (
    <div className="relative z-10 flex h-full min-w-0 gap-2 p-2">
      {/* Icons only on narrow windows (e.g. laptop split-screen); names shown from 1024 px. */}
      <nav
        ref={navRef}
        className="glass-panel relative flex w-14 shrink-0 flex-col items-center gap-1 overflow-x-hidden overflow-y-auto py-3 [scrollbar-width:none]! lg:w-[80px]"
        aria-label="Main"
      >
        <div
          ref={indicatorRef}
          aria-hidden
          className="surface-selected pointer-events-none absolute top-0 left-0 rounded-xl border opacity-0 transition-transform duration-[260ms] ease-[var(--ease)] motion-reduce:transition-none"
        />
        <MenuButton ref={menuButtonRef} active={MENU_PAGES.has(page)} open={menuOpen} onToggle={() => setMenuOpen(!menuOpen)} />
        <LibraryButton active={LIBRARY_PAGES.has(page)} open={libraryAt !== null} onToggle={(top) => setLibraryAt(libraryAt === null ? top : null)} />
        <div className="my-1.5 h-px w-8 shrink-0 bg-white/10" aria-hidden />
        {voiceOn && <VoiceModeButton />}
        {RAIL.map((item) => (
          <NavButton key={item.page} item={item} active={page === item.page} />
        ))}
        <div className="flex-1" />
        {BOTTOM.map((item) => (
          <NavButton key={item.page} item={item} active={page === item.page} />
        ))}
      </nav>
      {menuOpen && (
        <NavMenu
          page={page}
          anchor={menuButtonRef.current}
          onClose={(refocus) => {
            setMenuOpen(false)
            if (refocus) menuButtonRef.current?.focus()
          }}
        />
      )}
      {libraryAt !== null && <LibraryMenu top={libraryAt} page={page} onClose={() => setLibraryAt(null)} />}
      <main className="relative min-w-0 flex-1">{children}</main>
    </div>
  )
}

/** ☰ — opens the navigation menu. Shows the flashcards due count (Library is inside the menu). */
function MenuButton({ ref, active, open, onToggle }: { ref: React.Ref<HTMLButtonElement>; active: boolean; open: boolean; onToggle: () => void }): ReactNode {
  return (
    <button
      ref={ref}
      data-page="menu"
      data-menu-toggle
      onClick={onToggle}
      aria-haspopup="menu"
      aria-expanded={open}
      aria-label="Menu"
      title="Menu: Movies, YouTube, Speaking Coach, Articles, English World, voice, JARVIS, Refresh"
      className={cn(
        'motion-press relative z-10 flex w-11 shrink-0 flex-col items-center gap-1 rounded-xl px-1 py-2 text-[10.5px] font-medium lg:w-[66px]',
        active || open ? 'text-accent' : 'text-fg'
      )}
    >
      <Menu className="size-5" strokeWidth={2.2} />
      <span className="hidden leading-none lg:block">Menu</span>
    </button>
  )
}

function NavButton({ item, active }: { item: NavItem; active: boolean }): ReactNode {
  const setPage = useApp((s) => s.setPage)
  return (
    <button
      data-page={item.page}
      onClick={() => setPage(item.page)}
      aria-current={active ? 'page' : undefined}
      aria-label={item.label}
      title={item.label}
      className={cn(
        'motion-press relative z-10 flex w-11 shrink-0 flex-col items-center gap-1 rounded-xl px-1 py-2 text-[10.5px] font-medium lg:w-[66px]',
        active ? 'text-accent' : 'text-muted hover:text-fg',
        item.soon && !active && 'opacity-60'
      )}
    >
      {item.icon}
      <span className="hidden leading-none lg:block">{item.label}</span>
    </button>
  )
}

/**
 * The ☰ menu, beside the side bar: Movies, YouTube, Speaking Coach, Articles, English World, the voice
 * command (same as the old mic icon), JARVIS and Refresh. Arrow keys / Home / End move, Escape closes; clicking outside closes it.
 */
function NavMenu({ page, anchor, onClose }: { page: Page; anchor: HTMLElement | null; onClose: (refocus: boolean) => void }): ReactNode {
  const ref = useRef<HTMLDivElement>(null)
  const setPage = useApp((s) => s.setPage)
  const [spin, setSpin] = useState(false)

  useEffect(() => {
    // Focus the current item (or the first) when the menu opens.
    const items = [...(ref.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])]
    ;(items.find((i) => i.getAttribute('aria-current') === 'page') ?? items[0])?.focus()
    const onDown = (e: MouseEvent): void => {
      const t = e.target as Element
      if (!ref.current?.contains(t) && !t.closest?.('[data-menu-toggle]')) onClose(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [onClose])

  const go = (p: Page): void => {
    setPage(p)
    onClose(false)
  }
  const top = Math.max(8, (anchor?.getBoundingClientRect().top ?? 8) - 6)
  const item = (opts: { key: string; label: string; icon: ReactNode; active?: boolean; onClick: () => void; extra?: ReactNode; sub?: boolean; expanded?: boolean; soon?: boolean }): ReactNode => (
    <button
      key={opts.key}
      role="menuitem"
      data-menu-item={opts.key}
      onClick={opts.onClick}
      aria-current={opts.active ? 'page' : undefined}
      aria-expanded={opts.expanded}
      className={cn(
        'motion-press flex w-full items-center gap-2.5 rounded-[11px] border text-left font-medium outline-none',
        opts.sub ? 'h-8 pr-2.5 pl-9 text-[13px]' : 'h-10 px-3 text-sm',
        opts.active ? 'surface-selected text-accent' : 'border-transparent',
        !opts.active && (opts.soon ? 'text-muted' : 'text-fg')
      )}
    >
      <span className="shrink-0">{opts.icon}</span>
      <span className="min-w-0 flex-1 truncate">{opts.label}</span>
      {opts.extra}
    </button>
  )

  return (
    <div
      ref={ref}
      role="menu"
      aria-label="Navigation"
      style={{ top }}
      className="glass-elevated anim-pop-in fixed left-[72px] z-50 w-64 rounded-2xl lg:left-[96px]"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault()
          return onClose(true)
        }
        if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return
        e.preventDefault()
        const items = [...(ref.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])]
        const i = items.indexOf(document.activeElement as HTMLElement)
        const next = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : (i + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length
        items[next]?.focus()
      }}
    >
      {/* Only the list scrolls (on a short window); the glass edge stays outside it. */}
      <div className="overflow-x-hidden overflow-y-auto p-1.5 [scrollbar-width:thin]" style={{ maxHeight: `calc(100vh - ${top + 8}px)` }}>
      {MENU.map((m) => item({ key: m.page, label: m.label, icon: m.icon, active: page === m.page, onClick: () => go(m.page) }))}
      {item({
        key: 'jarvis',
        label: 'JARVIS Voice Assistant',
        icon: <AudioLines className="size-[18px] text-[var(--lime)]" />,
        onClick: () => {
          openVoiceMode()
          onClose(false)
        }
      })}
      {/* The voice icon: listens for one command (same as before; Alt+J also works). */}
      {item({
        key: 'voice',
        label: 'Voice command',
        icon: <Mic className="size-[18px]" />,
        extra: <span className="text-[10px] text-muted">Alt+J</span>,
        onClick: () => {
          onClose(false)
          void listenOnce()
        }
      })}
      <div className="mx-2 my-1 h-px bg-white/10" aria-hidden />
      {/* Refresh: reloads only the section on screen (its data is fetched again); a movie keeps playing. */}
      {item({
        key: 'refresh',
        label: 'Refresh this section',
        icon: <RotateCw className={cn('size-[18px]', spin && 'animate-spin')} />,
        onClick: () => {
          setSpin(true)
          window.dispatchEvent(new CustomEvent('elc:reload-section'))
          setTimeout(() => {
            setSpin(false)
            onClose(false)
          }, 450)
        }
      })}
      </div>
    </div>
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
        active || open ? 'text-accent' : 'text-muted hover:text-fg'
      )}
    >
      <Library className="size-5" />
      <span className="hidden leading-none lg:block">Library</span>
      {due > 0 && (
        <span className="absolute top-0.5 right-0.5 min-w-4 rounded-full bg-accent px-1 text-[10px] leading-4 text-accent-fg tabular-nums lg:top-1 lg:right-2">
          {due > 99 ? '99+' : due}
        </span>
      )}
    </button>
  )
}

/** The Library menu, opened beside the side bar. Closes on choosing an item, clicking outside or Escape. */
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

  // Keep the whole menu on screen (9 items, about 430px).
  const y = Math.max(8, Math.min(top - 8, window.innerHeight - 440))
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
            data-menu-item={item.page}
            onClick={() => {
              setPage(item.page)
              onClose()
            }}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'motion-press flex h-9 w-full items-center gap-2.5 rounded-[10px] border px-2.5 text-left text-sm font-medium outline-none',
              active ? 'surface-selected text-accent' : 'border-transparent',
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
