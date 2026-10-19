import { useEffect, useRef, useState, type ReactNode } from 'react'
import { AlertTriangle, ArrowDown, ArrowUp, CheckCircle2, ImagePlus, Plus, Trash2, Upload } from 'lucide-react'
import { VB_SOURCE_KINDS, type VbDraft, type VbExtraction, type VbSourceKind } from '@shared/vocabBook'
import { invoke } from '@renderer/lib/api'
import { useApp } from '@renderer/stores/app'
import { Badge, Button, Input, Textarea } from '@renderer/components/ui'
import { cn } from '@renderer/lib/cn'
import { useVb } from './vbStore'

interface Row extends VbDraft {
  key: number
  include: boolean
  /** An uncertain word you have checked against the picture. */
  confirmed: boolean
}

const PLACEHOLDER: Partial<Record<VbSourceKind, string>> = {
  story: 'Paste the whole story here. Useful words are chosen in the order they appear; the story is kept as a reference.',
  passage: 'Paste the passage here. Each word keeps the sentence it came from, and its meaning is explained for that sentence.',
  manual: 'One word or phrase per line, in the order you want to learn them.\nabundant\nset off\nin the long run',
  pasted: 'Paste a list: one per line. You may add a meaning: "word | meaning", "word - meaning" or "word: meaning". Numbers and bullets are removed.'
}

