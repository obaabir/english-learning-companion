import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ArrowLeft, AudioLines, CheckCircle2, FileUp, History, KeyRound, Plus, Trash2, TriangleAlert } from 'lucide-react'
import { useApp } from '@renderer/stores/app'
import { Badge, Button, EmptyState, Input, PanelHeader } from '@renderer/components/ui'
import { cn } from '@renderer/lib/cn'
import { preloadFFmpeg } from './audioExtract'
import { getApiKey, setApiKey, SPEAKING_COACH_MODEL, testApiKey } from './geminiService'
import { ACCEPT_ATTR, ACCEPTED_EXTENSIONS, useSpeakingCoach } from './speakingCoachStore'
import { formatBytes, formatClock } from './transcriptFormat'
import { TranscriptWorkspace } from './TranscriptWorkspace'
import { useEscape } from '@renderer/lib/navigation'

/** Speaking Coach: upload a recording of yourself speaking → audio extracted locally → verbatim transcript. */
export function SpeakingCoachView(): ReactNode {
  const view = useSpeakingCoach((s) => s.view)
  const setView = useSpeakingCoach((s) => s.setView)
  const settingsOpen = useSpeakingCoach((s) => s.settingsOpen)
  const setSettingsOpen = useSpeakingCoach((s) => s.setSettingsOpen)
  const hasSource = useSpeakingCoach((s) => s.source !== null)
  const busy = useSpeakingCoach((s) => s.phase === 'extracting' || s.phase === 'transcribing')
  const reset = useSpeakingCoach((s) => s.reset)

  useEffect(() => {
    // ffmpeg.wasm is loaded only when this section opens (never at app start).
    preloadFFmpeg()
    void useSpeakingCoach.getState().loadHistory().catch(useApp.getState().toastError)
  }, [])

  return (
    <div className="glass-panel flex h-full flex-col overflow-hidden">
      <PanelHeader title={view === 'history' ? 'Speaking Coach: History' : 'Speaking Coach'} icon={<AudioLines className="size-4" />}>
        {view === 'history' ? (
          <Button size="sm" variant="ghost" icon={<ArrowLeft className="size-3.5" />} onClick={() => setView('main')}>
            Back
          </Button>
        ) : (
          <>
            {hasSource && (
              <Button size="sm" variant="ghost" icon={<Plus className="size-3.5" />} onClick={reset} disabled={busy} title={busy ? 'Wait for the current job or stop it first' : 'Start with a new recording'}>
                New
              </Button>
            )}
            <Button size="sm" variant="ghost" icon={<History className="size-3.5" />} onClick={() => setView('history')}>
              History
            </Button>
          </>
        )}
        <Button size="sm" variant={settingsOpen ? 'secondary' : 'ghost'} icon={<KeyRound className="size-3.5" />} onClick={() => setSettingsOpen(!settingsOpen)}>
          Settings
        </Button>
      </PanelHeader>
      {settingsOpen && <SettingsBox onClose={() => setSettingsOpen(false)} />}
      <div className="min-h-0 flex-1">{view === 'history' ? <HistoryList /> : hasSource ? <TranscriptWorkspace /> : <UploadZone />}</div>
    </div>
  )
}

/** Gemini API key for this section (beta): kept in localStorage on this computer, never in the code. */
function SettingsBox({ onClose }: { onClose: () => void }): ReactNode {
  // Escape closes it (only the top-most open layer).
  useEscape(onClose)
  const { toast } = useApp.getState()
  const [saved, setSaved] = useState(() => !!getApiKey())
  const [draft, setDraft] = useState('')
  const [testing, setTesting] = useState(false)

  const save = (): void => {
    if (!draft.trim()) return
    setApiKey(draft)
    setDraft('')
    setSaved(true)
    toast('success', 'Gemini key saved on this computer')
  }
  const test = async (): Promise<void> => {
    setTesting(true)
    try {
      await testApiKey()
      toast('success', `Your key works with ${SPEAKING_COACH_MODEL}`)
    } catch (err) {
      toast('error', err instanceof Error ? err.message : String(err))
    } finally {
      setTesting(false)
    }
  }

  return (
    <div className="anim-fade-in border-b border-line/60 px-4 py-3">
      <div className="mx-auto flex max-w-3xl flex-col gap-2">
        <div className="flex items-center gap-2 text-sm">
          <span className="font-semibold">Gemini API key</span>
          {saved ? (
            <Badge tone="info">
              <CheckCircle2 className="size-3" /> Saved
            </Badge>
          ) : (
            <Badge tone="warn">Not set</Badge>
          )}
          <span className="ml-auto text-xs text-muted">Model: {SPEAKING_COACH_MODEL}</span>
        </div>
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            save()
          }}
        >
          <Input
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={saved ? 'Paste a new key to replace the saved one' : 'Paste your Gemini API key (free from aistudio.google.com/apikey)'}
            className="min-w-60 flex-1"
          />
          <Button type="submit" variant="primary" disabled={!draft.trim()}>
            Save key
          </Button>
          <Button type="button" disabled={!saved} loading={testing} onClick={() => void test()}>
            Test key
          </Button>
          {saved && (
            <Button
              type="button"
              variant="danger"
              onClick={() => {
                setApiKey(null)
                setSaved(false)
              }}
            >
              Remove
            </Button>
          )}
          <Button type="button" variant="ghost" onClick={onClose}>
            Close
          </Button>
        </form>
        <p className="text-xs text-muted">
          Stored only in this app on this computer (localStorage). It is separate from the key in the main Settings page. To change the model, edit SPEAKING_COACH_MODEL in
          speakingcoach/geminiService.ts.
        </p>
      </div>
    </div>
  )
}

