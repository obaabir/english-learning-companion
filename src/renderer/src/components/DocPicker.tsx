import { useEffect, useState, type ReactNode } from 'react'
import { FilePlus2, FileText, Search, X } from 'lucide-react'
import type { GoogleDocInfo } from '@shared/types'
import { invoke } from '@renderer/lib/api'
import { useApp } from '@renderer/stores/app'
import { Button, Input } from '@renderer/components/ui'

/**
 * Dialog to create a new Google Doc or pick an existing one. The caller decides
 * what the doc is for (a notes category, or one movie) via onChoose / onCreate,
 * which should only resolve once the choice is actually saved.
 */
export function DocPicker({
  heading,
  defaultTitle,
  onChoose,
  onCreate,
  onClose
}: {
  heading: string
  defaultTitle: string
  onChoose: (doc: GoogleDocInfo) => Promise<void>
  onCreate: (title: string) => Promise<void>
  onClose: () => void
}): ReactNode {
  const toastError = useApp((s) => s.toastError)
  const [query, setQuery] = useState('')
  const [docs, setDocs] = useState<GoogleDocInfo[] | null>(null)
  const [newTitle, setNewTitle] = useState(defaultTitle)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    const t = setTimeout(() => {
      invoke('google:listDocs', query)
        .then((list) => !cancelled && setDocs(list))
        .catch((err) => {
          if (cancelled) return
          toastError(err)
          setDocs([])
        })
    }, 250)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [query, toastError])

  const run = async (fn: () => Promise<void>): Promise<void> => {
    setBusy(true)
    try {
      await fn()
      onClose()
    } catch (err) {
      toastError(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="anim-fade-in fixed inset-0 z-40 flex items-center justify-center bg-[rgba(36,35,42,0.28)] p-4" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-label={heading}
        className="glass-elevated anim-pop-in flex max-h-[85vh] w-full max-w-lg flex-col rounded-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="glass-header flex items-center gap-2 rounded-t-2xl px-5 py-3.5">
          <h3 className="min-w-0 truncate font-semibold">{heading}</h3>
          <Button variant="ghost" size="sm" className="ml-auto" icon={<X className="size-4" />} onClick={onClose} aria-label="Close" />
        </div>
        <div className="border-b border-line/70 p-4">
          <p className="mb-1.5 text-xs font-medium text-muted">Create a new document</p>
          <div className="flex gap-2">
            <Input value={newTitle} onChange={(e) => setNewTitle(e.target.value)} aria-label="New document title" />
            <Button variant="primary" icon={<FilePlus2 className="size-4" />} loading={busy} onClick={() => void run(() => onCreate(newTitle.trim() || defaultTitle))}>
              Create
            </Button>
          </div>
        </div>
        <div className="p-4 pb-2">
          <p className="mb-1.5 text-xs font-medium text-muted">…or pick an existing one</p>
          <div className="relative">
            <Search className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-muted" />
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search your Google Docs" className="pl-8" autoFocus />
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
          {docs === null ? (
            <p className="p-4 text-sm text-muted">Loading…</p>
          ) : docs.length === 0 ? (
            <p className="p-4 text-sm text-muted">No documents found.</p>
          ) : (
            docs.map((d) => (
              <button
                key={d.id}
                disabled={busy}
                onClick={() => void run(() => onChoose(d))}
                className="motion-press flex w-full items-center gap-2.5 rounded-[10px] px-3 py-2 text-left text-sm hover:bg-white/80 disabled:opacity-50"
              >
                <FileText className="size-4 shrink-0 text-rose" />
                <span className="flex-1 truncate">{d.title}</span>
                {d.modifiedTime && <span className="text-xs text-muted">{new Date(d.modifiedTime).toLocaleDateString()}</span>}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
