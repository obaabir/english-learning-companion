import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { useShallow } from 'zustand/react/shallow'
import {
  BookmarkCheck,
  BookmarkPlus,
  ChevronDown,
  ChevronsLeft,
  ChevronsRight,
  FileCheck2,
  FileText,
  Layers,
  Loader2,
  MessageCircle,
  MousePointerClick,
  RotateCcw,
  Sparkles,
  Undo2,
  X
} from 'lucide-react'
import { NOTE_KINDS, formatTimestamp, type NoteKind, type StudyContext } from '@shared/types'
import { errorMessage, invoke, newRequestId, on, streamCall } from '@renderer/lib/api'
import { useApp } from '@renderer/stores/app'
import { contextLines, getSelection, useStudy, useStudyStore, type StudyActions, type StudySelection } from '@renderer/stores/movie'
import { useChat } from '@renderer/stores/chat'
import { useLayout } from '@renderer/stores/layout'
import { Badge, Button, EmptyState, Select } from '@renderer/components/ui'
import { Markdown } from '@renderer/components/Markdown'
import { cn } from '@renderer/lib/cn'
import { flipY } from '@renderer/lib/motion'
import { ChatPanel } from './ChatPanel'

/** Movie Mode: jump to the moment in VLC/mpv. Other lists (YouTube) provide their own. */
export const StudyActionsContext = createContext<StudyActions>({
  seek: async (line) => {
    if (line.start == null) return
    await invoke('player:seekTo', { mediaPath: line.mediaPath, seconds: Math.max(0, line.start - 0.3) })
  }
})

export function ExplainPanel(): ReactNode {
  // getSelection builds a new object each call; compare its fields so renders stay stable.
  const selection = useStudy(useShallow((s) => getSelection(s)))
  const prompts = useApp((s) => s.prompts)
  const activePromptId = useApp((s) => s.activePromptId)
  const setActivePromptId = useApp((s) => s.setActivePromptId)

  return (
    <div className="glass-panel @container flex h-full min-w-0 flex-col overflow-hidden">
      <div className="glass-header relative z-20 flex h-12 shrink-0 items-center gap-2 rounded-t-[17px] px-4">
        <Sparkles className="size-4 shrink-0 text-rose" />
        <h2 className="text-sm font-semibold">Explanation</h2>
        <div className="ml-auto flex min-w-0 items-center gap-2">
          <span className="hidden text-xs text-muted @md:inline">Prompt</span>
          <Select
            value={activePromptId ?? ''}
            onChange={(e) => setActivePromptId(Number(e.target.value))}
            className="h-8 max-w-52 min-w-0 text-xs"
            aria-label="Explanation prompt"
          >
            {prompts.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.isDefault ? ' (default)' : ''}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col [container-type:size]">
        {selection ? (
          <SelectionView key={selection.key} selection={selection} />
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto">
            <EmptyState icon={<MousePointerClick className="size-10" />} title="Click a subtitle to study it">
              The selected sentence appears here with its explanation. The study actions are in the side panel, and the chat is docked below.
            </EmptyState>
          </div>
        )}
        {/* One chat, docked inside the Explanation section. Always mounted so its conversation and draft survive folding. */}
        <ChatDock />
      </div>
    </div>
  )
}

function ChatDock(): ReactNode {
  const open = useLayout((s) => s.chatOpen)
  // The reserved space switches in one step; the chat panel (always full height) slides
  // with a transform, so no animation frame needs layout. The panel clips what slides out.
  return (
    <div className={cn('relative shrink-0', open ? 'h-[max(220px,46cqh)]' : 'h-11')}>
      <div
        className={cn(
          'absolute inset-x-0 bottom-0 z-20 h-[max(220px,46cqh)] border-t border-white/80 bg-white/[0.82] will-change-transform',
          'shadow-[0_-10px_30px_rgba(55,35,45,0.07)] transition-[translate] duration-[240ms] ease-[var(--ease)] motion-reduce:transition-none',
          open ? 'translate-y-0' : 'translate-y-[calc(max(220px,46cqh)-2.75rem)]'
        )}
      >
        <ChatPanel docked />
      </div>
    </div>
  )
}

/** Foldable details. Appears with a short rise/fade; the content below moves with FLIP (see toggleControls). */
function Collapse({ open, children }: { open: boolean; children: ReactNode }): ReactNode {
  return open ? <div className="anim-fade-in">{children}</div> : null
}