/** Add words: picture, story, passage, typed or pasted list → review and correct → import in order. */
export function AddWords({ bookId, onImported }: { bookId: number; onImported: () => void }): ReactNode {
  const { toast, toastError } = useApp.getState()
  const hasKey = useApp((s) => !!s.settings?.hasGeminiKey)
  const [kind, setKind] = useState<VbSourceKind>('book_page')
  const [text, setText] = useState('')
  const [title, setTitle] = useState('')
  const [image, setImage] = useState<{ base64: string; mime: string; url: string; name: string } | null>(null)
  const [busy, setBusy] = useState<'read' | 'import' | null>(null)
  const [result, setResult] = useState<VbExtraction | null>(null)
  const [rows, setRows] = useState<Row[]>([])
  const [pageRef, setPageRef] = useState('')
  const keyRef = useRef(1)
  const fileRef = useRef<HTMLInputElement>(null)
  const isImage = !!VB_SOURCE_KINDS.find((k) => k.value === kind)?.image

  // A picture can also be pasted (Ctrl+V) while this tab is open.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent): void => {
      const f = [...(e.clipboardData?.files ?? [])].find((x) => x.type.startsWith('image/'))
      if (f) {
        if (!isImage) setKind('book_page')
        void loadImage(f)
      }
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  })

  const reset = (): void => {
    setResult(null)
    setRows([])
    setPageRef('')
  }

  const loadImage = async (f: File): Promise<void> => {
    if (!f.type.startsWith('image/')) return toast('error', 'Choose a picture (PNG, JPG, WEBP, BMP or GIF).')
    if (f.size > 15 * 1024 * 1024) return toast('error', 'The picture is larger than 15 MB.')
    const url = await new Promise<string>((resolve, reject) => {
      const r = new FileReader()
      r.onload = () => resolve(String(r.result))
      r.onerror = () => reject(r.error)
      r.readAsDataURL(f)
    })
    reset()
    setImage({ base64: url.slice(url.indexOf(',') + 1), mime: f.type, url, name: f.name })
  }

  const toRows = (r: VbExtraction): void => {
    setResult(r)
    setPageRef(r.pageRef ?? '')
    setRows(r.drafts.map((d) => ({ ...d, key: keyRef.current++, include: d.duplicateOf === null || d.duplicateOf === undefined, confirmed: !d.uncertain })))
  }

  const read = async (): Promise<void> => {
    setBusy('read')
    try {
      if (isImage) {
        if (!image) return toast('error', 'Choose or paste a picture first.')
        toRows(await invoke('vb:extractImage', { bookId, imageBase64: image.base64, mimeType: image.mime }))
      } else {
        toRows(await invoke('vb:extractText', { bookId, kind, text }))
      }
    } catch (err) {
      toastError(err)
    } finally {
      setBusy(null)
    }
  }

  const patchRow = (key: number, p: Partial<Row>): void => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...p } : r)))
  const move = (i: number, d: -1 | 1): void =>
    setRows((rs) => {
      const j = i + d
      if (j < 0 || j >= rs.length) return rs
      const next = [...rs]
      ;[next[i], next[j]] = [next[j], next[i]]
      return next
    })

  const chosen = rows.filter((r) => r.include && r.term.trim())
  const unchecked = chosen.filter((r) => r.uncertain && !r.confirmed)
  const doImport = async (): Promise<void> => {
    if (unchecked.length) return toast('error', `Check the ${unchecked.length} word${unchecked.length === 1 ? '' : 's'} marked “Check” first (tick “Correct” or untick the word).`)
    setBusy('import')
    try {
      const story = kind === 'story' || kind === 'passage'
      const r = await invoke('vb:import', {
        bookId,
        kind,
        title: title.trim() || (isImage ? image?.name ?? null : null),
        text: story || kind === 'pasted' ? text : null,
        imageFile: isImage ? result?.imageFile ?? null : null,
        pageRef: pageRef.trim() || null,
        extraction: result?.engine === 'gemini' ? (isImage ? 'Gemini vision' : 'Chosen by Gemini') : result?.engine === 'windows-ocr' ? 'Windows OCR (offline)' : 'Typed / pasted',
        drafts: chosen.map((r) => ({
          term: r.term.trim(),
          meaningBn: r.meaningBn?.trim() || undefined,
          definitionEn: r.definitionEn?.trim() || undefined,
          pos: r.pos,
          synonyms: r.synonyms,
          collocations: r.collocations,
          example: r.example,
          exampleBn: r.exampleBn,
          context: r.context?.trim() || undefined
        })),
        // Words you ticked although they are already in the book (e.g. another meaning).
        allowDuplicates: chosen.some((r) => r.duplicateOf !== null && r.duplicateOf !== undefined)
      })
      toast(
        'success',
        r.added
          ? `Added ${r.added} word${r.added === 1 ? '' : 's'} as numbers ${r.firstSeq}–${r.lastSeq}${r.skipped.length ? ` · ${r.skipped.length} already in the book` : ''}.${hasKey ? ' Meanings are being filled in.' : ''}`
          : 'Nothing new was added (all already in the book).'
      )
      reset()
      setText('')
      setImage(null)
      setTitle('')
      onImported()
    } catch (err) {
      toastError(err)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="What are you adding?">
        {VB_SOURCE_KINDS.map((k) => (
          <button
            key={k.value}
            role="radio"
            aria-checked={kind === k.value}
            onClick={() => {
              setKind(k.value)
              reset()
            }}
            className={cn('motion-press rounded-xl border px-3 py-1.5 text-xs font-medium', kind === k.value ? 'surface-selected' : 'border-line/60 bg-white/[0.04] hover:bg-white/[0.08]')}
          >
            {k.label}
          </button>
        ))}
      </div>

      {isImage ? (
        <div
          className="glass-inset flex flex-col items-center gap-3 rounded-2xl border border-dashed border-line/80 p-5 text-center"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault()
            const f = e.dataTransfer.files[0]
            if (f) void loadImage(f)
          }}
        >
          {image ? (
            <img src={image.url} alt="The picture to read" className="max-h-72 rounded-lg object-contain" />
          ) : (
            <ImagePlus className="size-10 text-rose/70" />
          )}
          <p className="text-sm text-muted">
            {image ? image.name : 'Drop a photo here, paste it (Ctrl+V), or choose a file.'} Words are read {hasKey ? 'by Gemini (vision)' : 'by Windows OCR (offline)'}; you check and correct
            them before anything is saved.
          </p>
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/bmp,image/gif"
            className="hidden"
            aria-label="Choose a picture"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void loadImage(f)
              e.target.value = ''
            }}
          />
          <div className="flex gap-2">
            <Button icon={<Upload className="size-4" />} onClick={() => fileRef.current?.click()}>
              {image ? 'Choose another' : 'Choose a picture'}
            </Button>
            <Button variant="primary" loading={busy === 'read'} disabled={!image} onClick={() => void read()}>
              Read the words
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          {(kind === 'story' || kind === 'passage') && <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title (optional)" aria-label="Title" />}
          <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={kind === 'manual' ? 6 : 9} placeholder={PLACEHOLDER[kind]} aria-label="Text" />
          <div className="flex justify-end">
            <Button variant="primary" loading={busy === 'read'} disabled={!text.trim()} onClick={() => void read()}>
              {kind === 'story' || kind === 'passage' ? (hasKey ? 'Find the words' : 'Next') : 'Check the list'}
            </Button>
          </div>
        </div>
      )}

      {result && (
        <section className="space-y-2" aria-label="Review the words">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold">Check and correct before importing</h3>
            <Badge tone={result.engine === 'gemini' ? 'accent' : 'info'}>{result.engine === 'gemini' ? 'Gemini' : result.engine === 'windows-ocr' ? 'Windows OCR (offline)' : 'From your text'}</Badge>
            {result.complete && rows.length > 0 && (
              <Badge tone="info">
                <CheckCircle2 className="size-3" /> whole page/list read
              </Badge>
            )}
          </div>
          {result.warning && (
            <p className="flex gap-2 rounded-xl bg-warn-soft px-3 py-2 text-sm text-warn" role="alert">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" /> {result.warning}
            </p>
          )}
          {isImage && (
            <label className="flex items-center gap-2 text-sm">
              <span className="shrink-0 text-muted">Page reference</span>
              <Input value={pageRef} onChange={(e) => setPageRef(e.target.value)} placeholder="e.g. Unit 7, page 42" className="h-8" aria-label="Page reference" />
            </label>
          )}
          {result.skipped && result.skipped.length > 0 && (
            <details className="text-xs text-muted" open={result.skipped.length <= 6}>
              <summary className="cursor-pointer">Lines not used ({result.skipped.length})</summary>
              <ul className="mt-1 list-disc space-y-0.5 pl-5">
                {result.skipped.map((l, i) => (
                  <li key={i}>{l}</li>
                ))}
              </ul>
            </details>
          )}
          {result.rawText && (
            <details className="text-xs text-muted">
              <summary className="cursor-pointer">What the OCR read</summary>
              <pre className="mt-1 whitespace-pre-wrap">{result.rawText}</pre>
            </details>
          )}
          <div className="glass-inset divide-y divide-line/50 overflow-hidden rounded-xl">
            {rows.map((r, i) => (
              <div key={r.key} className={cn('space-y-1.5 px-3 py-2', !r.include && 'opacity-50')} data-review-row>
                <div className="flex flex-wrap items-center gap-2">
                  <input type="checkbox" className="size-4 accent-[var(--accent)]" checked={r.include} onChange={(e) => patchRow(r.key, { include: e.target.checked })} aria-label={`Import ${r.term}`} />
                  <span className="w-6 text-right text-xs text-muted tabular-nums">{i + 1}</span>
                  <div className="w-52 min-w-0">
                    <Input value={r.term} onChange={(e) => patchRow(r.key, { term: e.target.value })} className="h-8 font-medium" aria-label="Word or phrase" />
                  </div>
                  <div className="w-52 min-w-0">
                    <Input value={r.meaningBn ?? ''} onChange={(e) => patchRow(r.key, { meaningBn: e.target.value })} placeholder="Bangla meaning (optional)" className="h-8" aria-label="Bangla meaning" />
                  </div>
                  <div className="min-w-40 flex-1">
                    <Input value={r.definitionEn ?? ''} onChange={(e) => patchRow(r.key, { definitionEn: e.target.value })} placeholder="English meaning (optional)" className="h-8" aria-label="English meaning" />
                  </div>
                  <span className="flex gap-0.5">
                    <Button size="sm" variant="ghost" icon={<ArrowUp className="size-3.5" />} aria-label="Move up" onClick={() => move(i, -1)} />
                    <Button size="sm" variant="ghost" icon={<ArrowDown className="size-3.5" />} aria-label="Move down" onClick={() => move(i, 1)} />
                    <Button size="sm" variant="ghost" icon={<Trash2 className="size-3.5" />} aria-label="Remove" onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))} />
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-2 pl-14 text-xs text-muted">
                  {r.uncertain && r.include && (
                    <label className={cn('flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium', r.confirmed ? 'bg-accent-soft text-accent' : 'bg-warn-soft text-warn')} title={r.note || 'Not read clearly: compare with the picture'}>
                      <input type="checkbox" className="size-3.5" checked={r.confirmed} onChange={(e) => patchRow(r.key, { confirmed: e.target.checked })} aria-label={`${r.term} is correct`} />
                      {r.confirmed ? 'Checked' : `Check${r.note ? `: ${r.note}` : ''} — correct?`}
                    </label>
                  )}
                  {r.duplicateOf !== null && r.duplicateOf !== undefined && <Badge tone="warn">{r.duplicateOf ? `already word ${r.duplicateOf}` : 'repeated in this list'}</Badge>}
                  {r.pos && <Badge>{r.pos}</Badge>}
                  {r.synonyms && r.synonyms.length > 0 && <span>Synonyms: {r.synonyms.join(', ')}</span>}
                  {r.example && <span className="italic">Example: “{r.example}”</span>}
                  {r.context && <span className="w-full truncate italic">“{r.context}”</span>}
                </div>
              </div>
            ))}
            {!rows.length && <p className="px-3 py-3 text-sm text-muted">No words yet. Add them below.</p>}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" icon={<Plus className="size-3.5" />} onClick={() => setRows((rs) => [...rs, { key: keyRef.current++, term: '', include: true, confirmed: true }])}>
              Add a word
            </Button>
            <span className="flex-1 text-xs text-muted">
              {chosen.length} to import{unchecked.length ? ` · ${unchecked.length} still to check` : ''}. They are numbered after the last word in this book, in this order.
            </span>
            <Button variant="primary" loading={busy === 'import'} disabled={!chosen.length || unchecked.length > 0} onClick={() => void doImport()}>
              Import {chosen.length} word{chosen.length === 1 ? '' : 's'}
            </Button>
          </div>
        </section>
      )}
    </div>
  )
}