function UploadZone(): ReactNode {
  const chooseFile = useSpeakingCoach((s) => s.chooseFile)
  const error = useSpeakingCoach((s) => s.error)
  const inputRef = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)

  return (
    <div className="flex h-full items-center justify-center overflow-y-auto p-6">
      <div
        onDragOver={(e) => {
          e.preventDefault()
          e.dataTransfer.dropEffect = 'copy'
          setOver(true)
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setOver(false)
          const f = e.dataTransfer.files[0]
          if (f) chooseFile(f)
        }}
        className={cn(
          'flex w-full max-w-2xl flex-col items-center gap-3 rounded-2xl border-2 border-dashed px-6 py-14 text-center transition-colors',
          over ? 'border-accent bg-accent-soft' : 'border-line'
        )}
      >
        <FileUp className="size-10 text-rose/80" />
        <p className="text-base font-semibold">Drop a recording of yourself speaking</p>
        <p className="max-w-md text-sm text-muted">
          Video or audio: {ACCEPTED_EXTENSIONS.join(', ')}. Up to 500 MB. The audio is extracted on this computer; only small audio parts are sent to Gemini.
        </p>
        <Button variant="primary" icon={<FileUp className="size-4" />} onClick={() => inputRef.current?.click()}>
          Choose file
        </Button>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT_ATTR}
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) chooseFile(f)
            e.target.value = ''
          }}
        />
        {error && (
          <p className="flex items-center gap-1.5 text-sm text-danger">
            <TriangleAlert className="size-4 shrink-0" /> {error}
          </p>
        )}
      </div>
    </div>
  )
}

function HistoryList(): ReactNode {
  const history = useSpeakingCoach((s) => s.history)
  const savedId = useSpeakingCoach((s) => s.savedId)
  const busy = useSpeakingCoach((s) => s.phase === 'extracting' || s.phase === 'transcribing')
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const { toastError } = useApp.getState()

  useEffect(() => {
    void useSpeakingCoach.getState().loadHistory().catch(toastError)
  }, [toastError])

  if (history.length === 0)
    return (
      <EmptyState icon={<History className="size-10" />} title="No saved transcripts yet">
        Transcripts are saved automatically when they finish, and when you press Save.
      </EmptyState>
    )

  return (
    <div className="h-full overflow-y-auto p-4">
      <ul className="mx-auto flex max-w-3xl flex-col gap-2">
        {history.map((t) => (
          <li key={t.id} className={cn('flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3', t.id === savedId ? 'surface-selected' : 'border-line/60')}>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{t.title}</p>
              <p className="mt-0.5 text-xs text-muted tabular-nums">
                {new Date(t.updatedAt).toLocaleString()} · {t.durationSec ? formatClock(t.durationSec) : '—'} · {t.lineCount} lines · {formatBytes(t.fileSize)}
              </p>
            </div>
            {!t.complete && <Badge tone="warn">Incomplete</Badge>}
            <Button
              size="sm"
              disabled={busy}
              onClick={() => void useSpeakingCoach.getState().openSaved(t.id).catch(toastError)}
              title={busy ? 'Wait for the current job or stop it first' : undefined}
            >
              Open
            </Button>
            {confirmId === t.id ? (
              <>
                <Button
                  size="sm"
                  variant="danger"
                  onClick={() => {
                    setConfirmId(null)
                    void useSpeakingCoach.getState().deleteSaved(t.id).catch(toastError)
                  }}
                >
                  Delete for good
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirmId(null)}>
                  Keep
                </Button>
              </>
            ) : (
              <Button size="sm" variant="ghost" icon={<Trash2 className="size-3.5" />} onClick={() => setConfirmId(t.id)} aria-label={`Delete ${t.title}`}>
                Delete
              </Button>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
