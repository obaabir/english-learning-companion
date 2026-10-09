import type { ReactNode } from 'react'
import { CheckCircle2, Info, X, XCircle } from 'lucide-react'
import { useApp } from '@renderer/stores/app'
import { cn } from '@renderer/lib/cn'

export function Toasts(): ReactNode {
  const toasts = useApp((s) => s.toasts)
  const dismiss = useApp((s) => s.dismissToast)
  return (
    // Top centre, so messages never cover the chat input or the action panel.
    <div className="pointer-events-none fixed top-3 left-1/2 z-50 flex w-96 max-w-[calc(100vw-2rem)] -translate-x-1/2 flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          role="status"
          className={cn(
            'glass-elevated pointer-events-auto flex items-start gap-2 px-3 py-2.5 text-sm',
            t.leaving ? 'anim-pop-out' : 'anim-pop-in',
            t.kind === 'error' && 'ring-1 ring-danger/25'
          )}
        >
          {t.kind === 'success' && <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-accent" />}
          {t.kind === 'error' && <XCircle className="mt-0.5 size-4 shrink-0 text-danger" />}
          {t.kind === 'info' && <Info className="mt-0.5 size-4 shrink-0 text-rose" />}
          <span className="flex-1">{t.text}</span>
          <button onClick={() => dismiss(t.id)} className="motion-press rounded-md text-muted hover:text-fg" aria-label="Dismiss">
            <X className="size-4" />
          </button>
        </div>
      ))}
    </div>
  )
}
