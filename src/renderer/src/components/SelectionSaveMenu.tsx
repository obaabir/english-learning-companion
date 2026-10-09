import { useEffect, useRef, useState, type ReactNode } from 'react'
import { BookmarkPlus, FileText, Sparkles } from 'lucide-react'
import type { NoteKind } from '@shared/types'
import { invoke } from '@renderer/lib/api'
import { useApp } from '@renderer/stores/app'
import { useMovie } from '@renderer/stores/movie'
import { useChat } from '@renderer/stores/chat'
import { cn } from '@renderer/lib/cn'

interface MenuState {
  text: string
  context: string | null
  x: number
  y: number
}

const KINDS: { kind: NoteKind; label: string }[] = [
  { kind: 'structure', label: 'Structure' },
  { kind: 'word', label: 'Vocabulary' },
  { kind: 'idiom', label: 'Idiom' },
  { kind: 'sentence', label: 'Sentence' }
]

/**
 * Floating menu shown when text is highlighted inside an AI answer or chat
 * message (any element marked data-savable). Lets the learner save a phrase or
 * sentence pattern found during the conversation, or explain it.
 */
export function SelectionSaveMenu(): ReactNode {
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [busy, setBusy] = useState<NoteKind | null>(null)
  const googleConnected = useApp((s) => !!s.settings?.googleConnected)
  const [toDocs, setToDocs] = useState(googleConnected)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => setToDocs(googleConnected), [googleConnected])

  useEffect(() => {
    const onMouseUp = (e: MouseEvent): void => {
      if (ref.current?.contains(e.target as Node)) return
      setTimeout(() => {
        const sel = window.getSelection()
        const text = sel?.toString().replace(/\s+/g, ' ').trim() ?? ''
        if (!sel || sel.rangeCount === 0 || text.length < 2 || text.length > 600) {
          setMenu(null)
          return
        }
        const node = sel.anchorNode
        const el = node instanceof Element ? node : node?.parentElement
        if (!el?.closest('[data-savable]')) {
          setMenu(null)
          return
        }
        const block = el.closest('p, li, td, blockquote')
        const blockText = block?.textContent?.replace(/\s+/g, ' ').trim() ?? null
        const rect = sel.getRangeAt(0).getBoundingClientRect()
        setMenu({
          text,
          context: blockText && blockText !== text && blockText.length <= 400 ? blockText : null,
          x: Math.min(Math.max(8, rect.left + rect.width / 2 - 190), window.innerWidth - 388),
          y: rect.top > 60 ? rect.top - 48 : rect.bottom + 8
        })
      }, 0)
    }
    const onMouseDown = (e: MouseEvent): void => {
      if (!ref.current?.contains(e.target as Node)) setMenu(null)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setMenu(null)
    }
    document.addEventListener('mouseup', onMouseUp)
    document.addEventListener('mousedown', onMouseDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mouseup', onMouseUp)
      document.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [])

  if (!menu) return null

  const save = async (kind: NoteKind): Promise<void> => {
    const { toast, toastError, refreshDue } = useApp.getState()
    const chat = useChat.getState().chats.find((c) => c.id === useChat.getState().activeChatId)
    setBusy(kind)
    try {
      const note = await invoke('notes:create', {
        kind,
        text: menu.text,
        contextSentence: menu.context,
        mediaTitle: chat?.mediaTitle ?? null,
        mediaPath: chat?.mediaPath ?? null,
        timestampSec: chat?.timestampSec ?? null,
        saveToDocs: toDocs
      })
      if (note.gdocError) toast('error', `Saved to notes, but Google Docs failed: ${note.gdocError}`)
      else toast('success', note.gdocSyncedAt ? 'Saved to notes and Google Docs' : 'Saved to notes')
      void refreshDue()
      window.getSelection()?.removeAllRanges()
      setMenu(null)
    } catch (err) {
      toastError(err)
    } finally {
      setBusy(null)
    }
  }

  const explain = (): void => {
    useMovie.getState().setCustom({ text: menu.text, kind: menu.text.includes(' ') ? 'phrase' : 'word' })
    useApp.getState().setPage('movie')
    window.getSelection()?.removeAllRanges()
    setMenu(null)
  }

  return (
    <div
      ref={ref}
      style={{ left: menu.x, top: menu.y }}
      className="glass-elevated anim-pop-in fixed z-50 flex items-center gap-1 rounded-xl p-1"
    >
      <button onClick={explain} className="flex h-8 items-center gap-1 rounded-lg px-2 text-xs font-medium motion-press hover:bg-white/80" title="Study this text">
        <Sparkles className="size-3.5 text-rose" /> Explain
      </button>
      <span className="mx-0.5 h-5 w-px bg-line" />
      <BookmarkPlus className="ml-1 size-3.5 text-muted" />
      {KINDS.map(({ kind, label }) => (
        <button
          key={kind}
          disabled={!!busy}
          onClick={() => void save(kind)}
          className={cn('h-8 rounded-lg px-2 text-xs font-medium motion-press hover:bg-white/80 disabled:opacity-50', busy === kind && 'animate-pulse')}
        >
          {label}
        </button>
      ))}
      <span className="mx-0.5 h-5 w-px bg-line" />
      <button
        onClick={() => setToDocs(!toDocs)}
        disabled={!googleConnected}
        title={googleConnected ? 'Also save to Google Docs' : 'Connect Google in Settings to save to Docs'}
        className={cn(
          'flex h-8 items-center gap-1 rounded-lg px-2 text-xs font-medium disabled:opacity-40',
          toDocs && googleConnected ? 'bg-accent-soft text-accent' : 'text-muted motion-press hover:bg-white/80'
        )}
      >
        <FileText className="size-3.5" /> Docs
      </button>
    </div>
  )
}
