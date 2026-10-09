import { useEffect, useRef, type ReactNode } from 'react'
import { ChevronUp, Loader2, MessageCircle, Plus, SendHorizonal, Trash2 } from 'lucide-react'
import { useApp } from '@renderer/stores/app'
import { useChat } from '@renderer/stores/chat'
import { useLayout } from '@renderer/stores/layout'
import { Button, EmptyState, PanelHeader, Select, Textarea } from '@renderer/components/ui'
import { Markdown } from '@renderer/components/Markdown'
import { cn } from '@renderer/lib/cn'

/**
 * The conversation with Gemini. When docked inside the Explanation section its
 * header bar folds and unfolds it; the panel stays mounted so the conversation
 * and any half-typed message are kept while folded.
 */
export function ChatPanel({ docked = false }: { docked?: boolean }): ReactNode {
  const { chats, activeChatId, messages, streaming, sending, loadChats, send } = useChat()
  const hasKey = useApp((s) => !!s.settings?.hasGeminiKey)
  const toastError = useApp((s) => s.toastError)
  const draft = useChat((s) => s.draft)
  const setDraft = useChat((s) => s.setDraft)
  const scrollRef = useRef<HTMLDivElement>(null)
  const open = useLayout((s) => s.chatOpen)
  const setOpen = useLayout((s) => s.setChatOpen)
  const expanded = !docked || open

  useEffect(() => {
    void loadChats()
  }, [loadChats])

  // Keep the newest message in view (scrolls only this list, never the surrounding layout).
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages, streaming, expanded])

  const submit = async (): Promise<void> => {
    const text = draft.trim()
    if (!text || sending) return
    setDraft('')
    try {
      await send(text)
    } catch (err) {
      toastError(err)
    }
  }

  const active = chats.find((c) => c.id === activeChatId)
  // The first two messages seed the selection context; show them compactly.
  const seeded = !!active?.contextText

  return (
    <div className={cn('flex h-full min-h-0 flex-col', !docked && 'glass-panel overflow-hidden')}>
      {docked ? (
        <div className="flex h-11 shrink-0 items-center gap-2 px-3">
          <button
            onClick={() => setOpen(!open)}
            aria-expanded={open}
            className="motion-hover flex min-w-0 flex-1 items-center gap-2 rounded-lg py-1.5 text-left text-sm font-semibold hover:text-accent"
            title={open ? 'Fold the chat' : 'Open the chat'}
          >
            {/* Folded: points up (opens upward). Open: points down (folds away). */}
            <span className={cn('block shrink-0 text-muted transition-transform duration-[240ms] ease-[var(--ease)]', open && 'rotate-180')}>
              <ChevronUp className="size-4" />
            </span>
            <MessageCircle className="size-4 shrink-0 text-rose" />
            <span>Chat</span>
            {!open && (active || streaming !== null) && (
              <span className="min-w-0 truncate text-xs font-normal text-muted">
                {streaming !== null ? 'Gemini is replying…' : `· ${active?.title}`}
              </span>
            )}
            {streaming !== null && !open && <Loader2 className="size-3.5 shrink-0 animate-spin text-accent" />}
          </button>
          {open && <ChatControls />}
        </div>
      ) : (
        <PanelHeader title="Chat" icon={<MessageCircle className="size-4" />}>
          <ChatControls />
        </PanelHeader>
      )}

      <div ref={scrollRef} inert={docked && !open} className={cn('min-h-0 flex-1 overflow-y-auto px-4 py-4', docked && 'border-t border-line/70')}>

        {messages.length === 0 && streaming === null ? (
          <EmptyState icon={<MessageCircle className="size-10" />} title="Ask anything">
            Use <b>Chat about this</b> on a subtitle, or just type a question about English below. Your selected prompt shapes the answers.
          </EmptyState>
        ) : (
          <div className="space-y-4">
            {active?.contextText && (
              <div className="glass-inset rounded-xl px-3 py-2 text-xs text-muted">
                Talking about: <span className="text-fg">“{active.contextText}”</span>
                {active.mediaTitle && <> · {active.mediaTitle}</>}
              </div>
            )}
            {messages.map((m, i) =>
              seeded && i === 0 ? null : (
                <Bubble key={m.id} role={m.role}>
                  {m.role === 'model' ? <Markdown text={m.content} /> : <p className="whitespace-pre-wrap" data-savable>{m.content}</p>}
                </Bubble>
              )
            )}
            {streaming !== null && (
              <Bubble role="model">
                {streaming ? <Markdown text={streaming} streaming /> : <p className="text-sm text-muted">Thinking…</p>}
              </Bubble>
            )}
          </div>
        )}
      </div>

      <div inert={docked && !open} className="shrink-0 border-t border-line/70 p-3">
        <div className="flex items-end gap-2">
          <Textarea
            rows={2}
            value={draft}
            disabled={!hasKey}
            placeholder={hasKey ? 'Ask about meaning, grammar, usage… (Enter to send)' : 'Add your Gemini API key in Settings to chat'}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                void submit()
              }
            }}
          />
          <Button variant="primary" className="h-10 w-10 px-0" onClick={() => void submit()} loading={sending} disabled={!draft.trim() || !hasKey} aria-label="Send">
            {!sending && <SendHorizonal className="size-4" />}
          </Button>
        </div>
      </div>
    </div>
  )
}

function Bubble({ role, children }: { role: 'user' | 'model'; children: ReactNode }): ReactNode {
  return (
    <div className={cn('flex', role === 'user' ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'anim-fade-in max-w-[92%] rounded-2xl px-3.5 py-2.5 text-sm',
          role === 'user'
            ? 'rounded-br-md border border-rose/25 bg-accent-soft text-fg shadow-[0_2px_8px_rgba(120,27,54,0.06)]'
            : 'glass-inset rounded-bl-md bg-white/75'
        )}
      >
        {children}
      </div>
    </div>
  )
}

/** Conversation picker, new chat and delete. */
function ChatControls(): ReactNode {
  const { chats, activeChatId, openChat, deleteChat } = useChat()
  const toastError = useApp((s) => s.toastError)
  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <Select
        value={activeChatId ?? ''}
        onChange={(e) => void openChat(e.target.value ? Number(e.target.value) : null)}
        className="h-8 max-w-44 min-w-0 text-xs"
        aria-label="Conversation history"
      >
        <option value="">New conversation</option>
        {chats.map((c) => (
          <option key={c.id} value={c.id}>
            {c.title}
          </option>
        ))}
      </Select>
      <Button variant="ghost" size="sm" icon={<Plus className="size-4" />} onClick={() => void openChat(null)} title="New chat" aria-label="New chat" />
      {activeChatId && (
        <Button
          variant="ghost"
          size="sm"
          icon={<Trash2 className="size-3.5" />}
          onClick={() => void deleteChat(activeChatId).catch(toastError)}
          title="Delete this chat"
          aria-label="Delete this chat"
        />
      )}
    </div>
  )
}
