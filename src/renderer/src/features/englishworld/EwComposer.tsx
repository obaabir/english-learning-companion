// English World: create a post (Post / Question / Story / Win), with a private AI check before posting.
import { useMemo, useRef, useState, type ReactNode } from 'react'
import { Camera, CheckCheck, ImageOff, Loader2, Send, ShieldCheck, X } from 'lucide-react'
import type { EwCheckResult, EwKind } from '@shared/ew'
import { errorMessage } from '@renderer/lib/api'
import { Button, Textarea } from '@renderer/components/ui'
import { cn } from '@renderer/lib/cn'
import { KIND_LABEL, MAX_TEXT, POST_TAGS, QUESTION_TAGS, STORY_COLORS, personalInfo } from './ewLogic'
import { compressPhoto } from './ewImage'
import { ew, useEwMe } from './ewStore'

export interface ComposerPreset {
  kind?: EwKind
  text?: string
  /** Answer to today's challenge. */
  challengeDay?: string
  challengePrompt?: string
}

export function EwComposer({ preset, onClose, onPosted }: { preset: ComposerPreset; onClose: () => void; onPosted: () => void }): ReactNode {
  const me = useEwMe()
  const [kind, setKind] = useState<EwKind>(preset.kind ?? 'post')
  const [text, setText] = useState(preset.text ?? '')
  const [tags, setTags] = useState<string[]>([])
  const [correctMe, setCorrectMe] = useState(true)
  const [bg, setBg] = useState(STORY_COLORS[0])
  const [image, setImage] = useState<string | null>(null)
  const [photoWarn, setPhotoWarn] = useState(false)
  const [photoBusy, setPhotoBusy] = useState(false)
  const [check, setCheck] = useState<EwCheckResult | null>(null)
  const [checking, setChecking] = useState(false)
  const [posting, setPosting] = useState(false)
  const [notice, setNotice] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const tagList = kind === 'question' ? QUESTION_TAGS : POST_TAGS
  const personal = useMemo(() => personalInfo(text), [text])
  const photosAllowed = me.ageGroup !== 'under18' || me.photosOn
  const canPost = text.trim().length > 0 && text.length <= MAX_TEXT && !personal && !posting && !photoBusy

  const pickPhoto = async (file: File | undefined): Promise<void> => {
    if (!file) return
    setPhotoBusy(true)
    setError(null)
    try {
      setImage(await compressPhoto(file))
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setPhotoBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const runCheck = async (): Promise<void> => {
    if (!text.trim()) return
    setChecking(true)
    setError(null)
    try {
      const r = await ew('check', { text: text.trim() })
      if (r.ok && r.result) setCheck(r.result)
      else setError(r.error ?? 'The checker is busy. Please try again.')
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setChecking(false)
    }
  }

  const publish = async (noticeOk = false): Promise<void> => {
    if (!canPost) return
    if (!noticeOk && !me.noticeSeen) {
      setNotice(true)
      return
    }
    setPosting(true)
    setError(null)
    try {
      const r = await ew('publish', {
        action: 'post',
        kind,
        text: text.trim(),
        image,
        bg: kind === 'story' && !image ? bg : null,
        tags,
        correctMe: kind !== 'question' && correctMe,
        challengeDay: preset.challengeDay ?? null
      })
      if (r.ok) onPosted()
      else setError(r.error ?? 'It was not posted. Please try again.')
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setPosting(false)
    }
  }

  return (
    <>
      <div className="ew-backdrop" onClick={onClose} aria-hidden />
      <div className="ew-sheet" role="dialog" aria-modal="true" aria-label="Create a post">
        <div className="mb-3 flex items-center gap-2">
          <h2 className="flex-1 text-base font-semibold">{preset.challengePrompt ? 'Answer today’s challenge' : 'Share in English'}</h2>
          <Button variant="ghost" size="sm" className="ew-tap" icon={<X className="size-5" />} onClick={onClose} aria-label="Close" />
        </div>

        {preset.challengePrompt ? (
          <p className="mb-3 rounded-xl bg-accent-soft px-3 py-2 text-sm text-accent">🎯 {preset.challengePrompt}</p>
        ) : (
          <div className="mb-3 grid grid-cols-4 gap-1 rounded-xl bg-white/60 p-1 ring-1 ring-line/70" role="tablist" aria-label="Post type">
            {(['post', 'question', 'story', 'win'] as EwKind[]).map((k) => (
              <button
                key={k}
                role="tab"
                aria-selected={kind === k}
                onClick={() => {
                  setKind(k)
                  setTags([])
                }}
                className={cn('ew-tap motion-press rounded-[10px] text-sm font-medium', kind === k ? 'bg-accent text-accent-fg' : 'text-muted hover:text-fg')}
              >
                {KIND_LABEL[k]}
              </button>
            ))}
          </div>
        )}
        {kind === 'story' && <p className="mb-2 text-xs text-muted">A Story is one English sentence (with a colour or a photo). It disappears after 24 hours.</p>}
        {kind === 'question' && <p className="mb-2 text-xs text-muted">Questions go to the Questions board. An AI answer comes first, then people answer.</p>}

        <Textarea
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            setCheck(null)
          }}
          rows={kind === 'story' ? 2 : 4}
          maxLength={MAX_TEXT + 50}
          placeholder={kind === 'question' ? 'What do you want to ask? (in English)' : kind === 'story' ? 'My English day in one sentence…' : kind === 'win' ? 'What did you achieve? 🎉' : 'Write in English…'}
          className="text-[15px]"
          aria-describedby="ew-compose-hint"
        />
        <div id="ew-compose-hint" className="mt-1 flex items-center gap-2 text-xs">
          <span className={cn('flex-1', personal ? 'text-warn' : 'text-muted')}>{personal ?? 'Be kind. No phone numbers, addresses, school names or social media.'}</span>
          <span className={cn('tabular-nums', text.length > MAX_TEXT ? 'text-danger' : 'text-muted')}>
            {text.length}/{MAX_TEXT}
          </span>
        </div>

        {/* Private check */}
        <div className="mt-3">
          <Button size="sm" icon={checking ? <Loader2 className="size-3.5 animate-spin" /> : <ShieldCheck className="size-3.5" />} onClick={() => void runCheck()} disabled={!text.trim() || checking}>
            {checking ? 'Checking privately…' : 'Private check'}
          </Button>
          <span className="ml-2 text-[11px] text-muted">Only you see this. Nothing is shared until you tap Post.</span>
        </div>
        {check && (
          <div className="ew-fade mt-2 space-y-2 rounded-xl bg-white/70 p-3 text-sm ring-1 ring-line/70">
            {check.ok || !check.mistakes.length ? (
              <p className="font-medium text-[#1f7a3a]">✓ Looks good! No mistakes found.</p>
            ) : (
              <>
                <ul className="space-y-1">
                  {check.mistakes.map((m, i) => (
                    <li key={i}>
                      <span className="ew-del">{m.wrong}</span> → <span className="ew-add">{m.fix}</span>
                      <span className="block text-xs text-muted">{m.why}</span>
                    </li>
                  ))}
                </ul>
                <p className="text-xs text-muted">Corrected version:</p>
                <p>{check.corrected}</p>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="primary"
                    icon={<CheckCheck className="size-3.5" />}
                    onClick={() => {
                      setText(check.corrected)
                      setCheck(null)
                    }}
                  >
                    Use corrected
                  </Button>
                  <Button size="sm" onClick={() => setCheck(null)}>
                    Keep mine
                  </Button>
                </div>
              </>
            )}
          </div>
        )}

        {/* Tags */}
        <div className="mt-3 flex flex-wrap gap-1.5">
          {tagList.map((t) => (
            <button
              key={t}
              aria-pressed={tags.includes(t)}
              onClick={() => setTags(tags.includes(t) ? tags.filter((x) => x !== t) : [...tags, t].slice(0, 4))}
              className={cn('ew-react motion-press h-8 rounded-full border border-line/80 bg-white/70 px-3 text-xs font-medium text-muted')}
            >
              {t}
            </button>
          ))}
        </div>

        {/* Correct me + photo + story colour */}
        <div className="mt-3 flex flex-wrap items-center gap-3">
          {kind !== 'question' && (
            <label className="ew-tap flex cursor-pointer items-center gap-2 text-sm">
              <input type="checkbox" className="size-4 accent-[var(--accent)]" checked={correctMe} onChange={(e) => setCorrectMe(e.target.checked)} />
              Correct me 🙏
            </label>
          )}
          {photosAllowed ? (
            <Button size="sm" className="ew-tap" icon={photoBusy ? <Loader2 className="size-4 animate-spin" /> : <Camera className="size-4" />} onClick={() => setPhotoWarn(true)} disabled={photoBusy}>
              {image ? 'Change photo' : 'Add photo'}
            </Button>
          ) : (
            <span className="flex items-center gap-1.5 text-xs text-muted">
              <ImageOff className="size-4" /> Photos are off for under-18 accounts (you can turn them on in your profile).
            </span>
          )}
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => void pickPhoto(e.target.files?.[0])} />
        </div>
        {kind === 'story' && !image && (
          <div className="mt-2 flex gap-2" aria-label="Story colour">
            {STORY_COLORS.map((c) => (
              <button key={c} aria-label={`Colour ${c}`} aria-pressed={bg === c} onClick={() => setBg(c)} className={cn('ew-tap size-9 rounded-full ring-offset-2', bg === c && 'ring-2 ring-[var(--rose)]')} style={{ background: c }} />
            ))}
          </div>
        )}
        {image && (
          <div className="ew-fade relative mt-3 inline-block">
            <img src={image} alt="Your photo" className="max-h-56 rounded-xl" />
            <button onClick={() => setImage(null)} className="ew-tap absolute top-1 right-1 rounded-full bg-black/55 text-white" aria-label="Remove photo">
              <X className="mx-auto size-4" />
            </button>
          </div>
        )}

        {error && <p className="ew-fade mt-3 rounded-xl bg-warn-soft px-3 py-2 text-sm text-warn">{error}</p>}

        <div className="mt-4 flex justify-end gap-2">
          <Button className="ew-tap" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" className="ew-tap px-6" icon={posting ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />} onClick={() => void publish()} disabled={!canPost}>
            {posting ? 'Checking & posting…' : 'Post'}
          </Button>
        </div>

        {/* Photo safety warning */}
        {photoWarn && (
          <Dialog onClose={() => setPhotoWarn(false)} title="Before you add a photo">
            <ul className="list-disc space-y-1 pl-5 text-sm">
              <li>No other people’s faces.</li>
              <li>No school uniforms or school names.</li>
              <li>No location details (addresses, street signs, house numbers).</li>
            </ul>
            <div className="mt-4 flex justify-end gap-2">
              <Button onClick={() => setPhotoWarn(false)}>Cancel</Button>
              <Button
                variant="primary"
                onClick={() => {
                  setPhotoWarn(false)
                  fileRef.current?.click()
                }}
              >
                I understand, choose photo
              </Button>
            </div>
          </Dialog>
        )}

        {/* First post: visibility notice (once) */}
        {notice && (
          <Dialog onClose={() => setNotice(false)} title="Before your first post">
            <p className="text-sm">Your posts, photos, and comments are visible to everyone who uses this app.</p>
            <div className="mt-4 flex justify-end gap-2">
              <Button onClick={() => setNotice(false)}>Not now</Button>
              <Button
                variant="primary"
                onClick={() => {
                  me.update({ noticeSeen: true })
                  setNotice(false)
                  void publish(true)
                }}
              >
                I understand, post
              </Button>
            </div>
          </Dialog>
        )}
      </div>
    </>
  )
}

export function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }): ReactNode {
  return (
    <div className="ew-fade fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div role="alertdialog" aria-modal="true" aria-label={title} className="ew-card w-full max-w-sm p-5" onClick={(e) => e.stopPropagation()}>
        <h3 className="mb-2 text-base font-semibold">{title}</h3>
        {children}
      </div>
    </div>
  )
}
