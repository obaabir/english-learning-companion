import { useEffect, useRef, useState, type ReactNode } from 'react'
import { BookmarkCheck, BookmarkPlus, Layers, Loader2, MessageCircle, MousePointerClick, RotateCcw, Sparkles, X } from 'lucide-react'
import { articleMode, suggestedArticleKind } from '@shared/articles'
import { NOTE_KINDS, type NoteKind } from '@shared/types'
import { invoke } from '@renderer/lib/api'
import { useApp } from '@renderer/stores/app'
import { useChat } from '@renderer/stores/chat'
import { useLayout } from '@renderer/stores/layout'
import { focusFromSelection, focusVisibleChatInput } from '@renderer/lib/chatFocus'
import { Badge, Button, EmptyState, Select } from '@renderer/components/ui'
import { Markdown } from '@renderer/components/Markdown'
import { ChatDock } from '@renderer/features/movie/ExplainPanel'
import { useArticles } from './articleStore'
import { ExplainAnalysisView, ExplanationHeading, OriginalContext, useExplainPaperStyle } from '@renderer/features/explain/ExplainSections'

const SOURCE_LABEL = { browser: 'In-app browser', reader: 'Reader view', chrome: 'From Chrome', ai: 'From the explanation', book: 'From your book' } as const

/** The selected word or sentence, its explanation, save actions and the chat (docked below). */
export function ArticleStudyPanel(): ReactNode {
  const selection = useArticles((s) => s.selection)
  const explanation = useArticles((s) => (s.selection ? s.explanations[s.selection.key] : undefined))
  const hasKey = useApp((s) => !!s.settings?.hasGeminiKey)

  return (
    <div className="glass-panel @container flex h-full min-w-0 flex-col overflow-hidden">
      <div className="glass-header relative z-20 flex h-12 shrink-0 items-center gap-2 rounded-t-[17px] px-4">
        <Sparkles className="size-4 shrink-0 text-rose" />
        <h2 className="text-sm font-semibold">Explanation</h2>
        {selection && <Badge tone="accent">{articleMode(selection.text) === 'word' ? 'Word / phrase' : 'Sentence'}</Badge>}
        {selection && <span className="ml-auto truncate text-xs text-muted">{SOURCE_LABEL[selection.source]}</span>}
      </div>
      <div className="flex min-h-0 flex-1 flex-col [container-type:size]">
        {selection ? (
          <SelectionView key={selection.key} hasKey={hasKey} explanation={explanation} />
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto">
            <EmptyState icon={<MousePointerClick className="size-10" />} title="Select a word or sentence">
              Select text in a page or in Reader view (or send it from Chrome). Press <b>Explain</b> to get its Bangla meaning, grammar and examples, then ask
              follow-up questions in the chat below.
            </EmptyState>
          </div>
        )}
        <ChatDock />
      </div>
    </div>
  )
}

