import { useEffect, useRef, useState, type ReactNode } from 'react'
import { BookmarkPlus, ChevronDown, FileText, Layers, MessageCircle, Sparkles } from 'lucide-react'
import type { NoteKind } from '@shared/types'
import { invoke } from '@renderer/lib/api'
import { useApp } from '@renderer/stores/app'
import { useMovie } from '@renderer/stores/movie'
import { useChat } from '@renderer/stores/chat'
import { useLayout } from '@renderer/stores/layout'
import { cn } from '@renderer/lib/cn'

interface MenuState {
  text: string
  context: string | null
  x: number
  y: number
  /** Where the selection's top edge was, to place the open save panel above it when there is room. */
  top: number
  bottom: number
}

const KINDS: { kind: NoteKind; label: string }[] = [
  { kind: 'word', label: 'Vocabulary' },
  { kind: 'idiom', label: 'Idiom / Phrasal verb' },
  { kind: 'sentence', label: 'Sentence' },
  { kind: 'structure', label: 'Sentence structure' },
  { kind: 'grammar', label: 'Grammar note' },
  { kind: 'general', label: 'General note' }
]

/** Flashcards make sense for language items; a general note is just kept as a note. */
const CARD_KINDS: NoteKind[] = ['word', 'idiom', 'sentence', 'structure', 'grammar']
const CARD_KEY = 'elc.saveMenu.flashcard'
const MENU_W = 340
const PANEL_H = 200

function loadCardPref(): boolean {
  try {
    return localStorage.getItem(CARD_KEY) === 'true'
  } catch {
    return false
  }
}

/**
 * Floating menu shown when text is highlighted inside an AI answer or chat
 * message (any element marked data-savable). Nothing is saved until a type is
 * chosen under "Save to Notes".
 */
