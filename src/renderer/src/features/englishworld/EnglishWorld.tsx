// English World: a safe place to post in English, correct each other kindly and ask for help.
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Bell, Globe2, Loader2, PenLine, Settings2, Shield, X } from 'lucide-react'
import type { EwLevel, EwModItem, EwNotification, EwProfile, EwStatus } from '@shared/ew'
import { errorMessage } from '@renderer/lib/api'
import { useApp } from '@renderer/stores/app'
import { Badge, Button, Input, Select } from '@renderer/components/ui'
import { cn } from '@renderer/lib/cn'
import { AVATARS, LEVELS, personalInfo, quietHours, timeAgo } from './ewLogic'
import { EwComposer, type ComposerPreset } from './EwComposer'
import { Avatar, Feed, Skeleton, StoriesRow, type FeedView } from './EwFeed'
import { ew, useEwMe } from './ewStore'
import './ew.css'

const TABS: { id: FeedView; label: string }[] = [
  { id: 'foryou', label: 'For You' },
  { id: 'following', label: 'Following' },
  { id: 'challenge', label: 'Challenge' },
  { id: 'questions', label: 'Questions' }
]

export function EnglishWorld(): ReactNode {
  const [status, setStatus] = useState<EwStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const ageGroup = useEwMe((s) => s.ageGroup)

  const refresh = useCallback(async () => {
    setBusy(true)
    try {
      setStatus(await ew('status', null))
    } catch (err) {
      setStatus({ configured: false, url: null, userId: null, profile: null, error: errorMessage(err) })
    } finally {
      setBusy(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return (
    <div className="ew-root glass-panel relative flex h-full flex-col overflow-hidden">
      {!status ? (
        <Shell>
          <div className="ew-col space-y-3 p-4">
            <Skeleton />
            <Skeleton />
          </div>
        </Shell>
      ) : !status.configured ? (
        <Shell>
          <Setup onDone={setStatus} />
        </Shell>
      ) : status.error ? (
        <Shell>
          <div className="ew-col p-6">
            <div className="ew-card p-5">
              <p className="font-semibold">Can’t open English World right now</p>
              <p className="mt-1 text-sm text-muted">{status.error}</p>
              <div className="mt-3 flex gap-2">
                <Button variant="primary" loading={busy} onClick={() => void refresh()}>
                  Try again
                </Button>
                <Button
                  variant="ghost"
                  onClick={() =>
                    void ew('disconnect', null)
                      .then(setStatus)
                      .catch(() => undefined)
                  }
                >
                  Change connection
                </Button>
              </div>
            </div>
          </div>
        </Shell>
      ) : !status.profile || !ageGroup ? (
        <Shell>
          <div className="ew-col p-4">
            <ProfileForm first profile={status.profile} onSaved={(profile) => setStatus({ ...status, profile })} />
          </div>
        </Shell>
      ) : (
        <World status={status} profile={status.profile} onProfile={(profile) => setStatus({ ...status, profile })} onDisconnect={setStatus} />
      )}
    </div>
  )
}

function Shell({ children, right }: { children: ReactNode; right?: ReactNode }): ReactNode {
  return (
    <>
      <div className="glass-header flex h-12 shrink-0 items-center gap-2 rounded-t-[17px] px-4">
        <Globe2 className="size-5 text-rose" />
        <h1 className="text-sm font-semibold">English World</h1>
        <div className="ml-auto flex items-center gap-1">{right}</div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
    </>
  )
}

/* ------------------------------ Setup (once) ------------------------------ */

function Setup({ onDone }: { onDone: (s: EwStatus) => void }): ReactNode {
  const [url, setUrl] = useState('')
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const connect = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const s = await ew('configure', { url, key })
      if (s.error) setError(s.error)
      onDone(s)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="ew-col space-y-4 p-4">
      <div className="ew-card p-5">
        <p className="text-lg font-semibold">🌏 Connect English World</p>
        <p className="mt-1 text-sm text-muted">
          English World is a shared space, so it needs a free online database (Supabase). The owner sets it up once (see <b>ENGLISH-WORLD-SETUP.md</b> in the project folder), then everyone pastes
          the same two values here.
        </p>
        <div className="mt-4 space-y-3">
          <label className="block text-sm">
            <span className="mb-1 block font-medium">Project URL</span>
            <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://abcdxyz.supabase.co" autoComplete="off" spellCheck={false} />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium">Publishable key (public)</span>
            <Input value={key} onChange={(e) => setKey(e.target.value)} placeholder="sb_publishable_… or eyJ…" autoComplete="off" spellCheck={false} />
            <span className="mt-1 block text-xs text-muted">Never paste the secret / service_role key here.</span>
          </label>
          {error && <p className="rounded-xl bg-warn-soft px-3 py-2 text-sm text-warn">{error}</p>}
          <Button variant="primary" className="ew-tap" loading={busy} onClick={() => void connect()} disabled={!url.trim() || !key.trim()}>
            Connect
          </Button>
        </div>
      </div>
    </div>
  )
}

/* ------------------------------ Profile ------------------------------ */

function ProfileForm({ first, profile, onSaved, onCancel }: { first?: boolean; profile: EwProfile | null; onSaved: (p: EwProfile) => void; onCancel?: () => void }): ReactNode {
  const me = useEwMe()
  const [name, setName] = useState(profile?.name ?? '')
  const [avatar, setAvatar] = useState(profile?.avatar ?? AVATARS[0])
  const [level, setLevel] = useState<EwLevel>(profile?.level ?? 'Beginner')
  const [goal, setGoal] = useState(profile?.goal ?? '')
  const [age, setAge] = useState<'under18' | '18plus' | null>(me.ageGroup)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const personal = personalInfo(`${name} ${goal}`)

  const save = async (): Promise<void> => {
    if (!age) return
    setBusy(true)
    setError(null)
    try {
      const p = await ew('saveProfile', { name, avatar, level, goal })
      // Under-18: stricter defaults (photo posts off until turned on in settings).
      if (age !== me.ageGroup) me.update({ ageGroup: age, photosOn: age === '18plus' })
      onSaved(p)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="ew-card space-y-4 p-5">
      <div>
        <p className="text-lg font-semibold">{first ? 'Welcome to English World 🌏' : 'Your profile'}</p>
        {first && <p className="text-sm text-muted">A friendly place to write in English, help each other and grow. No real photo needed.</p>}
      </div>
      <label className="block text-sm">
        <span className="mb-1 block font-medium">Display name</span>
        <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={30} placeholder="e.g. Rafi or Sky Learner" />
        <span className="mt-1 block text-xs text-muted">Don’t use your full real name.</span>
      </label>
      <div className="text-sm">
        <span className="mb-1 block font-medium">Avatar</span>
        <div className="flex flex-wrap gap-1.5">
          {AVATARS.map((a) => (
            <button key={a} onClick={() => setAvatar(a)} aria-pressed={avatar === a} aria-label={`Avatar ${a}`} className={cn('ew-tap motion-press rounded-full text-xl', avatar === a ? 'bg-accent-soft ring-2 ring-[var(--rose)]' : 'bg-white/70')}>
              {a}
            </button>
          ))}
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Level</span>
          <Select value={level} onChange={(e) => setLevel(e.target.value as EwLevel)} className="h-10 w-full">
            {LEVELS.map((l) => (
              <option key={l}>{l}</option>
            ))}
          </Select>
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Goal</span>
          <Input value={goal} onChange={(e) => setGoal(e.target.value)} maxLength={120} placeholder="e.g. Speak without fear" />
        </label>
      </div>
      <div className="text-sm">
        <span className="mb-1 block font-medium">Age group</span>
        <div className="flex gap-2">
          {(
            [
              ['under18', 'Under 18'],
              ['18plus', '18+']
            ] as const
          ).map(([v, label]) => (
            <button key={v} onClick={() => setAge(v)} aria-pressed={age === v} className={cn('ew-tap motion-press flex-1 rounded-xl border text-sm font-medium', age === v ? 'surface-selected text-accent' : 'border-line bg-white/70 text-muted')}>
              {label}
            </button>
          ))}
        </div>
        <span className="mt-1 block text-xs text-muted">Kept only on this device. Under-18 accounts have photo posts off by default.</span>
      </div>
      {(personal || error) && <p className="rounded-xl bg-warn-soft px-3 py-2 text-sm text-warn">{personal ?? error}</p>}
      <div className="flex justify-end gap-2">
        {onCancel && <Button onClick={onCancel}>Cancel</Button>}
        <Button variant="primary" className="ew-tap" loading={busy} onClick={() => void save()} disabled={!name.trim() || !age || !!personal}>
          {first ? 'Start' : 'Save'}
        </Button>
      </div>
    </div>
  )
}

/* ------------------------------ Main view ------------------------------ */

function World({ status, profile, onProfile, onDisconnect }: { status: EwStatus; profile: EwProfile; onProfile: (p: EwProfile) => void; onDisconnect: (s: EwStatus) => void }): ReactNode {
  const [view, setView] = useState<FeedView>('foryou')
  const [composer, setComposer] = useState<ComposerPreset | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const [panel, setPanel] = useState<null | 'bell' | 'mod' | 'settings'>(null)
  const [notes, setNotes] = useState<EwNotification[] | null>(null)
  const seenAt = useEwMe((s) => s.seenAt)

  // Bell: checked when English World opens (no background polling, quiet 11 pm – 7 am).
  useEffect(() => {
    if (quietHours()) {
      setNotes([])
      return
    }
    const since = seenAt ?? new Date(Date.now() - 7 * 86400000).toISOString()
    ew('notifications', { since })
      .then(setNotes)
      .catch(() => setNotes([]))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const unread = quietHours() ? 0 : (notes?.length ?? 0)

  return (
    <Shell
      right={
        <>
          <div className="relative">
            <Button
              variant="ghost"
              size="sm"
              className="ew-tap"
              icon={<Bell className="size-5" />}
              aria-label={`Notifications${unread ? `, ${unread} new` : ''}`}
              onClick={() => {
                setPanel(panel === 'bell' ? null : 'bell')
                useEwMe.getState().update({ seenAt: new Date().toISOString() })
              }}
            />
            {unread > 0 && <span className="pointer-events-none absolute top-0.5 right-0.5 min-w-4 rounded-full bg-accent px-1 text-center text-[10px] leading-4 text-accent-fg">{unread > 9 ? '9+' : unread}</span>}
          </div>
          <Button variant="ghost" size="sm" className="ew-tap" icon={<Shield className="size-5" />} aria-label="Moderator mode" onClick={() => setPanel(panel === 'mod' ? null : 'mod')} />
          <Button variant="ghost" size="sm" className="ew-tap" icon={<Settings2 className="size-5" />} aria-label="Profile and settings" onClick={() => setPanel(panel === 'settings' ? null : 'settings')} />
          <Avatar emoji={profile.avatar} size={30} />
        </>
      }
    >
      <div className="ew-col flex flex-col gap-3 p-3 sm:p-4">
        <StoriesRow refreshKey={refreshKey} myId={status.userId} onNew={() => setComposer({ kind: 'story' })} />

        <button onClick={() => setComposer({ kind: 'post' })} className="ew-card motion-press flex items-center gap-3 p-3 text-left" aria-label="Create a post">
          <Avatar emoji={profile.avatar} />
          <span className="flex-1 text-sm text-muted">Share something in English, {profile.name}…</span>
          <span className="flex h-10 items-center gap-1.5 rounded-full bg-accent px-4 text-sm font-medium text-accent-fg">
            <PenLine className="size-4" /> Post
          </span>
        </button>

        <div className="flex gap-1 overflow-x-auto [scrollbar-width:none]" role="tablist" aria-label="Feed">
          {TABS.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={view === t.id}
              onClick={() => setView(t.id)}
              className={cn('ew-tab ew-tap motion-press shrink-0 rounded-full border px-4 text-sm font-medium', view === t.id ? 'surface-selected' : 'border-transparent text-muted hover:bg-white/55')}
            >
              {t.label}
            </button>
          ))}
        </div>

        <Feed key={view} view={view} myId={status.userId} myLevel={profile.level} refreshKey={refreshKey} onCompose={setComposer} />
      </div>

      {composer && (
        <EwComposer
          preset={composer}
          onClose={() => setComposer(null)}
          onPosted={() => {
            setComposer(null)
            setRefreshKey((k) => k + 1)
            useApp.getState().toast('success', 'Posted ✓')
          }}
        />
      )}

      {panel === 'bell' && (
        <Panel title="Notifications" onClose={() => setPanel(null)}>
          {quietHours() ? (
            <p className="text-sm text-muted">Quiet hours (11 pm – 7 am). Notifications are paused. Sleep well 🌙</p>
          ) : !notes ? (
            <Loader2 className="size-5 animate-spin text-muted" />
          ) : !notes.length ? (
            <p className="text-sm text-muted">Nothing new.</p>
          ) : (
            <ul className="space-y-2">
              {notes.map((n, i) => (
                <li key={i} className="flex items-start gap-2 rounded-xl bg-white/70 p-2.5 text-sm ring-1 ring-line/60">
                  <Avatar emoji={n.actorAvatar} size={28} />
                  <div className="min-w-0 flex-1">
                    <p>
                      <b>{n.actorName}</b>{' '}
                      {n.kind === 'reaction'
                        ? `reacted ${n.detail === 'learned' ? '💡' : n.detail === 'brave' ? '👏' : '✅'} to your post`
                        : n.kind === 'correction'
                          ? 'suggested a correction'
                          : n.kind === 'helpful'
                            ? 'marked your correction Helpful ✓'
                            : 'answered / commented'}
                    </p>
                    {n.kind !== 'reaction' && <p className="truncate text-xs text-muted">{n.detail}</p>}
                    <p className="text-[11px] text-muted">{timeAgo(n.at)}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      )}

      {panel === 'mod' && <ModPanel onClose={() => setPanel(null)} />}

      {panel === 'settings' && (
        <Panel title="Profile & settings" onClose={() => setPanel(null)}>
          <SettingsBody
            profile={profile}
            onProfile={(p) => {
              onProfile(p)
              setPanel(null)
            }}
            onDisconnect={onDisconnect}
          />
        </Panel>
      )}
    </Shell>
  )
}

function Panel({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }): ReactNode {
  return (
    <>
      <div className="ew-backdrop" onClick={onClose} aria-hidden />
      <div className="ew-sheet" role="dialog" aria-modal="true" aria-label={title}>
        <div className="mb-3 flex items-center gap-2">
          <h2 className="flex-1 text-base font-semibold">{title}</h2>
          <Button variant="ghost" size="sm" className="ew-tap" icon={<X className="size-5" />} onClick={onClose} aria-label="Close" />
        </div>
        {children}
      </div>
    </>
  )
}

function SettingsBody({ profile, onProfile, onDisconnect }: { profile: EwProfile; onProfile: (p: EwProfile) => void; onDisconnect: (s: EwStatus) => void }): ReactNode {
  const me = useEwMe()
  return (
    <div className="space-y-4">
      <ProfileForm profile={profile} onSaved={onProfile} />
      <div className="ew-card space-y-2 p-4">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="size-4 accent-[var(--accent)]" checked={me.photosOn} onChange={(e) => me.update({ photosOn: e.target.checked })} />
          Allow photo posts {me.ageGroup === 'under18' && <span className="text-xs text-muted">(off by default for under-18)</span>}
        </label>
        <div>
          <p className="text-sm font-medium">Blocked people</p>
          {me.blocked.length ? (
            <p className="text-xs text-muted">
              {me.blocked.length} blocked.{' '}
              <button className="underline" onClick={() => me.update({ blocked: [] })}>
                Unblock all
              </button>
            </p>
          ) : (
            <p className="text-xs text-muted">Nobody.</p>
          )}
        </div>
      </div>
      <Button
        variant="ghost"
        size="sm"
        onClick={() =>
          void ew('disconnect', null)
            .then(onDisconnect)
            .catch(() => undefined)
        }
      >
        Disconnect English World on this device
      </Button>
    </div>
  )
}

/* ------------------------------ Moderator ------------------------------ */

function ModPanel({ onClose }: { onClose: () => void }): ReactNode {
  const [hasPass, setHasPass] = useState<boolean | null>(null)
  const [pass, setPass] = useState('')
  const [queue, setQueue] = useState<EwModItem[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    ew('modStatus', null)
      .then(setHasPass)
      .catch((e) => setError(errorMessage(e)))
  }, [])

  const open = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      if (!hasPass) {
        const ok = await ew('modSetup', { passcode: pass })
        if (!ok) throw new Error('A passcode was already set by someone else.')
        setHasPass(true)
      }
      setQueue(await ew('modQueue', { passcode: pass }))
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const setHidden = async (it: EwModItem, hide: boolean): Promise<void> => {
    try {
      await ew('modSetHidden', { passcode: pass, targetType: it.targetType, targetId: it.targetId, hide })
      setQueue(await ew('modQueue', { passcode: pass }))
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  return (
    <Panel title="Moderator mode" onClose={onClose}>
      <p className="mb-3 rounded-xl bg-warn-soft px-3 py-2 text-xs text-warn">
        This protection is basic: one shared passcode, checked on the server. Anyone who knows it can moderate. Use a long passcode and don’t share it.
      </p>
      {queue === null ? (
        <div className="space-y-2">
          <p className="text-sm">{hasPass === false ? 'Set a moderator passcode (first time, 6+ characters).' : 'Enter the moderator passcode.'}</p>
          <div className="flex gap-2">
            <Input type="password" value={pass} onChange={(e) => setPass(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void open()} placeholder="Passcode" autoComplete="off" />
            <Button variant="primary" loading={busy} onClick={() => void open()} disabled={pass.length < 6 || hasPass === null}>
              {hasPass === false ? 'Set' : 'Open'}
            </Button>
          </div>
        </div>
      ) : !queue.length ? (
        <p className="text-sm text-muted">No reports. All clear ✓</p>
      ) : (
        <ul className="space-y-2">
          {queue.map((it) => (
            <li key={`${it.targetType}-${it.targetId}`} className="rounded-xl bg-white/70 p-3 text-sm ring-1 ring-line/60">
              <div className="mb-1 flex flex-wrap items-center gap-1.5 text-xs">
                <Badge>{it.targetType}</Badge>
                <span className="font-medium">{it.authorName}</span>
                <span className="text-muted">· {timeAgo(it.createdAt)}</span>
                {it.reports > 0 && <Badge tone="warn">{it.reports} reports</Badge>}
                {it.reasons.map((r) => (
                  <Badge key={r}>{r}</Badge>
                ))}
                {it.hidden && <Badge tone="danger">hidden</Badge>}
              </div>
              <p className="whitespace-pre-wrap">{it.text}</p>
              {it.targetType !== 'profile' && (
                <div className="mt-2 flex gap-2">
                  {it.hidden ? (
                    <Button size="sm" onClick={() => void setHidden(it, false)}>
                      Restore
                    </Button>
                  ) : (
                    <Button size="sm" variant="danger" onClick={() => void setHidden(it, true)}>
                      Hide
                    </Button>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {error && <p className="mt-3 text-sm text-warn">{error}</p>}
    </Panel>
  )
}
