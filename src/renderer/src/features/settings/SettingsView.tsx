import { useEffect, useState, type ReactNode } from 'react'
import { CheckCircle2, ExternalLink, FileText, FolderOpen, Settings } from 'lucide-react'
import { DOC_CATEGORIES, type DocCategory, type PlayerKind } from '@shared/types'
import { invoke } from '@renderer/lib/api'
import { useApp } from '@renderer/stores/app'
import { DocPicker } from '@renderer/components/DocPicker'
import { cn } from '@renderer/lib/cn'
import { Badge, Button, Field, Input, PanelHeader, Section } from '@renderer/components/ui'

export function SettingsView(): ReactNode {
  const settings = useApp((s) => s.settings)
  const { setSettings, toast, toastError } = useApp.getState()
  const [mpvPath, setMpvPath] = useState('')
  const [vlcPath, setVlcPath] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [model, setModel] = useState('')
  const [models, setModels] = useState<string[]>([])
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [picker, setPicker] = useState<DocCategory | null>(null)

  useEffect(() => {
    if (!settings) return
    setMpvPath(settings.mpvPath)
    setVlcPath(settings.vlcPath)
    setModel(settings.geminiModel)
    setClientId(settings.googleClientId)
  }, [settings])

  if (!settings) return null

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
    <div className="flex h-full flex-col">
      <PanelHeader title="Settings" icon={<Settings className="size-4" />} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl space-y-5 px-6 py-6">
          <Section
            title="Movie player"
            description="Movies play in your chosen player while this app shows their English subtitles line by line."
          >
            <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Media player">
              {(
                [
                  { value: 'vlc', title: 'VLC media player', text: 'Recommended. Reads subtitles from .srt files or inside .mkv movies.' },
                  { value: 'mpv', title: 'mpv', text: 'Alternative player that reports the subtitle on screen directly.' }
                ] as { value: PlayerKind; title: string; text: string }[]
              ).map((p) => (
                <button
                  key={p.value}
                  role="radio"
                  aria-checked={settings.player === p.value}
                  onClick={() =>
                    void run('player', async () => {
                      setSettings(await invoke('settings:update', { player: p.value }))
                      toast('success', `Movies will play in ${p.title}`)
                    })
                  }
                  className={cn(
                    'motion-press rounded-xl border p-3 text-left',
                    settings.player === p.value ? 'surface-selected' : 'btn-glass'
                  )}
                >
                  <p className="text-sm font-medium">{p.title}</p>
                  <p className="mt-0.5 text-xs text-muted">{p.text}</p>
                </button>
              ))}
            </div>
            {settings.player === 'vlc' ? (
              <Field label="vlc.exe location" hint="Found automatically when VLC is installed in Program Files.">
                <div className="flex gap-2">
                  <Input value={vlcPath} onChange={(e) => setVlcPath(e.target.value)} placeholder="C:\Program Files\VideoLAN\VLC\vlc.exe" />
                  <Button icon={<FolderOpen className="size-4" />} onClick={() => void run('browse', async () => setSettings(await invoke('settings:pickVlcPath')))}>
                    Browse
                  </Button>
                  <Button
                    variant="primary"
                    loading={busy === 'vlc'}
                    disabled={vlcPath === settings.vlcPath}
                    onClick={() =>
                      void run('vlc', async () => {
                        setSettings(await invoke('settings:update', { vlcPath }))
                        toast('success', 'VLC path saved')
                      })
                    }
                  >
                    Save
                  </Button>
                </div>
              </Field>
            ) : (
              <Field label="mpv.exe location" hint='Use "mpv" if it is on your PATH, or browse to mpv.exe.'>
                <div className="flex gap-2">
                  <Input value={mpvPath} onChange={(e) => setMpvPath(e.target.value)} placeholder="C:\Program Files\mpv\mpv.exe" />
                  <Button icon={<FolderOpen className="size-4" />} onClick={() => void run('browse', async () => setSettings(await invoke('settings:pickMpvPath')))}>
                    Browse
                  </Button>
                  <Button
                    variant="primary"
                    loading={busy === 'mpv'}
                    disabled={mpvPath === settings.mpvPath}
                    onClick={() =>
                      void run('mpv', async () => {
                        setSettings(await invoke('settings:update', { mpvPath }))
                        toast('success', 'mpv path saved')
                      })
                    }
                  >
                    Save
                  </Button>
                </div>
              </Field>
            )}
          </Section>

          <Section
            title="Gemini"
            description={
              <>
                Get a free API key from{' '}
                <a className="text-info underline" href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">
                  Google AI Studio
                </a>
                . It is stored encrypted on this computer.
              </>
            }
          >
            <Field label="API key">
              <div className="flex gap-2">
                <Input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={settings.hasGeminiKey ? '•••••••••••• (saved, type to replace)' : 'Paste your Gemini API key'}
                  autoComplete="off"
                />
                <Button
                  variant="primary"
                  loading={busy === 'key'}
                  disabled={!apiKey.trim()}
                  onClick={() =>
                    void run('key', async () => {
                      setSettings(await invoke('settings:update', { geminiApiKey: apiKey }))
                      setApiKey('')
                      toast('success', 'Gemini API key saved')
                    })
                  }
                >
                  Save
                </Button>
                {settings.hasGeminiKey && (
                  <Button
                    variant="danger"
                    onClick={() => void run('clearKey', async () => setSettings(await invoke('settings:update', { geminiApiKey: '' })))}
                  >
                    Remove
                  </Button>
                )}
              </div>
            </Field>
            <Field label="Model" hint="A fast Flash model is best for explanations. Load the list to see what your key can use.">
              <div className="flex gap-2">
                <Input value={model} onChange={(e) => setModel(e.target.value)} list="gemini-models" placeholder="gemini-flash-latest" />
                <datalist id="gemini-models">
                  {models.map((m) => (
                    <option key={m} value={m} />
                  ))}
                </datalist>
                <Button
                  loading={busy === 'models'}
                  disabled={!settings.hasGeminiKey}
                  onClick={() =>
                    void run('models', async () => {
                      const list = await invoke('ai:listModels')
                      setModels(list)
                      toast('success', `Your Gemini key works ✓ (${list.length} models available). You can keep the default model.`)
                    })
                  }
                >
                  Load models
                </Button>
                <Button
                  variant="primary"
                  loading={busy === 'model'}
                  disabled={model === settings.geminiModel}
                  onClick={() =>
                    void run('model', async () => {
                      setSettings(await invoke('settings:update', { geminiModel: model }))
                      toast('success', 'Model saved')
                    })
                  }
                >
                  Save
                </Button>
              </div>
            </Field>
          </Section>

          <Section title="Explanations" description="How the Explanation panel behaves in Movie Mode.">
            <label className="flex cursor-pointer items-start gap-3">
              <input
                type="checkbox"
                className="mt-0.5 size-4 accent-[var(--accent)]"
                checked={settings.autoExplain}
                onChange={(e) => void run('auto', async () => setSettings(await invoke('settings:update', { autoExplain: e.target.checked })))}
              />
              <span>
                <span className="block text-sm font-medium">Explain automatically when I click a subtitle</span>
                <span className="block text-xs text-muted">Uses your selected prompt. Turn off to explain only when you press the button.</span>
              </span>
            </label>
          </Section>

          <Section
            title="Google account"
            description="Needed for saving notes to Google Docs. Create a Desktop OAuth client in Google Cloud Console (steps in SETUP.md)."
          >
            <div className="grid grid-cols-2 gap-3">
              <Field label="OAuth client ID">
                <Input value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="xxxx.apps.googleusercontent.com" />
              </Field>
              <Field label="OAuth client secret">
                <Input
                  type="password"
                  value={clientSecret}
                  onChange={(e) => setClientSecret(e.target.value)}
                  placeholder={settings.hasGoogleSecret ? '•••••••• (saved)' : 'GOCSPX-…'}
                  autoComplete="off"
                />
              </Field>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                loading={busy === 'oauth'}
                disabled={clientId === settings.googleClientId && !clientSecret.trim()}
                onClick={() =>
                  void run('oauth', async () => {
                    setSettings(
                      await invoke('settings:update', {
                        googleClientId: clientId,
                        ...(clientSecret.trim() ? { googleClientSecret: clientSecret } : {})
                      })
                    )
                    setClientSecret('')
                    toast('success', 'Google client saved')
                  })
                }
              >
                Save client
              </Button>
              {settings.googleConnected ? (
                <>
                  <Badge tone="accent">
                    <CheckCircle2 className="size-3" /> Connected{settings.googleAccount ? ` as ${settings.googleAccount}` : ''}
                  </Badge>
                  <Button variant="danger" loading={busy === 'disconnect'} onClick={() => void run('disconnect', async () => setSettings(await invoke('google:disconnect')))}>
                    Disconnect
                  </Button>
                </>
              ) : (
                <Button
                  variant="primary"
                  loading={busy === 'connect'}
                  disabled={!settings.googleClientId || !settings.hasGoogleSecret}
                  onClick={() =>
                    void run('connect', async () => {
                      toast('info', 'Finish signing in in your browser…')
                      setSettings(await invoke('google:connect'))
                      toast('success', 'Google connected. Your notes documents are ready in Google Drive.')
                    })
                  }
                >
                  Connect Google
                </Button>
              )}
            </div>
          </Section>

          <Section title="Google Docs destinations" description="Each kind of note goes to its own document. You can change the document at any time.">
            {DOC_CATEGORIES.map((c) => {
              const target = settings.docTargets.find((t) => t.category === c.value)
              return (
                <div key={c.value} className="glass-inset flex items-center gap-3 rounded-xl px-3 py-2.5">
                  <FileText className="size-4 shrink-0 text-muted" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{c.label}</p>
                    <p className="truncate text-xs text-muted">
                      {target ? target.title : 'No document chosen'}
                      {c.value === 'ielts' && ' · used by IELTS mode (coming later)'}
                    </p>
                  </div>
                  {target && (
                    <Button size="sm" variant="ghost" icon={<ExternalLink className="size-3.5" />} onClick={() => void invoke('google:openDoc', target.docId)}>
                      Open
                    </Button>
                  )}
                  <Button size="sm" disabled={!settings.googleConnected} onClick={() => setPicker(c.value)}>
                    {target ? 'Change' : 'Choose'}
                  </Button>
                </div>
              )
            })}
            {!settings.googleConnected && <p className="text-xs text-muted">Connect Google above to choose documents.</p>}
            <label className="flex cursor-pointer items-start gap-3 pt-1">
              <input
                type="checkbox"
                className="mt-0.5 size-4 accent-[var(--accent)]"
                checked={settings.autoSaveToDocs}
                onChange={(e) => void run('autoDocs', async () => setSettings(await invoke('settings:update', { autoSaveToDocs: e.target.checked })))}
              />
              <span>
                <span className="block text-sm font-medium">Save every note to Google Docs automatically</span>
                <span className="block text-xs text-muted">
                  Words, sentences and structures you save go straight into these documents. Notes saved while offline are sent when Google is connected again.
                </span>
              </span>
            </label>
            {settings.googleConnected && (
              <Button
                size="sm"
                loading={busy === 'syncPending'}
                onClick={() =>
                  void run('syncPending', async () => {
                    const r = await invoke('google:syncPending')
                    if (r.error) toast('error', `Sent ${r.added} note(s), then Google Docs failed: ${r.error}`)
                    else toast('success', r.added ? `Sent ${r.added} waiting note(s) to Google Docs` : 'All notes are already in Google Docs')
                  })
                }
              >
                Send waiting notes now
              </Button>
            )}
          </Section>
        </div>
      </div>
      {picker && (
        <DocPicker
          heading={`Choose a doc for ${DOC_CATEGORIES.find((c) => c.value === picker)!.label}`}
          defaultTitle={DOC_CATEGORIES.find((c) => c.value === picker)!.label}
          onChoose={async (doc) => {
            setSettings(await invoke('google:setTarget', { category: picker, doc }))
            toast('success', `Notes will go to "${doc.title}"`)
          }}
          onCreate={async (title) => {
            setSettings(await invoke('google:createDoc', { title, category: picker }))
            toast('success', `Created "${title}"`)
          }}
          onClose={() => setPicker(null)}
        />
      )}
    </div>
  )
}