export function SelectionSaveMenu(): ReactNode {
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [saveOpen, setSaveOpen] = useState(false)
  const [busy, setBusy] = useState<NoteKind | null>(null)
  const googleConnected = useApp((s) => !!s.settings?.googleConnected)
  const [toDocs, setToDocs] = useState(googleConnected)
  const [toCard, setToCard] = useState(loadCardPref)
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
        setSaveOpen(false)
        setMenu({
          text,
          context: blockText && blockText !== text && blockText.length <= 400 ? blockText : null,
          x: Math.min(Math.max(8, rect.left + rect.width / 2 - MENU_W / 2), window.innerWidth - MENU_W - 8),
          y: rect.top > 60 ? rect.top - 48 : rect.bottom + 8,
          top: rect.top,
          bottom: rect.bottom
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

  const close = (): void => {
    window.getSelection()?.removeAllRanges()
    setMenu(null)
  }

  const save = async (kind: NoteKind): Promise<void> => {
    const { toast, toastError, refreshDue } = useApp.getState()
    const chat = useChat.getState().chats.find((c) => c.id === useChat.getState().activeChatId)
    const makeCard = toCard && CARD_KINDS.includes(kind)
    setBusy(kind)
    try {
      const note = await invoke('notes:create', {
        kind,
        text: menu.text,
        // The paragraph it came from, or else the sentence the conversation is about.
        contextSentence: menu.context ?? chat?.contextSentence ?? chat?.contextText ?? null,
        mediaTitle: chat?.mediaTitle ?? null,
        mediaPath: chat?.mediaPath ?? null,
        timestampSec: chat?.timestampSec ?? null,
        saveToDocs: toDocs
      })
      let cardMsg = ''
      if (makeCard) {
        try {
          const { created } = await invoke('flashcards:generate', { noteIds: [note.id] })
          cardMsg = created ? ' + flashcard' : ''
        } catch (err) {
          toastError(err)
        }
      }
      if (note.gdocError) toast('error', `Saved to notes${cardMsg}, but Google Docs failed: ${note.gdocError}`)
      else toast('success', `${note.gdocSyncedAt ? 'Saved to notes and Google Docs' : 'Saved to notes'}${cardMsg}`)
      void refreshDue()
      close()
    } catch (err) {
      toastError(err)
    } finally {
      setBusy(null)
    }
  }

  const explain = (): void => {
    useMovie.getState().setCustom({ text: menu.text, kind: menu.text.includes(' ') ? 'phrase' : 'word' })
    useApp.getState().setPage('movie')
    close()
  }

  /** Makes the selection the chat's topic and opens the chat, ready for the question. */
  const ask = (): void => {
    const chat = useChat.getState()
    if (chat.focus?.text !== menu.text) {
      const active = chat.chats.find((c) => c.id === chat.activeChatId)
      chat.setFocus({ text: menu.text, sentence: active?.contextSentence ?? active?.contextText ?? null, excerpt: menu.context, source: 'chat' })
    }
    const { page, setPage } = useApp.getState()
    if (page !== 'movie' && page !== 'youtube') setPage('movie')
    useLayout.getState().setChatOpen(true)
    close()
    setTimeout(() => document.querySelector<HTMLTextAreaElement>('textarea[data-chat-input]:not([disabled])')?.focus(), 260)
  }

  const toggleCard = (): void => {
    setToCard(!toCard)
    try {
      localStorage.setItem(CARD_KEY, String(!toCard))
    } catch {
      // keep for this session only
    }
  }

  // The open save panel goes above the selection when it fits there, otherwise below it.
  const top = !saveOpen
    ? menu.y
    : menu.top > PANEL_H + 16
      ? menu.top - PANEL_H - 8
      : Math.min(menu.bottom + 8, window.innerHeight - PANEL_H - 8)

  return (
    <div ref={ref} style={{ left: menu.x, top, width: saveOpen ? MENU_W : undefined }} className="glass-elevated anim-pop-in fixed z-50 rounded-xl p-1">
      <div className="flex items-center gap-1">
        <button onClick={explain} className="flex h-8 items-center gap-1 rounded-lg px-2 text-xs font-medium motion-press hover:bg-white/80" title="Study this text">
          <Sparkles className="size-3.5 text-rose" /> Explain
        </button>
        <button onClick={ask} className="flex h-8 items-center gap-1 rounded-lg px-2 text-xs font-medium motion-press hover:bg-white/80" title="Ask the chat about this exact text">
          <MessageCircle className="size-3.5 text-rose" /> Ask in chat
        </button>
        <span className="mx-0.5 h-5 w-px bg-line" />
        <button
          onClick={() => setSaveOpen(!saveOpen)}
          aria-expanded={saveOpen}
          className={cn('flex h-8 items-center gap-1 rounded-lg px-2 text-xs font-medium motion-press', saveOpen ? 'bg-accent-soft text-accent' : 'hover:bg-white/80')}
          title="Choose how to save this exact selection"
        >
          <BookmarkPlus className="size-3.5" /> Save to Notes
          <ChevronDown className={cn('size-3 transition-transform duration-200', saveOpen && 'rotate-180')} />
        </button>
      </div>

      {saveOpen && (
        <div className="anim-fade-in mt-1 border-t border-line/70 px-1 pt-2 pb-1">
          <p className="mb-1.5 truncate text-[11px] text-muted" title={menu.text}>
            Save “{menu.text}” as:
          </p>
          <div className="grid grid-cols-2 gap-1">
            {KINDS.map(({ kind, label }) => (
              <button
                key={kind}
                disabled={!!busy}
                onClick={() => void save(kind)}
                className={cn(
                  'h-8 rounded-lg border border-line/60 px-2 text-left text-xs font-medium motion-press hover:bg-white/80 disabled:opacity-50',
                  busy === kind && 'animate-pulse'
                )}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="mt-2 flex items-center gap-1">
            <button
              onClick={toggleCard}
              aria-pressed={toCard}
              title="Also make a flashcard (not for general notes)"
              className={cn(
                'flex h-7 items-center gap-1 rounded-lg px-2 text-xs font-medium',
                toCard ? 'bg-accent-soft text-accent' : 'text-muted motion-press hover:bg-white/80'
              )}
            >
              <Layers className="size-3.5" /> Flashcard
            </button>
            <button
              onClick={() => setToDocs(!toDocs)}
              disabled={!googleConnected}
              aria-pressed={toDocs && googleConnected}
              title={googleConnected ? 'Also save to Google Docs' : 'Connect Google in Settings to save to Docs'}
              className={cn(
                'flex h-7 items-center gap-1 rounded-lg px-2 text-xs font-medium disabled:opacity-40',
                toDocs && googleConnected ? 'bg-accent-soft text-accent' : 'text-muted motion-press hover:bg-white/80'
              )}
            >
              <FileText className="size-3.5" /> Docs
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
