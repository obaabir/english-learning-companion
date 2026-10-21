import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  ArrowLeft,
  AudioLines,
  BookA,
  BookMarked,
  BookOpen,
  ChevronDown,
  Clapperboard,
  Gamepad2,
  Globe2,
  GraduationCap,
  House,
  Layers,
  Library,
  ListChecks,
  Menu,
  MessageSquareQuote,
  Newspaper,
  Puzzle,
  RotateCw,
  Settings,
  Sprout,
  Wand2,
  X
} from 'lucide-react'
import { HOME_PAGE, useApp, type Page } from '@renderer/stores/app'
import { cn } from '@renderer/lib/cn'
import { useEscape } from '@renderer/lib/navigation'
import { YouTubeIcon } from '@renderer/features/youtube/YouTubeIcon'
import { VoiceModeButton } from '@renderer/features/voice/VoiceMode'
import { useVoiceMode } from '@renderer/features/voice/voiceModeStore'

interface NavItem {
  page: Page
  label: string
  icon: ReactNode
  soon?: boolean
}
interface NavGroup {
  key: 'practice' | 'library'
  label: string
  icon: ReactNode
  items: NavItem[]
}

/** The drawer's six destinations: four direct sections and two groups (their existing pages inside). */
const DIRECT: NavItem[] = [
  { page: 'movie', label: 'Movies', icon: <Clapperboard className="size-[18px]" /> },
  { page: 'youtube', label: 'YouTube', icon: <YouTubeIcon className="size-[18px]" /> },
  { page: 'speaking', label: 'Speaking Coach', icon: <AudioLines className="size-[18px]" /> },
  { page: 'articles', label: 'Articles', icon: <Newspaper className="size-[18px]" /> }
]
const GROUPS: NavGroup[] = [
  {
    key: 'practice',
    label: 'Practice',
    icon: <Sprout className="size-[18px]" />,
    items: [
      { page: 'room', label: 'Practice Room', icon: <Sprout className="size-4" /> },
      { page: 'flashcards', label: 'Flashcards', icon: <Layers className="size-4" /> },
      { page: 'games', label: 'Games', icon: <Gamepad2 className="size-4" /> },
      { page: 'vocabbook', label: 'Vocabulary Book', icon: <BookMarked className="size-4" /> },
      { page: 'ielts', label: 'IELTS', icon: <GraduationCap className="size-4" />, soon: true }
    ]
  },
  {
    key: 'library',
    label: 'Library',
    icon: <Library className="size-[18px]" />,
    items: [
      { page: 'notes', label: 'Notes', icon: <BookOpen className="size-4" /> },
      { page: 'vocabulary', label: 'English Vocabulary', icon: <BookA className="size-4" /> },
      { page: 'idioms', label: 'Idioms and Expressions', icon: <MessageSquareQuote className="size-4" /> },
      { page: 'structures', label: 'Sentence Structures', icon: <Puzzle className="size-4" /> },
      { page: 'errors', label: 'Error Log', icon: <ListChecks className="size-4" />, soon: true },
      { page: 'world', label: 'English World', icon: <Globe2 className="size-4" /> }
    ]
  }
]
/** At the bottom of the drawer, apart from the learning sections. */
const BOTTOM: NavItem[] = [
  { page: 'prompts', label: 'Prompts', icon: <Wand2 className="size-[18px]" /> },
  { page: 'settings', label: 'Settings', icon: <Settings className="size-[18px]" /> }
]
const groupOf = (page: Page): NavGroup['key'] | null => GROUPS.find((g) => g.items.some((i) => i.page === page))?.key ?? null

export function AppShell({ children }: { children: ReactNode }): ReactNode {
  const page = useApp((s) => s.page)
  const pendingLeave = useApp((s) => s.pendingLeave)
  const menuButtonRef = useRef<HTMLButtonElement>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const home = page === HOME_PAGE
  // While a JARVIS (Voice Mode) session is on, its button stays visible on feature pages: you always
  // see that the microphone is in use and can open its panel with one click.
  const voiceOn = useVoiceMode((s) => s.status !== 'off' && s.status !== 'error')

  // Back from anywhere: Alt+Left, or the mouse's back button.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.altKey && e.key === 'ArrowLeft' && !e.defaultPrevented) {
        e.preventDefault()
        useApp.getState().goBack()
      }
    }
    const onMouse = (e: MouseEvent): void => {
      if (e.button === 3) {
        e.preventDefault()
        useApp.getState().goBack()
      }
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('mouseup', onMouse)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('mouseup', onMouse)
    }
  }, [])

  const closeDrawer = (refocus: boolean): void => {
    setDrawerOpen(false)
    if (refocus) menuButtonRef.current?.focus()
  }

  return (
    <div className={cn('relative z-10 flex h-full min-w-0', home ? '' : 'gap-2 p-2')}>
      {home ? (
        // Home: the whole screen; only the small menu button, top left.
        <div className="fixed top-4 left-4 z-40">
          <MenuButton ref={menuButtonRef} open={drawerOpen} onToggle={() => setDrawerOpen(!drawerOpen)} />
        </div>
      ) : (
        // Inside a feature: the menu button, then Back and Home, in a slim column.
        <nav aria-label="Main" className="flex w-11 shrink-0 flex-col items-center gap-1.5 pt-1">
          <MenuButton ref={menuButtonRef} open={drawerOpen} onToggle={() => setDrawerOpen(!drawerOpen)} />
          <BackHome />
          {voiceOn && (
            <div className="mt-1">
              <VoiceModeButton />
            </div>
          )}
        </nav>
      )}
      <main className="relative min-w-0 flex-1">{children}</main>
      {drawerOpen && <Drawer page={page} onClose={closeDrawer} />}
      {pendingLeave && <LeaveDialog />}
    </div>
  )
}

