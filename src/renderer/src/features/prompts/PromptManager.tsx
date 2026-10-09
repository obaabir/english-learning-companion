import { useEffect, useState, type ReactNode } from 'react'
import { Copy, Plus, Save, Star, Trash2, Wand2 } from 'lucide-react'
import type { Prompt } from '@shared/types'
import { invoke } from '@renderer/lib/api'
import { useApp } from '@renderer/stores/app'
import { Badge, Button, Field, Input, PanelHeader, Textarea } from '@renderer/components/ui'
import { cn } from '@renderer/lib/cn'

interface Draft {
  id?: number
  name: string
  instruction: string
}

export function PromptManager(): ReactNode {
  const prompts = useApp((s) => s.prompts)
  const { loadPrompts, toast, toastError, setActivePromptId } = useApp.getState()
  const [draft, setDraft] = useState<Draft | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!draft && prompts.length) setDraft(toDraft(prompts[0]))
  }, [prompts, draft])

  const current = prompts.find((p) => p.id === draft?.id)
  const dirty = !!draft && (!current || current.name !== draft.name || current.instruction !== draft.instruction)

  const save = async (): Promise<void> => {
    if (!draft) return
    setSaving(true)
    try {
      const saved = await invoke('prompts:save', draft)
      await loadPrompts()
      setDraft(toDraft(saved))
      toast('success', 'Prompt saved')
    } catch (err) {
      toastError(err)
    } finally {
      setSaving(false)
    }
  }

  const remove = async (p: Prompt): Promise<void> => {
    if (prompts.length <= 1) return toast('info', 'Keep at least one prompt.')
    if (!confirm(`Delete the prompt "${p.name}"?`)) return
    try {
      await invoke('prompts:delete', p.id)
      await loadPrompts()
      setDraft(null)
    } catch (err) {
      toastError(err)
    }
  }

  const makeDefault = async (p: Prompt): Promise<void> => {
    try {
      await invoke('prompts:setDefault', p.id)
      await loadPrompts()
      setActivePromptId(p.id)
      toast('success', `"${p.name}" is now the default prompt`)
    } catch (err) {
      toastError(err)
    }
  }

  const select = (d: Draft): void => {
    if (dirty && !confirm('Discard unsaved changes?')) return
    setDraft(d)
  }

  return (
    <div className="flex h-full gap-2">
      <aside className="glass-panel flex w-72 shrink-0 flex-col overflow-hidden">
        <PanelHeader title="Prompt Manager" icon={<Wand2 className="size-4" />}>
          <Button size="sm" variant="ghost" icon={<Plus className="size-4" />} onClick={() => select({ name: 'My Custom Prompt', instruction: '' })} title="New prompt" />
        </PanelHeader>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {prompts.map((p) => (
            <button
              key={p.id}
              onClick={() => select(toDraft(p))}
              className={cn(
                'motion-hover mb-1 flex w-full items-center gap-2 rounded-xl border px-3 py-2.5 text-left text-sm',
                p.id === draft?.id ? 'surface-selected' : 'border-transparent hover:border-white/80 hover:bg-white/55'
              )}
            >
              <span className="flex-1 truncate font-medium">{p.name}</span>
              {p.isDefault && <Badge tone="accent">default</Badge>}
            </button>
          ))}
          {draft && draft.id == null && (
            <div className="mb-1 rounded-lg border border-dashed border-accent px-3 py-2.5 text-sm text-muted">{draft.name || 'New prompt'} (unsaved)</div>
          )}
        </div>
      </aside>

      <div className="glass-panel flex min-w-0 flex-1 flex-col overflow-hidden">
        {draft ? (
          <>
            <div className="min-h-0 flex-1 overflow-y-auto">
              <div className="mx-auto max-w-3xl space-y-4 px-6 py-6">
                <p className="text-sm text-muted">
                  The selected prompt is sent to Gemini as its system instruction for <b>Explain</b> and <b>Chat</b>, so you never have to paste it again.
                </p>
                <Field label="Name">
                  <Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="e.g. Bangla Explanation" />
                </Field>
                <Field label="Instruction" hint="Describe how Gemini should explain English to you: language, focus, format, level.">
                  <Textarea
                    value={draft.instruction}
                    onChange={(e) => setDraft({ ...draft, instruction: e.target.value })}
                    rows={18}
                    className="font-mono text-[13px] leading-relaxed"
                    placeholder="You are my English teacher…"
                  />
                </Field>
              </div>
            </div>
            <div className="flex shrink-0 flex-wrap gap-2 border-t border-line/70 bg-white/45 px-6 py-3">
              <Button variant="primary" icon={<Save className="size-4" />} loading={saving} disabled={!dirty} onClick={() => void save()}>
                Save
              </Button>
              {current && !current.isDefault && (
                <Button icon={<Star className="size-4" />} onClick={() => void makeDefault(current)}>
                  Set as default
                </Button>
              )}
              {current && (
                <Button icon={<Copy className="size-4" />} onClick={() => select({ name: `${current.name} (copy)`, instruction: current.instruction })}>
                  Duplicate
                </Button>
              )}
              {current && (
                <Button variant="danger" className="ml-auto" icon={<Trash2 className="size-4" />} onClick={() => void remove(current)}>
                  Delete
                </Button>
              )}
            </div>
          </>
        ) : null}
      </div>
    </div>
  )
}

const toDraft = (p: Prompt): Draft => ({ id: p.id, name: p.name, instruction: p.instruction })
