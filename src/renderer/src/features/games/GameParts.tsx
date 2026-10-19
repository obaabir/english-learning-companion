import type { ReactNode } from 'react'
import { ArrowRight, CheckCircle2, RotateCcw, XCircle } from 'lucide-react'
import type { Note } from '@shared/types'
import { noteExplanation } from '@shared/games'
import { Badge, Button } from '@renderer/components/ui'
import { cn } from '@renderer/lib/cn'

/** Where a sentence comes from: the learner's own notes (original) or AI-made practice. */
export function Origin({ ai, source }: { ai?: boolean; source?: string | null }): ReactNode {
  return ai ? (
    <Badge tone="warn">AI-generated practice sentence</Badge>
  ) : (
    <Badge tone="info">From your notes{source ? ` · ${source}` : ''}</Badge>
  )
}

/** The result after submitting: green when right, red when not, why, the grammar, and another try. */
export function Feedback({
  correct,
  title,
  children,
  onRetry,
  onNext,
  nextLabel = 'Next'
}: {
  correct: boolean
  title?: string
  children?: ReactNode
  onRetry?: () => void
  onNext?: () => void
  nextLabel?: string
}): ReactNode {
  return (
    <div
      role="status"
      className={cn(
        'anim-fade-in mt-4 rounded-xl border px-4 py-3',
        correct ? 'border-[#52d6a0]/60 bg-[#52d6a0]/12' : 'border-danger/50 bg-danger-soft'
      )}
    >
      <p className={cn('flex items-center gap-2 text-sm font-semibold', correct ? 'text-[#52d6a0]' : 'text-danger')}>
        {correct ? <CheckCircle2 className="size-4" /> : <XCircle className="size-4" />}
        {title ?? (correct ? 'Correct!' : 'Not quite')}
      </p>
      {children && <div className="mt-2 space-y-1.5 text-sm">{children}</div>}
      <div className="mt-3 flex flex-wrap gap-2">
        {onRetry && (
          <Button size="sm" variant="secondary" icon={<RotateCcw className="size-3.5" />} onClick={onRetry}>
            Try again
          </Button>
        )}
        {onNext && (
          <Button size="sm" variant="primary" icon={<ArrowRight className="size-3.5" />} onClick={onNext}>
            {nextLabel}
          </Button>
        )}
      </div>
    </div>
  )
}

/** "Why" from the learner's saved note: meaning and the grammar structures saved with it. */
export function NoteWhy({ note, label }: { note: Note | undefined; label?: string }): ReactNode {
  if (!note) return null
  const e = noteExplanation(note)
  return (
    <>
      {(e.meaningBn || e.meaningEn) && (
        <p>
          <b>{label ?? note.text}</b>: {e.meaningBn}
          {e.meaningEn && <span className="text-muted"> — {e.meaningEn}</span>}
        </p>
      )}
      {e.grammar.length > 0 && (
        <div>
          <p className="text-xs font-semibold tracking-wide text-muted uppercase">Grammar</p>
          {e.grammar.slice(0, 3).map((g, i) => (
            <p key={i}>• {g}</p>
          ))}
        </div>
      )}
    </>
  )
}

/** Shown when the notes don't have enough material for a game. */
export function NotEnough({ children }: { children: ReactNode }): ReactNode {
  return <p className="glass-inset rounded-xl px-4 py-3 text-sm text-muted">{children}</p>
}

export function Progress({ index, total }: { index: number; total: number }): ReactNode {
  return (
    <p className="mb-3 text-xs text-muted tabular-nums">
      {index + 1} / {total}
    </p>
  )
}