function MenuButton({ ref, open, onToggle }: { ref: React.Ref<HTMLButtonElement>; open: boolean; onToggle: () => void }): ReactNode {
  return (
    <button
      ref={ref}
      data-page="menu"
      onClick={onToggle}
      aria-haspopup="dialog"
      aria-expanded={open}
      aria-label="Menu"
      title="Menu"
      className="glass-panel motion-press flex size-11 shrink-0 items-center justify-center rounded-xl! text-fg"
    >
      <Menu className="size-5" />
    </button>
  )
}

/** Back and Home, under the menu button inside a feature. */
function BackHome(): ReactNode {
  const goBack = useApp((s) => s.goBack)
  const goHome = useApp((s) => s.goHome)
  const cls = 'motion-press relative z-10 flex size-11 shrink-0 flex-col items-center justify-center gap-0.5 rounded-xl text-[9.5px] font-medium text-muted hover:text-fg'
  return (
    <div className="flex shrink-0 flex-col items-center gap-0.5" data-back-home>
      <button data-nav="back" onClick={goBack} aria-label="Back" title="Back to the previous screen (Alt+←)" className={cls}>
        <ArrowLeft className="size-4 shrink-0" />
        <span className="leading-none">Back</span>
      </button>
      <button data-nav="home" onClick={goHome} aria-label="Home" title="Home" className={cls}>
        <House className="size-4 shrink-0" />
        <span className="leading-none">Home</span>
      </button>
    </div>
  )
}

/**
 * The navigation drawer: slides in from the left over a dimmed backdrop. Six destinations (Practice and
 * Library open their sections in place), Prompts and Settings at the bottom. Closes on choosing a page,
 * the × button, a click on the backdrop, or Escape.
 */
