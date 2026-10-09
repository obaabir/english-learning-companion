import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { BookOpen, CheckCircle2, Clapperboard, ExternalLink, FilePlus2, FileText, Layers, RefreshCw, Save, Search, Trash2, TriangleAlert, UploadCloud } from 'lucide-react'
import { Group, Panel, Separator } from 'react-resizable-panels'
import { NOTE_KINDS, formatTimestamp, type MovieNotesInfo, type Note, type NoteKind } from '@shared/types'
import { invoke } from '@renderer/lib/api'
import { useApp } from '@renderer/stores/app'
import { Badge, Button, EmptyState, Input, PanelHeader, Select, Textarea } from '@renderer/components/ui'
import { DocPicker } from '@renderer/components/DocPicker'
import { useMovie } from '@renderer/stores/movie'
import { useYouTube } from '@renderer/stores/youtube'
import { Markdown } from '@renderer/components/Markdown'
import { cn } from '@renderer/lib/cn'

const kindLabel = (k: NoteKind): string => NOTE_KINDS.find((x) => x.value === k)?.label ?? k

export function NotesView({ mode }: { mode: 'all' | 'structures' }): ReactNode {
  const toastError = useApp((s) => s.toastError)
  const [notes, setNotes] = useState<Note[]>([])
  const [search, setSearch] = useState('')
  const [kind, setKind] = useState<NoteKind | ''>('')
  // Movies are identified by file path. Start on the movie open in Movie Mode, if it has notes.
  const [moviePath, setMoviePath] = useState<string | null>(null)
  const [movies, setMovies] = useState<MovieNotesInfo[]>([])
  const [selectedId, setSelectedId] = useState<number | null>(null)

  const load = useCallback(async () => {
    try {
      const kinds: NoteKind[] | undefined = mode === 'structures' ? ['structure'] : kind ? [kind] : undefined
      const movieList = await invoke('notes:movies')
      let path = moviePath
      if (path === null) {
        const current = useMovie.getState().status.mediaPath ?? useMovie.getState().feedMedia
        path = current && movieList.some((m) => m.mediaPath === current) ? current : ''
        setMoviePath(path)
      }
      const list = await invoke('notes:list', { kinds, search, mediaPath: path || undefined })
      setMovies(movieList)
      setNotes(list)
    } catch (err) {
      toastError(err)
    }
  }, [mode, kind, search, moviePath, toastError])

  useEffect(() => {
    const t = setTimeout(() => void load(), 150)
    return () => clearTimeout(t)
  }, [load])

  const selected = useMemo(() => notes.find((n) => n.id === selectedId) ?? null, [notes, selectedId])

  const onChanged = (note: Note | null, removedId?: number): void => {
    if (removedId != null) {
      setNotes((ns) => ns.filter((n) => n.id !== removedId))
      setSelectedId(null)
    } else if (note) {
      setNotes((ns) => ns.map((n) => (n.id === note.id ? note : n)))
    }
  }

  const title = mode === 'structures' ? 'Sentence Structures' : 'My Notes'
  const movie = movies.find((m) => m.mediaPath === moviePath) ?? null
  const onMovieDocChanged = (doc: MovieNotesInfo['doc']): void =>
    setMovies((ms) => ms.map((m) => (m.mediaPath === moviePath ? { ...m, doc } : m)))

  return (
    <Group orientation="horizontal" className="h-full">
      <Panel id="list" defaultSize="40" minSize={240}>
        <div className="glass-panel flex h-full flex-col overflow-hidden">
          <PanelHeader title={title} icon={<BookOpen className="size-4" />}>
            <span className="text-xs text-muted">{notes.length} saved</span>
          </PanelHeader>
          <div className="shrink-0 space-y-2 border-b border-line/70 p-3">
            <div className="relative">
              <Search className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-muted" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search notes…" className="pl-8" />
            </div>
            <div className="flex gap-2">
              {mode === 'all' && (
                <Select value={kind} onChange={(e) => setKind(e.target.value as NoteKind | '')} className="h-8 flex-1 text-xs" aria-label="Filter by type">
                  <option value="">All types</option>
                  {NOTE_KINDS.map((k) => (
                    <option key={k.value} value={k.value}>
                      {k.label}
                    </option>
                  ))}
                </Select>
              )}
              <Select
                value={moviePath ?? ''}
                onChange={(e) => {
                  setMoviePath(e.target.value)
                  setSelectedId(null)
                }}
                className="h-8 min-w-0 flex-1 text-xs"
                aria-label="Movie"
              >
                <option value="">All movies</option>
                {movies.map((m) => (
                  <option key={m.mediaPath} value={m.mediaPath} title={m.mediaPath}>
                    {m.mediaTitle} ({m.noteCount})
                  </option>
                ))}
              </Select>
            </div>
          </div>
          {movie && <MovieDocBar movie={movie} onDocChanged={onMovieDocChanged} onSynced={() => void load()} />}
          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {notes.length === 0 ? (
              <EmptyState icon={<BookOpen className="size-10" />} title={search || kind || moviePath ? 'No matching notes' : 'Nothing saved yet'}>
                {mode === 'structures'
                  ? 'Highlight a useful pattern in an explanation or chat (e.g. “The reason why I chose X was that…”) and click Structure.'
                  : 'Click a subtitle in Movie Mode and press “Save to notes”.'}
              </EmptyState>
            ) : (
              notes.map((n) => (
                <button
                  key={n.id}
                  onClick={() => setSelectedId(n.id)}
                  className={cn(
                    'motion-hover mb-1 block w-full rounded-xl border px-3 py-2.5 text-left',
                    n.id === selectedId ? 'surface-selected' : 'border-transparent hover:border-white/80 hover:bg-white/55'
                  )}
                >
                  <p className="line-clamp-2 text-sm font-medium">{n.text}</p>
                  {n.data?.meaning_bn && <p className="mt-0.5 line-clamp-1 text-xs text-muted">{n.data.meaning_bn}</p>}
                  <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-muted">
                    <Badge>{kindLabel(n.kind)}</Badge>
                    {n.mediaTitle && <span className="truncate">{n.mediaTitle}</span>}
                    {n.gdocSyncedAt && <FileText className="ml-auto size-3 shrink-0 text-accent" aria-label="In Google Docs" />}
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      </Panel>
      <Separator className="resize-handle" />
      <Panel id="detail" defaultSize="60" minSize={300}>
        {selected ? (
          <NoteDetail key={selected.id} note={selected} onChanged={onChanged} />
        ) : (
          <div className="glass-panel h-full overflow-hidden">
            <EmptyState icon={<BookOpen className="size-10" />} title="Select a note">
              See its meaning, vocabulary, grammar and examples, jump back to the movie moment, or send it to Google Docs.
            </EmptyState>
          </div>
        )}
      </Panel>
    </Group>
  )
}

function NoteDetail({ note, onChanged }: { note: Note; onChanged: (n: Note | null, removedId?: number) => void }): ReactNode {
  const { toast, toastError, refreshDue, settings } = useApp.getState()
  const [busy, setBusy] = useState<string | null>(null)
  const [showExplanation, setShowExplanation] = useState(!note.data)
  const d = note.data

  const run = async (name: string, fn: () => Promise<void>): Promise<void> => {
    setBusy(name)
    try {
      await fn()
    } catch (err) {
      toastError(err)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="glass-panel flex h-full flex-col overflow-hidden">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl space-y-5 px-6 py-6">
          <div>
            <div className="mb-2 flex items-center gap-2">
              <Select
                value={note.kind}
                onChange={(e) =>
                  void run('kind', async () => onChanged(await invoke('notes:updateKind', { id: note.id, kind: e.target.value as NoteKind })))
                }
                className="h-7 text-xs"
                aria-label="Note type"
              >
                {NOTE_KINDS.map((k) => (
                  <option key={k.value} value={k.value}>
                    {k.label}
                  </option>
                ))}
              </Select>
              <span className="text-xs text-muted">{new Date(note.createdAt).toLocaleString()}</span>
            </div>
            <h1 className="text-xl leading-snug font-semibold" data-savable>
              {note.text}
            </h1>
            {note.contextSentence && note.contextSentence !== note.text && (
              <p className="mt-1.5 text-sm text-muted italic">“{note.contextSentence}”</p>
            )}
            {(note.mediaTitle || note.timestampSec != null) && (
              <div className="mt-2 flex items-center gap-2 text-xs text-muted">
                {note.mediaTitle && <span>{note.mediaTitle}</span>}
                {note.timestampSec != null && (
                  <button
                    className="rounded-md bg-surface-2 px-1.5 py-0.5 tabular-nums hover:text-fg"
                    title="Jump to this moment in the movie"
                    onClick={() =>
                      void run('jump', async () => {
                        if (note.mediaPath && /^https?:\/\//i.test(note.mediaPath)) {
                          useYouTube.getState().openAt(note.mediaPath, Math.max(0, note.timestampSec! - 0.3))
                          useApp.getState().setPage('youtube')
                          return
                        }
                        await invoke('player:seekTo', { mediaPath: note.mediaPath, seconds: Math.max(0, note.timestampSec! - 0.3) })
                      })
                    }
                  >
                    ▶ {formatTimestamp(note.timestampSec)}
                  </button>
                )}
              </div>
            )}
          </div>

          {d ? (
            <div className="space-y-4" data-savable>
              <Block title="Meaning">
                <p className="text-[15px]">{d.meaning_bn}</p>
                <p className="mt-1 text-sm text-muted">{d.meaning_en}</p>
              </Block>
              {d.vocabulary.length > 0 && <Terms title="Vocabulary" items={d.vocabulary} />}
              {d.idioms_phrasal.length > 0 && <Terms title="Idioms / Phrasal verbs" items={d.idioms_phrasal} />}
              {d.grammar.length > 0 && (
                <Block title="Grammar">
                  <ul className="space-y-1.5">
                    {d.grammar.map((g, i) => (
                      <li key={i} className="text-sm">
                        <span className="font-medium">{g.pattern}</span> — <span className="text-muted">{g.explanation}</span>
                      </li>
                    ))}
                  </ul>
                </Block>
              )}
              {d.examples.length > 0 && (
                <Block title="Examples">
                  <ul className="space-y-2">
                    {d.examples.map((e, i) => (
                      <li key={i} className="text-sm">
                        <p>{e.en}</p>
                        <p className="text-muted">{e.bn}</p>
                      </li>
                    ))}
                  </ul>
                </Block>
              )}
            </div>
          ) : (
            <div className="glass-inset rounded-xl px-3 py-2.5 text-sm text-muted">
              No structured analysis yet. {settings?.hasGeminiKey ? 'Click “Analyse” to create it.' : 'Add a Gemini API key in Settings to analyse notes.'}
            </div>
          )}

          <UserNoteEditor note={note} onChanged={onChanged} />

          {note.explanationMd && (
            <div>
              <button className="text-xs font-medium text-info hover:underline" onClick={() => setShowExplanation(!showExplanation)}>
                {showExplanation ? 'Hide' : 'Show'} full explanation
              </button>
              {showExplanation && (
                <div className="mt-2 glass-inset rounded-xl p-4">
                  <Markdown text={note.explanationMd} />
                </div>
              )}
            </div>
          )}

          <div className="flex items-center gap-2 text-xs">
            {note.gdocSyncedAt ? (
              <span className="flex items-center gap-1 text-accent">
                <CheckCircle2 className="size-3.5" /> In Google Docs
                {note.gdocId && (
                  <button className="ml-1 inline-flex items-center gap-0.5 text-info hover:underline" onClick={() => void invoke('google:openDoc', note.gdocId!)}>
                    open <ExternalLink className="size-3" />
                  </button>
                )}
              </span>
            ) : note.gdocError ? (
              <span className="flex items-center gap-1 text-danger">
                <TriangleAlert className="size-3.5" /> {note.gdocError}
              </span>
            ) : (
              <span className="text-muted">Not in Google Docs yet</span>
            )}
          </div>
        </div>
      </div>

      <div className="flex shrink-0 flex-wrap gap-2 border-t border-line/70 bg-white/45 px-6 py-3">
        <Button
          icon={<FileText className="size-4" />}
          loading={busy === 'docs'}
          disabled={!settings?.googleConnected}
          onClick={() =>
            void run('docs', async () => {
              const n = await invoke('notes:syncToDocs', note.id)
              onChanged(n)
              if (n.gdocError) toast('error', n.gdocError)
              else if (note.gdocSyncedAt && n.gdocSyncedAt === note.gdocSyncedAt && n.gdocId === note.gdocId) toast('info', 'Already in this Google Doc')
              else toast('success', 'Added to Google Docs')
            })
          }
        >
          {note.gdocSyncedAt ? 'Check Google Doc' : 'Send to Google Docs'}
        </Button>
        <Button
          icon={<Layers className="size-4" />}
          loading={busy === 'card'}
          onClick={() =>
            void run('card', async () => {
              const { created } = await invoke('flashcards:generate', { noteIds: [note.id] })
              toast(created ? 'success' : 'info', created ? 'Flashcard created' : 'This note already has a flashcard')
              void refreshDue()
            })
          }
        >
          Make flashcard
        </Button>
        <Button
          icon={<RefreshCw className="size-4" />}
          loading={busy === 'analyse'}
          disabled={!settings?.hasGeminiKey}
          onClick={() => void run('analyse', async () => onChanged(await invoke('notes:reanalyze', note.id)))}
        >
          {d ? 'Re-analyse' : 'Analyse'}
        </Button>
        <Button
          variant="danger"
          className="ml-auto"
          icon={<Trash2 className="size-4" />}
          loading={busy === 'delete'}
          onClick={() => {
            if (!confirm('Delete this note and its flashcard?')) return
            void run('delete', async () => {
              await invoke('notes:delete', note.id)
              onChanged(null, note.id)
              void refreshDue()
            })
          }}
        >
          Delete
        </Button>
      </div>
    </div>
  )
}

function Block({ title, children }: { title: string; children: ReactNode }): ReactNode {
  return (
    <section className="glass-inset rounded-xl p-4">
      <h3 className="mb-2 text-xs font-semibold tracking-wide text-muted uppercase">{title}</h3>
      {children}
    </section>
  )
}

function Terms({ title, items }: { title: string; items: { term: string; meaning_bn: string; note: string }[] }): ReactNode {
  return (
    <Block title={title}>
      <ul className="space-y-1.5">
        {items.map((t, i) => (
          <li key={i} className="text-sm">
            <span className="font-medium">{t.term}</span> — {t.meaning_bn}
            {t.note && <span className="text-muted"> · {t.note}</span>}
          </li>
        ))}
      </ul>
    </Block>
  )
}

/** The learner's own note on a saved item; saved explicitly so typing never writes half a note. */
function UserNoteEditor({ note, onChanged }: { note: Note; onChanged: (n: Note) => void }): ReactNode {
  const toastError = useApp((s) => s.toastError)
  const toast = useApp((s) => s.toast)
  const [text, setText] = useState(note.userNote ?? '')
  const [saving, setSaving] = useState(false)
  const dirty = text.trim() !== (note.userNote ?? '')
  const save = async (): Promise<void> => {
    setSaving(true)
    try {
      onChanged(await invoke('notes:updateUserNote', { id: note.id, userNote: text }))
      toast('success', 'Note saved')
    } catch (err) {
      toastError(err)
    } finally {
      setSaving(false)
    }
  }
  return (
    <section className="glass-inset rounded-xl p-4">
      <h3 className="mb-2 text-xs font-semibold tracking-wide text-muted uppercase">My note</h3>
      <Textarea
        rows={3}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Your own note: when you'd use this, a sentence of your own, a memory trick…"
        aria-label="My note"
      />
      <div className="mt-2 flex justify-end">
        <Button size="sm" variant={dirty ? 'primary' : 'secondary'} disabled={!dirty} loading={saving} icon={<Save className="size-3.5" />} onClick={() => void save()}>
          Save note
        </Button>
      </div>
    </section>
  )
}

/** The Google Doc for one movie: choose/create it, open it, and save the movie's new notes into it. */
function MovieDocBar({
  movie,
  onDocChanged,
  onSynced
}: {
  movie: MovieNotesInfo
  onDocChanged: (doc: MovieNotesInfo['doc']) => void
  onSynced: () => void
}): ReactNode {
  const googleConnected = useApp((s) => !!s.settings?.googleConnected)
  const { toast, toastError, setPage } = useApp.getState()
  const [picking, setPicking] = useState(false)
  const [syncing, setSyncing] = useState(false)

  const sync = async (): Promise<void> => {
    setSyncing(true)
    try {
      const r = await invoke('notes:syncMovie', movie.mediaPath)
      const plural = (n: number): string => `${n} note${n === 1 ? '' : 's'}`
      if (r.failed) toast('error', `Saved ${plural(r.added)}, then Google Docs failed: ${r.error ?? 'unknown error'}`)
      else if (r.added === 0) toast('info', "All of this movie's notes are already in its Google Doc")
      else toast('success', `Added ${plural(r.added)} to "${movie.doc?.title}"`)
      onSynced()
    } catch (err) {
      toastError(err)
    } finally {
      setSyncing(false)
    }
  }

  return (
    <div className="shrink-0 space-y-2 border-b border-line/70 bg-white/35 px-3 py-2.5 text-xs">
      <div className="flex min-w-0 items-center gap-1.5 text-muted">
        <Clapperboard className="size-3.5 shrink-0" />
        <span className="truncate" title={movie.mediaPath}>
          {movie.mediaTitle}
        </span>
      </div>
      {!googleConnected ? (
        <p className="text-muted">
          <button className="text-info underline" onClick={() => setPage('settings')}>
            Connect Google
          </button>{' '}
          to keep this movie&apos;s notes in its own Google Doc.
        </p>
      ) : movie.doc ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <FileText className="size-3.5 shrink-0 text-info" />
          <span className="min-w-0 flex-1 truncate font-medium" title={movie.doc.title}>
            {movie.doc.title}
          </span>
          <Button size="sm" variant="ghost" icon={<ExternalLink className="size-3.5" />} onClick={() => void invoke('google:openDoc', movie.doc!.docId)}>
            Open
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setPicking(true)}>
            Change
          </Button>
          <Button size="sm" variant="primary" icon={<UploadCloud className="size-3.5" />} loading={syncing} onClick={() => void sync()}>
            Save new notes to Doc
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-muted">No Google Doc for this movie yet.</span>
          <Button size="sm" icon={<FilePlus2 className="size-3.5" />} onClick={() => setPicking(true)}>
            Choose or create
          </Button>
        </div>
      )}
      {picking && (
        <DocPicker
          heading={`Google Doc for ${movie.mediaTitle}`}
          defaultTitle={`${movie.mediaTitle} — English Notes`}
          onChoose={async (doc) => {
            onDocChanged(await invoke('google:setMovieDoc', { mediaPath: movie.mediaPath, mediaTitle: movie.mediaTitle, doc }))
            toast('success', `This movie's notes will go to "${doc.title}"`)
          }}
          onCreate={async (title) => {
            onDocChanged(await invoke('google:createMovieDoc', { mediaPath: movie.mediaPath, mediaTitle: movie.mediaTitle, title }))
            toast('success', `Created "${title}"`)
          }}
          onClose={() => setPicking(false)}
        />
      )}
    </div>
  )
}
