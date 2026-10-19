import { useState, type ReactNode } from 'react'
import { Check, X } from 'lucide-react'
import type { Flashcard, FlashcardEdit } from '@shared/types'
import { invoke } from '@renderer/lib/api'
import { useApp } from '@renderer/stores/app'
import { Button, Input, Textarea } from '@renderer/components/ui'

/**
 * Edit a flashcard: the English front (the word or phrase to learn) and, if you want, its meaning and
 * example. Only the fields you change are saved; Cancel keeps the card exactly as it was.
 */
export function FlashcardEditor({ card, onSaved, onCancel }: { card: Flashcard; onSaved: (card: Flashcard) => void; onCancel: () => void }): ReactNode {
  const [front, setFront] = useState(card.front)
  const [meaningBn, setMeaningBn] = useState(card.back.meaning_bn)
  const [meaningEn, setMeaningEn] = useState(card.back.meaning_en)
  const [example, setExample] = useState(card.back.example)
  const [exampleBn, setExampleBn] = useState(card.back.example_bn)
  const [busy, setBusy] = useState(false)
  const toastError = useApp((s) => s.toastError)

  const changes: FlashcardEdit = { id: card.id }
  if (front.trim() !== card.front.trim()) changes.front = front
  if (meaningBn !== card.back.meaning_bn) changes.meaningBn = meaningBn
  if (meaningEn !== card.back.meaning_en) changes.meaningEn = meaningEn
  if (example !== card.back.example) changes.example = example
  if (exampleBn !== card.back.example_bn) changes.exampleBn = exampleBn
  const changed = Object.keys(changes).length > 1

  const save = async (): Promise<void> => {
    if (!front.trim()) return
    setBusy(true)
    try {
      onSaved(await invoke('flashcards:edit', changes))
    } catch (err) {
      toastError(err)
    } finally {
      setBusy(false)
    }
  }

  const sentence = card.source?.contextSentence ?? (card.source?.kind === 'sentence' ? card.source.text : null)
  return (
    <form
      className="space-y-3 text-left"
      onClick={(e) => e.stopPropagation()}
      onSubmit={(e) => {
        e.preventDefault()
        if (changed) void save()
      }}
      onKeyDown={(e) => e.key === 'Escape' && onCancel()}
    >
      <label className="block">
        <span className="text-xs font-semibold tracking-wide text-muted uppercase">English front — the word or phrase to learn</span>
        <Input value={front} onChange={(e) => setFront(e.target.value)} autoFocus aria-label="English front" className="mt-1 h-10 text-base font-semibold" maxLength={120} />
      </label>
      {sentence && (
        <p className="text-xs text-muted">
          From the original sentence: <span className="italic">“{sentence}”</span> (stays on the back as context)
        </p>
      )}
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="block">
          <span className="text-xs text-muted">Bangla meaning</span>
          <Textarea rows={2} value={meaningBn} onChange={(e) => setMeaningBn(e.target.value)} aria-label="Bangla meaning" className="mt-1 text-sm" />
        </label>
        <label className="block">
          <span className="text-xs text-muted">English meaning</span>
          <Textarea rows={2} value={meaningEn} onChange={(e) => setMeaningEn(e.target.value)} aria-label="English meaning" className="mt-1 text-sm" />
        </label>
        <label className="block">
          <span className="text-xs text-muted">Example</span>
          <Textarea rows={2} value={example} onChange={(e) => setExample(e.target.value)} aria-label="Example" className="mt-1 text-sm" />
        </label>
        <label className="block">
          <span className="text-xs text-muted">Example in Bangla</span>
          <Textarea rows={2} value={exampleBn} onChange={(e) => setExampleBn(e.target.value)} aria-label="Example in Bangla" className="mt-1 text-sm" />
        </label>
      </div>
      <p className="text-xs text-muted">
        Saving updates this card and the same word in your vocabulary collection (Notes), so flashcards and games stay the same. The original sentence and source are not
        changed; entries already sent to Google Docs stay as they are.
      </p>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" icon={<X className="size-3.5" />} onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" loading={busy} disabled={!changed || !front.trim()} icon={<Check className="size-3.5" />}>
          Save
        </Button>
      </div>
    </form>
  )
}