function Drawer({ page, onClose }: { page: Page; onClose: (refocus: boolean) => void }): ReactNode {
  const ref = useRef<HTMLDivElement>(null)
  const setPage = useApp((s) => s.setPage)
  const goHome = useApp((s) => s.goHome)
  const due = useApp((s) => s.dueCount)
  const [openGroup, setOpenGroup] = useState<NavGroup['key'] | null>(groupOf(page))
  useEscape(() => onClose(true))

  useEffect(() => {
    // Focus the current destination (or the first one) for keyboard use.
    const el = ref.current?.querySelector<HTMLElement>('[aria-current="page"]') ?? ref.current?.querySelector<HTMLElement>('[data-menu-item]')
    el?.focus()
  }, [])

  const go = (p: Page): void => {
    onClose(false)
    setPage(p)
  }
  const row = (item: NavItem, sub = false): ReactNode => {
    const active = page === item.page
    return (
      <button
        key={item.page}
        data-menu-item={item.page}
        onClick={() => go(item.page)}
        aria-current={active ? 'page' : undefined}
        className={cn(
          'motion-press flex w-full items-center gap-3 rounded-xl border text-left font-medium outline-none',
          sub ? 'h-9 pr-2.5 pl-10 text-[13px]' : 'h-11 px-3 text-sm',
          active ? 'surface-selected text-accent' : 'border-transparent',
          !active && (item.soon ? 'text-muted' : 'text-fg')
        )}
      >
        <span className="shrink-0">{item.icon}</span>
        <span className="min-w-0 flex-1 truncate">{item.label}</span>
        {item.page === 'flashcards' && due > 0 && (
          <span className="min-w-4 rounded-full bg-accent px-1 text-center text-[10px] leading-4 text-accent-fg tabular-nums">{due > 99 ? '99+' : due}</span>
        )}
        {item.soon && <span className="text-[10px] text-muted">soon</span>}
      </button>
    )
  }

  return (
    <div className="fixed inset-0 z-50" role="presentation">
      <div className="anim-fade-in absolute inset-0 bg-black/55" onMouseDown={() => onClose(true)} aria-hidden />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label="Navigation"
        className="glass-elevated drawer-in absolute inset-y-2 left-2 flex w-[min(300px,calc(100vw-1rem))] flex-col rounded-2xl!"
        onKeyDown={(e) => {
          if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') return
          e.preventDefault()
          const items = [...(ref.current?.querySelectorAll<HTMLElement>('[data-menu-item], [data-menu-group]') ?? [])]
          const i = items.indexOf(document.activeElement as HTMLElement)
          const next = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : (i + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length
          items[next]?.focus()
        }}
      >
        <div className="flex h-14 shrink-0 items-center gap-2 px-4">
          <button onClick={() => (onClose(false), goHome())} className="flex items-center gap-2 rounded-lg text-[15px] font-semibold" title="Home">
            <House className="size-[18px]" style={{ color: 'var(--lime)' }} />
            English Companion
          </button>
          <button onClick={() => onClose(true)} aria-label="Close menu" title="Close (Esc)" className="motion-press ml-auto flex size-8 items-center justify-center rounded-lg text-muted hover:text-fg">
            <X className="size-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 space-y-0.5 overflow-x-hidden overflow-y-auto px-2 pb-2">
          {DIRECT.map((item) => row(item))}
          <div className="mx-2 my-2 h-px bg-white/10" aria-hidden />
          {GROUPS.map((g) => {
            const expanded = openGroup === g.key
            const inside = groupOf(page) === g.key
            return (
              <div key={g.key}>
                <button
                  data-menu-group={g.key}
                  onClick={() => setOpenGroup(expanded ? null : g.key)}
                  aria-expanded={expanded}
                  className={cn('motion-press flex h-11 w-full items-center gap-3 rounded-xl border border-transparent px-3 text-left text-sm font-medium outline-none', inside ? 'text-accent' : 'text-fg')}
                >
                  <span className="shrink-0">{g.icon}</span>
                  <span className="min-w-0 flex-1 truncate">{g.label}</span>
                  {g.key === 'practice' && due > 0 && !expanded && (
                    <span className="min-w-4 rounded-full bg-accent px-1 text-center text-[10px] leading-4 text-accent-fg tabular-nums">{due > 99 ? '99+' : due}</span>
                  )}
                  <ChevronDown className={cn('size-4 shrink-0 text-muted transition-transform duration-200', expanded && 'rotate-180')} />
                </button>
                {expanded && <div className="anim-fade-in space-y-0.5 pb-1">{g.items.map((i) => row(i, true))}</div>}
              </div>
            )
          })}
        </div>
        <div className="shrink-0 space-y-0.5 border-t border-white/10 p-2">
          {BOTTOM.map((item) => row(item))}
          <button
            data-menu-item="refresh"
            onClick={() => {
              onClose(false)
              window.dispatchEvent(new Event('elc:reload-section'))
            }}
            className="motion-press flex h-9 w-full items-center gap-3 rounded-xl border border-transparent px-3 text-left text-[13px] text-muted outline-none hover:text-fg"
          >
            <RotateCw className="size-4" />
            Refresh this section
          </button>
        </div>
      </div>
    </div>
  )
}

/** Leaving a page with unsaved work: save, discard, or keep editing (Escape keeps editing). */
function LeaveDialog(): ReactNode {
  const guard = useApp((s) => s.leaveGuard)
  const resolveLeave = useApp((s) => s.resolveLeave)
  const [saving, setSaving] = useState(false)
  const stay = (): void => void resolveLeave('stay')
  useEscape(stay)
  const keepRef = useRef<HTMLButtonElement>(null)
  useEffect(() => keepRef.current?.focus(), [])
  return (
    <div className="anim-fade-in fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4" onMouseDown={stay}>
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="leave-title"
        className="glass-elevated anim-pop-in w-full max-w-md rounded-2xl p-5"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 id="leave-title" className="text-base font-semibold">
          Save your changes?
        </h2>
        <p className="mt-1.5 text-sm text-muted">You have unsaved changes to {guard?.what ?? 'this page'}. Nothing is deleted if you leave.</p>
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button ref={keepRef} onClick={stay} className="motion-press h-9 rounded-xl border border-white/15 px-3.5 text-sm font-medium">
            Keep editing
          </button>
          <button onClick={() => void resolveLeave('discard')} className="motion-press h-9 rounded-xl border border-white/15 px-3.5 text-sm font-medium">
            Discard changes
          </button>
          <button
            disabled={saving}
            onClick={() => {
              setSaving(true)
              void resolveLeave('save').finally(() => setSaving(false))
            }}
            className="btn-burgundy motion-press h-9 rounded-xl px-3.5 text-sm font-semibold"
          >
            {saving ? 'Saving…' : 'Save and leave'}
          </button>
        </div>
      </div>
    </div>
  )
}