function SelectionView({ hasKey, explanation }: { hasKey: boolean; explanation: ReturnType<typeof useArticles.getState>['explanations'][string] | undefined }): ReactNode {
  const selection = useArticles((s) => s.selection)!
  const [kind, setKind] = useState<NoteKind>(suggestedArticleKind(selection.text))
  const [busy, setBusy] = useState<'save' | 'card' | null>(null)
  const [savedId, setSavedId] = useState<number | null>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const paperStyle = useExplainPaperStyle()
  const { toast, toastError, refreshDue, setPage } = useApp.getState()

  useEffect(() => setKind(suggestedArticleKind(selection.text)), [selection.text])

  const save = async (): Promise<number | null> => {
    if (savedId) return savedId
    setBusy('save')
    try {
      const st = useArticles.getState()
      const articleId = selection.url && selection.source !== 'ai' ? await st.ensureArticle(selection.url, selection.title ?? selection.url) : null
      const note = await invoke('notes:create', {
        kind,
        text: selection.text,
        // Original article text; the AI explanation is kept separately.
        contextSentence: selection.source === 'ai' ? null : selection.sentence,
        explanationMd: explanation?.status === 'done' ? explanation.text : null,
        mediaTitle: selection.title,
        articleId: articleId ?? useArticles.getState().articleIds[selection.url ?? ''] ?? null
      })
      setSavedId(note.id)
      useArticles.setState((s) => ({ historyVersion: s.historyVersion + 1 }))
      if (note.gdocError) toast('error', `Saved to notes, but Google Docs failed: ${note.gdocError}`)
      else toast(note.duplicate ? 'info' : 'success', note.duplicate ? 'Already in your notes' : 'Saved to notes')
      void refreshDue()
      return note.id
    } catch (err) {
      toastError(err)
      return null
    } finally {
      setBusy(null)
    }
  }

  const flashcard = async (): Promise<void> => {
    const id = await save()
    if (id == null) return
    setBusy('card')
    try {
      const { created, skipped } = await invoke('flashcards:generate', { noteIds: [id] })
      toast(created ? 'success' : 'info', created ? 'Flashcard created' : skipped ? 'Select the word or phrase to learn in this sentence, then add it to flashcards.' : 'This note already has a flashcard')
      void refreshDue()
    } catch (err) {
      toastError(err)
    } finally {
      setBusy(null)
    }
  }

  const ask = (): void => {
    useArticles.getState().select(selection)
    useLayout.getState().setChatOpen(true)
    setTimeout(focusVisibleChatInput, 260)
  }

  // Highlighting part of the explanation makes it the chat's topic (Phase 1 behaviour).
  const onBodyMouseUp = (): void => {
    const f = focusFromSelection(bodyRef.current, 'explanation', selection.sentence)
    if (f) useChat.getState().setFocus({ ...f, articleTitle: selection.title, articleDomain: selection.domain })
  }

  const streaming = explanation?.status === 'streaming'
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="relative z-10 shrink-0 border-b border-line/70 bg-white/[0.78] px-4 pt-3 pb-3">
        <div className="flex items-start gap-2">
          <p className="min-w-0 flex-1 text-lg leading-snug font-medium" title={selection.text}>
            {selection.text}
          </p>
          <Button variant="ghost" size="sm" onClick={() => useArticles.getState().select(null)} title="Clear selection" aria-label="Clear selection" icon={<X className="size-4" />} />
        </div>
        {selection.sentence && selection.sentence !== selection.text && selection.source !== 'ai' && (
          <p className="mt-1 text-sm text-muted">
            <span className="text-xs font-medium tracking-wide uppercase">{selection.source === 'book' ? 'From your book: ' : 'From the article: '}</span>
            <span className="italic">“{selection.sentence}”</span>
          </p>
        )}
        {(selection.title || selection.domain) && (
          <p className="mt-1 truncate text-xs text-muted" title={selection.title ?? ''}>
            {selection.domain}
            {selection.title && selection.title !== selection.domain && <> · {selection.title}</>}
          </p>
        )}
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          <Button
            variant="primary"
            size="sm"
            icon={explanation?.status === 'done' ? <RotateCcw className="size-3.5" /> : <Sparkles className="size-3.5" />}
            loading={streaming}
            disabled={!hasKey}
            title={hasKey ? undefined : 'Add your Gemini API key in Settings'}
            onClick={() => void useArticles.getState().explain()}
          >
            {explanation?.status === 'done' ? 'Explain again' : 'Explain'}
          </Button>
          <Button size="sm" variant="secondary" icon={<MessageCircle className="size-3.5" />} onClick={ask} disabled={!hasKey}>
            Ask in chat
          </Button>
          <div className="ml-auto flex items-center gap-1.5">
            <Select value={kind} onChange={(e) => setKind(e.target.value as NoteKind)} className="h-8 text-xs" aria-label="Save as" disabled={!!savedId}>
              {NOTE_KINDS.map((k) => (
                <option key={k.value} value={k.value}>
                  {k.label}
                </option>
              ))}
            </Select>
            <Button
              size="sm"
              variant="secondary"
              loading={busy === 'save'}
              disabled={!!savedId}
              icon={savedId ? <BookmarkCheck className="size-3.5 text-accent" /> : <BookmarkPlus className="size-3.5" />}
              onClick={() => void save()}
            >
              {savedId ? 'Saved' : 'Save to Notes'}
            </Button>
            <Button size="sm" variant="ghost" loading={busy === 'card'} icon={<Layers className="size-3.5" />} onClick={() => void flashcard()} title="Save and make a flashcard" aria-label="Make a flashcard" />
          </div>
        </div>
      </div>

      {/* The reading surface: A Original, B Vocabulary, C Idioms & Phrasal Verbs, D Explanation. */}
      <div ref={bodyRef} onMouseUp={onBodyMouseUp} className="explain-paper min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-5 py-4" style={paperStyle}>
        {!hasKey && (
          <div className="mb-4 rounded-xl bg-info-soft px-3 py-2.5 text-sm text-info">
            Add your Gemini API key in{' '}
            <button className="font-semibold underline" onClick={() => setPage('settings')}>
              Settings
            </button>{' '}
            to get explanations.
          </div>
        )}
        <OriginalContext
          text={selection.text}
          sentence={selection.source !== 'ai' ? selection.sentence : null}
          source={[selection.domain, selection.title && selection.title !== selection.domain ? selection.title : null].filter(Boolean).join(' · ') || null}
        />
        {explanation && explanation.status !== 'error' && (
          <ExplainAnalysisView text={selection.text} sentence={selection.source !== 'ai' ? selection.sentence : null} context={selection.source !== 'ai' ? selection.paragraph : null} />
        )}
        {explanation ? (
          <section data-selection-scope="article" data-ai-text className="ex-section" aria-label="Explanation">
            <ExplanationHeading />
            <p className="mb-2">
              <Badge tone="warn">AI-generated explanation</Badge>
            </p>
            {explanation.text && <Markdown text={explanation.text} streaming={streaming} />}
            {streaming && !explanation.text && (
              <p className="flex items-center gap-2 text-sm text-muted">
                <Loader2 className="size-4 animate-spin" /> Thinking…
              </p>
            )}
            {explanation.status === 'error' && (
              <div className="mt-3 rounded-xl bg-danger-soft px-3 py-2.5 text-sm text-danger">
                <p>{explanation.error}</p>
                <Button size="sm" variant="secondary" className="mt-2" icon={<RotateCcw className="size-3.5" />} onClick={() => void useArticles.getState().explain()}>
                  Try again
                </Button>
              </div>
            )}
          </section>
        ) : (
          hasKey && <p className="mt-4 text-sm text-muted">Press “Explain” for the Bangla meaning, grammar and examples. Or ask about it in the chat below.</p>
        )}
      </div>
    </div>
  )
}