function SelectionView({ selection }: { selection: StudySelection }): ReactNode {
  const activePromptId = useApp((s) => s.activePromptId)
  const hasKey = useApp((s) => !!s.settings?.hasGeminiKey)
  const autoExplain = useApp((s) => s.settings?.autoExplain ?? true)
  const googleConnected = useApp((s) => !!s.settings?.googleConnected)
  const { toast, toastError, refreshDue, setPage } = useApp.getState()
  const explanationKey = `${selection.key}|${activePromptId}`
  const store = useStudyStore()
  const studyActions = useContext(StudyActionsContext)
  const explanation = useStudy((s) => s.explanations[explanationKey])
  const savedNoteId = useStudy((s) => s.savedNotes[selection.key])
  const { setExplanation, appendExplanation, markSaved, selectLine, setWordRange, setCustom } = store.getState()
  const controlsOpen = useLayout((s) => s.controlsOpen)
  const actionsOpen = useLayout((s) => s.actionsOpen)
  const { setControlsOpen, setActionsOpen, setChatOpen } = useLayout.getState()
  const [kind, setKind] = useState<NoteKind>(selection.suggestedKind)
  const [busy, setBusy] = useState<string | null>(null)
  const [inDocs, setInDocs] = useState(false)
  const line = selection.line
  const bodyRef = useRef<HTMLDivElement>(null)
  const wordClickTimer = useRef<number | undefined>(undefined)

  /**
   * Click an English word in the explanation: the chat opens and asks for its Bangla meaning
   * and an example. Double-click / drag keep their normal text-selection behaviour.
   */
  const onExplanationClick = (e: React.MouseEvent): void => {
    window.clearTimeout(wordClickTimer.current)
    if (e.detail !== 1) return
    const target = e.target as HTMLElement
    if (!target.closest('.prose-ai') || target.closest('a, button, input, textarea, select')) return
    if (window.getSelection()?.isCollapsed === false) return
    const word = wordAtPoint(e.clientX, e.clientY)
    if (!word) return
    // Wait briefly so a double-click (text selection) doesn't also send the word.
    wordClickTimer.current = window.setTimeout(() => void askWord(word), 250)
  }

  const askWord = async (word: string): Promise<void> => {
    if (!hasKey) {
      toast('info', 'Add your Gemini API key in Settings to use the chat.')
      return
    }
    if (useChat.getState().sending) {
      toast('info', 'Gemini is still answering. Click the word again in a moment.')
      return
    }
    setChatOpen(true)
    const from = selection.sentence ?? selection.text
    try {
      await useChat
        .getState()
        .send(`What does "${word}" mean here: "${from}"? Give its Bangla meaning and one example sentence with its Bangla translation.`)
    } catch (err) {
      toastError(err)
    }
  }
  const flipFrom = useRef<number | null>(null)

  // FLIP for the control bar: remember where the explanation text was, change layout once,
  // then let the text glide from its old place (transform only).
  const toggleControls = (): void => {
    flipFrom.current = bodyRef.current?.getBoundingClientRect().top ?? null
    setControlsOpen(!controlsOpen)
  }
  useLayoutEffect(() => {
    const from = flipFrom.current
    flipFrom.current = null
    const el = bodyRef.current
    if (from == null || !el) return
    flipY(el, from - el.getBoundingClientRect().top)
  }, [controlsOpen])

  useEffect(() => setKind(selection.suggestedKind), [selection.suggestedKind])
  useEffect(() => on('notes:docsResult', (r) => r.ok && r.noteId === store.getState().savedNotes[selection.key] && setInDocs(true)), [selection.key])

  const buildContext = (): StudyContext => {
    const { before, after } = contextLines(store.getState().lines, line)
    return { text: selection.text, sentence: selection.sentence, before, after, mediaTitle: line?.mediaTitle ?? null }
  }

  const explain = async (): Promise<void> => {
    const requestId = newRequestId()
    setExplanation(explanationKey, { text: '', status: 'streaming', promptId: activePromptId })
    try {
      const text = await streamCall(
        requestId,
        (d) => appendExplanation(explanationKey, d),
        () => invoke('ai:explain', { requestId, promptId: activePromptId, context: buildContext() })
      )
      setExplanation(explanationKey, { text, status: 'done', promptId: activePromptId })
    } catch (err) {
      const cur = store.getState().explanations[explanationKey]
      setExplanation(explanationKey, { text: cur?.text ?? '', status: 'error', error: errorMessage(err), promptId: activePromptId })
    }
  }

  // Auto-explain once the selection settles (Shift+click word ranges change it quickly).
  useEffect(() => {
    if (!autoExplain || !hasKey || store.getState().explanations[explanationKey]) return
    const timer = setTimeout(() => void explain(), 400)
    return () => clearTimeout(timer)
    // explain() reads the latest state when it runs; re-run only when the selection or prompt changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [explanationKey, autoExplain, hasKey])

  const chat = async (): Promise<void> => {
    setBusy('chat')
    try {
      await useChat.getState().startChat({
        promptId: activePromptId,
        context: buildContext(),
        mediaPath: line?.mediaPath ?? null,
        timestampSec: line?.start ?? null,
        explanationMd: explanation?.status === 'done' ? explanation.text : null
      })
      setChatOpen(true)
    } catch (err) {
      toastError(err)
    } finally {
      setBusy(null)
    }
  }

  /** Saves the selection once; later clicks reuse the saved note instead of creating duplicates. */
  const save = async (saveToDocs: boolean): Promise<number | null> => {
    setBusy(saveToDocs ? 'docs' : 'save')
    try {
      if (savedNoteId) {
        if (!saveToDocs) return savedNoteId
        const before = await invoke('notes:get', savedNoteId)
        const note = await invoke('notes:syncToDocs', savedNoteId)
        if (note.gdocError) toast('error', `Google Docs failed: ${note.gdocError}`)
        else {
          setInDocs(true)
          const already = before?.gdocSyncedAt && before.gdocSyncedAt === note.gdocSyncedAt
          toast(already ? 'info' : 'success', already ? 'Already in your Google Doc' : 'Added to your Google Doc')
        }
        return savedNoteId
      }
      const note = await invoke('notes:create', {
        kind,
        text: selection.text,
        contextSentence: selection.sentence,
        explanationMd: explanation?.status === 'done' ? explanation.text : null,
        mediaPath: line?.mediaPath ?? null,
        mediaTitle: line?.mediaTitle ?? null,
        timestampSec: line?.start ?? null,
        promptId: activePromptId,
        saveToDocs
      })
      markSaved(selection.key, note.id)
      if (note.gdocSyncedAt && !note.gdocError) setInDocs(true)
      if (note.gdocError) toast('error', `Saved to notes, but Google Docs failed: ${note.gdocError}`)
      else toast('success', note.gdocSyncedAt ? 'Saved to notes and Google Docs' : 'Saved to notes')
      void refreshDue()
      return note.id
    } catch (err) {
      toastError(err)
      return null
    } finally {
      setBusy(null)
    }
  }

  const addFlashcard = async (): Promise<void> => {
    const noteId = savedNoteId ?? (await save(false))
    if (noteId == null) return
    setBusy('card')
    try {
      const { created } = await invoke('flashcards:generate', { noteIds: [noteId] })
      toast(created ? 'success' : 'info', created ? 'Flashcard created' : 'This note already has a flashcard')
      void refreshDue()
    } catch (err) {
      toastError(err)
    } finally {
      setBusy(null)
    }
  }

  const jump = async (): Promise<void> => {
    if (!line || line.start == null) return
    try {
      await studyActions.seek(line)
    } catch (err) {
      toastError(err)
    }
  }

  const clear = (): void => {
    if (selection.line && selection.text !== selection.sentence) setWordRange(null)
    else if (!selection.line) setCustom(null)
    else selectLine(null)
  }

  const actions: ActionDef[] = [
    {
      id: 'explain',
      label: explanation?.status === 'done' ? 'Explain again' : 'Explain with my prompt',
      icon: explanation?.status === 'done' ? <RotateCcw className="size-4" /> : <Sparkles className="size-4" />,
      onClick: () => void explain(),
      busy: explanation?.status === 'streaming',
      disabled: !hasKey,
      hint: hasKey ? undefined : 'Add your Gemini API key in Settings',
      primary: true
    },
    {
      id: 'docs',
      label: inDocs ? 'In Google Docs' : 'Save to Google Docs',
      icon: inDocs ? <FileCheck2 className="size-4 text-accent" /> : <FileText className="size-4" />,
      onClick: () => void save(true),
      busy: busy === 'docs',
      disabled: !googleConnected,
      hint: googleConnected ? undefined : 'Connect Google in Settings first'
    },
    {
      id: 'chat',
      label: 'Chat about this',
      icon: <MessageCircle className="size-4" />,
      onClick: () => void chat(),
      busy: busy === 'chat',
      disabled: !hasKey,
      hint: hasKey ? undefined : 'Add your Gemini API key in Settings'
    },
    {
      id: 'card',
      label: 'Add to flashcards',
      icon: <Layers className="size-4" />,
      onClick: () => void addFlashcard(),
      busy: busy === 'card'
    },
    {
      id: 'save',
      label: savedNoteId ? 'Saved to notes' : 'Save to notes',
      icon: savedNoteId ? <BookmarkCheck className="size-4 text-accent" /> : <BookmarkPlus className="size-4" />,
      onClick: () => void save(false),
      busy: busy === 'save',
      disabled: !!savedNoteId
    }
  ]

  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Control bar: the selected text and its details. Folds to a single line. */}
        <div className="relative z-10 shrink-0 border-b border-line/70 bg-white/[0.78] shadow-[0_1px_0_rgba(255,255,255,0.9)_inset]">
          <div className="flex items-start gap-2 px-4 pt-3 pb-2">
            <button
              onClick={toggleControls}
              className="motion-press mt-0.5 rounded-md p-0.5 text-muted hover:bg-surface-2 hover:text-fg"
              aria-expanded={controlsOpen}
              aria-label={controlsOpen ? 'Fold the details' : 'Show the details'}
              title={controlsOpen ? 'Fold' : 'Show details'}
            >
              <span className={cn('block transition-transform duration-[240ms] ease-[var(--ease)]', !controlsOpen && '-rotate-90')}>
                <ChevronDown className="size-4" />
              </span>
            </button>
            <p className={cn('min-w-0 flex-1 leading-snug font-medium', controlsOpen ? 'text-lg' : 'truncate text-[15px]')} title={selection.text}>
              {selection.text}
            </p>
            {!controlsOpen && line?.start != null && (
              <button onClick={() => void jump()} className="shrink-0 rounded-md bg-surface-2 px-1.5 py-0.5 text-xs text-muted tabular-nums hover:text-fg" title="Jump to this moment in the movie">
                ▶ {formatTimestamp(line.start)}
              </button>
            )}
            <Button variant="ghost" size="sm" onClick={clear} title="Clear selection" aria-label="Clear selection" icon={<X className="size-4" />} />
          </div>
          <Collapse open={controlsOpen}>
            <div className="px-4 pb-3 pl-10">
              {selection.sentence && selection.sentence !== selection.text && (
                <p className="text-sm text-muted">
                  from: <span className="italic">“{selection.sentence}”</span>
                  <button className="ml-2 inline-flex items-center gap-1 text-xs text-info hover:underline" onClick={() => setWordRange(null)}>
                    <Undo2 className="size-3" /> whole sentence
                  </button>
                </p>
              )}
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted">
                {line?.mediaTitle && <span className="max-w-full min-w-0 truncate">{line.mediaTitle}</span>}
                {line?.start != null && (
                  <button onClick={() => void jump()} className="rounded-md bg-surface-2 px-1.5 py-0.5 tabular-nums hover:text-fg" title="Jump to this moment in the movie">
                    ▶ {formatTimestamp(line.start)}
                  </button>
                )}
                <Select value={kind} onChange={(e) => setKind(e.target.value as NoteKind)} className="ml-auto h-7 text-xs" aria-label="Save as">
                  {NOTE_KINDS.map((k) => (
                    <option key={k.value} value={k.value}>
                      Save as: {k.label}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
          </Collapse>
        </div>

        <div ref={bodyRef} onClick={onExplanationClick} className="relative min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-5 py-4">
          {!hasKey && (
            <div className="anim-fade-in mb-4 rounded-xl bg-info-soft px-3 py-2.5 text-sm text-info">
              Add your Gemini API key in{' '}
              <button className="font-semibold underline" onClick={() => setPage('settings')}>
                Settings
              </button>{' '}
              to get explanations and chat.
            </div>
          )}
          {explanation ? (
            <>
              {explanation.text && <Markdown text={explanation.text} streaming={explanation.status === 'streaming'} />}
              {explanation.status === 'streaming' && !explanation.text && (
                <p className="flex items-center gap-2 text-sm text-muted">
                  <Loader2 className="size-4 animate-spin" /> Thinking…
                </p>
              )}
              {explanation.status === 'error' && (
                <div className="anim-fade-in mt-3 rounded-xl bg-danger-soft px-3 py-2.5 text-sm text-danger">
                  <p>{explanation.error}</p>
                  <Button size="sm" variant="secondary" className="mt-2" icon={<RotateCcw className="size-3.5" />} onClick={() => void explain()}>
                    Try again
                  </Button>
                </div>
              )}
              {explanation.status === 'done' && (
                <p className="mt-4 text-xs text-muted">
                  <Badge>Tip</Badge> Highlight any phrase above to save it as a structure, word or idiom.
                </p>
              )}
            </>
          ) : (
            hasKey && <p className="text-sm text-muted">Press “Explain with my prompt” in the side panel to analyse this with the selected prompt.</p>
          )}
        </div>
      </div>

      <ActionRail actions={actions} open={actionsOpen} onToggle={() => setActionsOpen(!actionsOpen)} />
    </div>
  )
}

interface ActionDef {
  id: string
  label: string
  icon: ReactNode
  onClick: () => void
  busy?: boolean
  disabled?: boolean
  hint?: string
  primary?: boolean
}

/** The five study actions in a side panel that folds to icons and slides open to show labels. */
function ActionRail({ actions, open, onToggle }: { actions: ActionDef[]; open: boolean; onToggle: () => void }): ReactNode {
  // The rail always takes 48px in the layout. The panel is 240px wide and slides left over the
  // explanation when opened, so opening never re-lays-out the text (transform only).
  return (
    <div className="relative w-12 shrink-0">
    <aside
      aria-label="Study actions"
      className={cn(
        'absolute inset-y-0 right-0 z-30 flex w-60 flex-col gap-1 border-l border-white/80 bg-white/[0.86] p-1.5 will-change-transform',
        'transition-[translate] duration-[240ms] ease-[var(--ease)] motion-reduce:transition-none',
        open ? 'translate-x-0 rounded-l-2xl shadow-[-14px_0_40px_rgba(55,35,45,0.12)]' : 'translate-x-[calc(100%-3rem)]'
      )}
    >
      <button
        onClick={onToggle}
        aria-expanded={open}
        title={open ? 'Fold the actions' : 'Show action names'}
        className="motion-press flex h-8 items-center gap-2 rounded-lg px-2.5 text-xs text-muted hover:bg-surface-2 hover:text-fg"
      >
        {open ? <ChevronsRight className="size-4 shrink-0" /> : <ChevronsLeft className="size-4 shrink-0" />}
        <span className={cn('whitespace-nowrap transition-opacity duration-200', open ? 'opacity-100' : 'opacity-0')}>Actions</span>
      </button>
      {actions.map((a) => (
        <button
          key={a.id}
          onClick={a.onClick}
          disabled={a.disabled || a.busy}
          title={a.hint ?? a.label}
          aria-label={a.label}
          className={cn(
            'motion-press flex h-9 items-center gap-2.5 rounded-[10px] border px-2.5 text-left text-sm font-medium disabled:opacity-45',
            a.primary ? 'btn-burgundy' : 'border-transparent text-fg hover:border-white/90 hover:bg-white/80'
          )}
        >
          <span className="flex size-4 shrink-0 items-center justify-center">{a.busy ? <Loader2 className="size-4 animate-spin" /> : a.icon}</span>
          <span className={cn('truncate whitespace-nowrap transition-opacity duration-200', open ? 'opacity-100' : 'opacity-0')}>{a.label}</span>
        </button>
      ))}
    </aside>
    </div>
  )
}

/** The English word under the pointer (letters, apostrophes and hyphens), or null. */
function wordAtPoint(x: number, y: number): string | null {
  const range = document.caretRangeFromPoint?.(x, y)
  const node = range?.startContainer
  if (!range || !node || node.nodeType !== Node.TEXT_NODE) return null
  const text = node.textContent ?? ''
  const isWordChar = (c: string | undefined): boolean => !!c && /[A-Za-z'’-]/.test(c)
  let start = range.startOffset
  let end = range.startOffset
  while (start > 0 && isWordChar(text[start - 1])) start--
  while (end < text.length && isWordChar(text[end])) end++
  const word = text.slice(start, end).replace(/^['’-]+|['’-]+$/g, '')
  return /[A-Za-z]/.test(word) ? word : null
}
